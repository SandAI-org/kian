import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspaceRoot: "",
  getChatSession: vi.fn(),
  createChatSession: vi.fn(),
  emitAppOperation: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
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
}));

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: {
    getChatSession: (...args: unknown[]) => state.getChatSession(...args),
    createChatSession: (...args: unknown[]) => state.createChatSession(...args),
  },
}));

vi.mock("../../electron/main/services/appOperationEvents", () => ({
  appOperationEvents: {
    emit: (...args: unknown[]) => state.emitAppOperation(...args),
  },
}));

describe("agentService session control tools", () => {
  beforeEach(() => {
    vi.resetModules();
    state.getChatSession.mockReset();
    state.createChatSession.mockReset();
    state.emitAppOperation.mockReset();
    state.workspaceRoot = "/tmp/kian-agent-service-test";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes the same session reset tool for main and project agents", async () => {
    const { createSessionControlTools } = await import(
      "../../electron/main/services/agentService"
    );

    const mainTools = createSessionControlTools({
      scope: { type: "main" },
      chatSessionId: "main-session",
    });
    const projectTools = createSessionControlTools({
      scope: { type: "project", projectId: "p-2026-03-09-1" },
      chatSessionId: "project-session",
    });

    expect(mainTools.map((tool) => tool.name)).toEqual(["NewSession"]);
    expect(projectTools.map((tool) => tool.name)).toEqual(["NewSession"]);
    expect(mainTools[0]?.description).toContain("新会话");
    expect(mainTools[0]?.description).toContain("新话题");
    expect(mainTools[0]?.description).toContain("重新开始一个话题");
  });

  it("creates a new main-agent session and opens it immediately", async () => {
    const { createSessionControlTools } = await import(
      "../../electron/main/services/agentService"
    );

    state.getChatSession.mockResolvedValue({
      id: "main-session",
      scopeType: "main",
      module: "main",
      title: "Current",
      createdAt: "2026-03-09T09:59:00.000Z",
      updatedAt: "2026-03-09T09:59:30.000Z",
    });
    state.createChatSession.mockResolvedValue({
      id: "main-session-2",
      scopeType: "main",
      module: "main",
      title: "",
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
    });

    const [tool] = createSessionControlTools({
      scope: { type: "main" },
      chatSessionId: "main-session",
    });

    const result = await tool.handler({});

    expect(result.isError).toBeUndefined();
    expect(state.createChatSession).toHaveBeenCalledWith({
      scope: { type: "main" },
      module: "main",
      title: "",
    });
    expect(state.emitAppOperation).toHaveBeenCalledWith({
      type: "open_chat_session",
      scope: { type: "main" },
      sessionId: "main-session-2",
      module: "main",
    });
    expect(result.text).toContain("main-session-2");
  });

  it("creates a new project session in the current module and opens it immediately", async () => {
    const { createSessionControlTools } = await import(
      "../../electron/main/services/agentService"
    );

    state.getChatSession.mockResolvedValue({
      id: "project-session",
      scopeType: "project",
      projectId: "p-2026-03-09-1",
      module: "creation",
      title: "Current",
      createdAt: "2026-03-09T09:59:00.000Z",
      updatedAt: "2026-03-09T09:59:30.000Z",
    });
    state.createChatSession.mockResolvedValue({
      id: "project-session-2",
      scopeType: "project",
      projectId: "p-2026-03-09-1",
      module: "creation",
      title: "",
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
    });

    const scope = { type: "project" as const, projectId: "p-2026-03-09-1" };
    const [tool] = createSessionControlTools({
      scope,
      chatSessionId: "project-session",
    });

    const result = await tool.handler({});

    expect(result.isError).toBeUndefined();
    expect(state.createChatSession).toHaveBeenCalledWith({
      scope,
      module: "creation",
      title: "",
    });
    expect(state.emitAppOperation).toHaveBeenCalledWith({
      type: "open_chat_session",
      scope,
      sessionId: "project-session-2",
      module: "creation",
    });
    expect(result.text).toContain("project-session-2");
  });
});
