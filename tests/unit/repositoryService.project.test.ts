import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspaceRoot: "",
  systemPrompt: "# test prompt\n",
  emitHistoryUpdated: vi.fn(),
}));

vi.mock("../../electron/main/services/workspacePaths", () => ({
  get WORKSPACE_ROOT() {
    return state.workspaceRoot;
  },
  get INTERNAL_ROOT() {
    return path.join(state.workspaceRoot, ".kian");
  },
  get GLOBAL_CONFIG_DIR() {
    return path.join(state.workspaceRoot, ".global");
  },
  get GLOBAL_CONFIG_PATH() {
    return path.join(state.workspaceRoot, ".global", "config.json");
  },
}));

vi.mock("../../electron/main/services/settingsService", () => ({
  settingsService: {
    getAgentSystemPrompt: vi.fn(async () => state.systemPrompt),
  },
}));

vi.mock("../../electron/main/services/chatEvents", () => ({
  chatEvents: {
    emitHistoryUpdated: (...args: unknown[]) => state.emitHistoryUpdated(...args),
  },
}));

const formatDay = (date: Date): string => {
  const pad2 = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

describe("repositoryService project management", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T09:30:00.000Z"));
    state.emitHistoryUpdated.mockReset();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kian-project-repo-"));
    state.workspaceRoot = tempRoot;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates project with immutable id and preset default name for agent-created workspaces", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const now = new Date();
    const day = formatDay(now);

    const created = await repositoryService.createProject({});

    expect(created.id).toBe(`p-${day}-1`);
    expect(created.name).toBe("张亮");

    const projectDir = path.join(tempRoot, created.id);
    const stats = await fs.stat(projectDir);
    expect(stats.isDirectory()).toBe(true);
    await expect(
      fs.stat(path.join(projectDir, ".pi", "SYSTEM.md")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("uses stranger sequence names for manually created agents", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const day = formatDay(new Date());

    const first = await repositoryService.createProject({ source: "manual" });
    const second = await repositoryService.createProject({ source: "manual" });

    expect(first.id).toBe(`p-${day}-1`);
    expect(first.name).toBe("陌生人-1");
    expect(second.id).toBe(`p-${day}-2`);
    expect(second.name).toBe("陌生人-2");
  });

  it("increments same-day sequence and keeps id independent from custom name", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const day = formatDay(new Date());

    const first = await repositoryService.createProject({});
    const second = await repositoryService.createProject({
      name: "   自定义   项目   名称   ",
    });

    expect(first.id).toBe(`p-${day}-1`);
    expect(second.id).toBe(`p-${day}-2`);
    expect(second.name).toBe("自定义 项目 名称");
  });

  it("renaming project only updates name and keeps directory path stable", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const project = await repositoryService.createProject({});
    await repositoryService.createDocument({
      projectId: project.id,
      title: "note",
      content: "hello",
    });
    const projectDir = path.join(tempRoot, project.id);
    const docPath = path.join(projectDir, "docs", "note.md");

    vi.setSystemTime(new Date("2026-03-05T10:30:00.000Z"));
    const updated = await repositoryService.updateProject({
      id: project.id,
      name: "  Renamed Project  ",
    });

    expect(updated.id).toBe(project.id);
    expect(updated.name).toBe("Renamed Project");
    const docStats = await fs.stat(docPath);
    expect(docStats.isFile()).toBe(true);

    const docs = await repositoryService.listDocuments(project.id);
    expect(docs.some((item) => item.id === "note.md")).toBe(true);
  });

  it("lists and updates common code files as editable documents", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );

    const project = await repositoryService.createProject({});
    const projectDir = path.join(tempRoot, project.id);
    const docsDir = path.join(projectDir, "docs");

    await fs.mkdir(path.join(docsDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(docsDir, "src", "main.ts"),
      'export const answer = 42;\n',
      "utf8",
    );
    await fs.writeFile(path.join(docsDir, "logo.png"), "png", "utf8");

    const docs = await repositoryService.listDocuments(project.id);
    expect(docs.map((item) => item.id)).toContain("src/main.ts");
    expect(docs.map((item) => item.id)).not.toContain("logo.png");

    const explorer = await repositoryService.listDocumentExplorer(project.id);
    expect(explorer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/main.ts",
          kind: "file",
          isEditableText: true,
          isMarkdown: false,
        }),
        expect.objectContaining({
          path: "logo.png",
          kind: "file",
          isEditableText: false,
          isMarkdown: false,
        }),
      ]),
    );

    const updated = await repositoryService.updateDocument({
      projectId: project.id,
      id: "src/main.ts",
      title: "app.ts",
      content: "export const answer = 43;\n",
    });

    expect(updated.id).toBe("src/app.ts");
    await expect(fs.readFile(path.join(docsDir, "src", "app.ts"), "utf8")).resolves.toBe(
      "export const answer = 43;\n",
    );
    await expect(fs.stat(path.join(docsDir, "src", "main.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("resets daily sequence on a new day", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );

    vi.setSystemTime(new Date("2026-03-05T09:30:00.000Z"));
    const day1 = formatDay(new Date());
    const first = await repositoryService.createProject({});
    const second = await repositoryService.createProject({});

    vi.setSystemTime(new Date("2026-03-06T09:30:00.000Z"));
    const day2 = formatDay(new Date());
    const third = await repositoryService.createProject({});

    expect(first.id).toBe(`p-${day1}-1`);
    expect(second.id).toBe(`p-${day1}-2`);
    expect(third.id).toBe(`p-${day2}-1`);
  });

  it("stores main agent chat outside project list", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );

    const session = await repositoryService.createChatSession({
      scope: { type: "main" },
      module: "main",
      title: "主 Agent 会话",
    });
    await repositoryService.appendMessage({
      scope: { type: "main" },
      sessionId: session.id,
      role: "assistant",
      content: "hello from main",
    });

    const sessions = await repositoryService.listChatSessions({
      type: "main",
    });
    const messages = await repositoryService.listMessages(
      { type: "main" },
      session.id,
    );
    const projects = await repositoryService.listProjects();

    expect(sessions[0]).toMatchObject({
      id: session.id,
      scopeType: "main",
      module: "main",
    });
    expect(messages[0]?.content).toBe("hello from main");
    expect(projects).toHaveLength(0);
    await expect(
      fs.stat(path.join(tempRoot, ".kian", "main-agent", "chat", "sessions.json")),
    ).resolves.toBeTruthy();
  });

  it("stores main agent docs under the internal workspace and migrates legacy context files", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );

    await fs.writeFile(
      path.join(tempRoot, "IDENTITY.md"),
      "# 主 Agent 身份\n",
      "utf8",
    );

    const initialDocs = await repositoryService.listDocuments("main-agent");
    expect(initialDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "IDENTITY.md",
          projectId: "main-agent",
          content: "# 主 Agent 身份\n",
        }),
      ]),
    );
    await expect(
      fs.readFile(
        path.join(tempRoot, ".kian", "main-agent", "docs", "IDENTITY.md"),
        "utf8",
      ),
    ).resolves.toBe("# 主 Agent 身份\n");

    const created = await repositoryService.createDocument({
      projectId: "main-agent",
      title: "记忆/偏好",
      content: "喜欢清晰直接的答案。\n",
    });

    expect(created.id).toBe("记忆/偏好.md");
    await expect(
      fs.readFile(
        path.join(tempRoot, ".kian", "main-agent", "docs", "记忆", "偏好.md"),
        "utf8",
      ),
    ).resolves.toBe("喜欢清晰直接的答案。\n");
  });

  it("emits session module when updating a chat title", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );

    const session = await repositoryService.createChatSession({
      scope: { type: "main" },
      module: "main",
      title: "",
    });

    state.emitHistoryUpdated.mockClear();
    vi.setSystemTime(new Date("2026-03-05T09:31:00.000Z"));

    await repositoryService.updateChatSessionTitle({
      scope: { type: "main" },
      sessionId: session.id,
      title: "自动标题",
    });

    expect(state.emitHistoryUpdated).toHaveBeenCalledWith({
      scope: { type: "main" },
      sessionId: session.id,
      messageId: "",
      role: "system",
      createdAt: "2026-03-05T09:31:00.000Z",
      sessionTitle: "自动标题",
      sessionUpdatedAt: "2026-03-05T09:31:00.000Z",
      sessionModule: "main",
    });
  });
});
