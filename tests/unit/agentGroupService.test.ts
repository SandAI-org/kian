import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspaceRoot: "",
  send: vi.fn(),
  emitHistoryUpdated: vi.fn(),
  warn: vi.fn(),
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

vi.mock("../../electron/main/services/chatService", () => ({
  chatService: {
    send: (...args: unknown[]) => state.send(...args),
  },
}));

vi.mock("../../electron/main/services/chatEvents", () => ({
  chatEvents: {
    emitHistoryUpdated: (...args: unknown[]) =>
      state.emitHistoryUpdated(...args),
  },
}));

vi.mock("../../electron/main/services/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => state.warn(...args),
    error: vi.fn(),
  },
}));

describe("agentGroupService", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T10:00:00.000Z"));
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kian-agent-group-"));
    state.workspaceRoot = tempRoot;
    state.send.mockReset().mockResolvedValue({
      assistantMessage: "",
      toolActions: [],
    });
    state.emitHistoryUpdated.mockReset();
    state.warn.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates groups and manages members", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const { agentGroupService } = await import(
      "../../electron/main/services/agentGroupService"
    );
    const agent = await repositoryService.createProject({ name: "Alice" });

    const group = await agentGroupService.createGroup({
      name: "  Research Team  ",
      description: "Plan together",
      memberProjectIds: [agent.id],
    });
    const withoutMember = await agentGroupService.removeMember({
      groupId: group.id,
      projectIds: [agent.id],
    });
    const withMember = await agentGroupService.addMembers({
      groupId: group.id,
      projectIds: [agent.id],
    });

    expect(group.name).toBe("Research Team");
    expect(group.memberProjectIds).toEqual([agent.id]);
    expect(withoutMember.memberProjectIds).toEqual([]);
    expect(withMember.memberProjectIds).toEqual([agent.id]);
  });

  it("stores group messages as JSONL and pages backward by cursor", async () => {
    const { agentGroupService } = await import(
      "../../electron/main/services/agentGroupService"
    );
    const group = await agentGroupService.createGroup({ name: "Timeline" });

    for (let index = 1; index <= 45; index += 1) {
      await agentGroupService.sendUserMessage({
        groupId: group.id,
        content: `message-${index}`,
      });
    }

    const latest = await agentGroupService.listMessages({
      groupId: group.id,
      limit: 10,
    });
    const older = await agentGroupService.listMessages({
      groupId: group.id,
      limit: 10,
      beforeCursor: latest.nextBeforeCursor,
    });
    const jsonlPath = path.join(
      tempRoot,
      ".kian",
      "agent-groups",
      group.id,
      "messages.ndjson",
    );
    const raw = await fs.readFile(jsonlPath, "utf8");

    expect(raw.trim().split("\n")).toHaveLength(45);
    expect(latest.messages.map((item) => item.content)).toEqual([
      "message-36",
      "message-37",
      "message-38",
      "message-39",
      "message-40",
      "message-41",
      "message-42",
      "message-43",
      "message-44",
      "message-45",
    ]);
    expect(latest.hasMore).toBe(true);
    expect(older.messages.map((item) => item.content)).toEqual([
      "message-26",
      "message-27",
      "message-28",
      "message-29",
      "message-30",
      "message-31",
      "message-32",
      "message-33",
      "message-34",
      "message-35",
    ]);
  });

  it("notifies only mentioned agents and creates a fresh hidden group runtime session", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const { agentGroupService } = await import(
      "../../electron/main/services/agentGroupService"
    );
    const alice = await repositoryService.createProject({ name: "Alice" });
    const bob = await repositoryService.createProject({ name: "Bob" });
    const group = await agentGroupService.createGroup({ name: "Team" });
    await agentGroupService.addMembers({
      groupId: group.id,
      projectIds: [alice.id, bob.id],
    });

    await agentGroupService.sendUserMessage({
      groupId: group.id,
      content: "@Alice please check this",
    });
    await vi.advanceTimersByTimeAsync(1001);
    await vi.waitFor(() => {
      expect(state.send).toHaveBeenCalledTimes(1);
    });
    expect(state.warn.mock.calls).toEqual([]);
    expect(state.send.mock.calls[0]?.[0]).toMatchObject({
      scope: { type: "project", projectId: alice.id },
      module: "main",
    });
    const sessions = await repositoryService.listChatSessions(
      { type: "project", projectId: alice.id },
      { includeHidden: true, kinds: ["group_runtime"] },
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].hidden).toBe(true);
    expect(sessions[0].metadataJson).toContain(group.id);
  });

  it("notifies mentioned agents sequentially so later agents see earlier group replies", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const { agentGroupService } = await import(
      "../../electron/main/services/agentGroupService"
    );
    const alice = await repositoryService.createProject({ name: "Alice" });
    const bob = await repositoryService.createProject({ name: "Bob" });
    const group = await agentGroupService.createGroup({ name: "Team" });
    await agentGroupService.addMembers({
      groupId: group.id,
      projectIds: [alice.id, bob.id],
    });

    state.send.mockImplementation(async (payload) => {
      const prompt = String(
        (payload as { message?: unknown }).message ?? "",
      );
      if (state.send.mock.calls.length === 1) {
        expect(prompt).not.toContain("Alice：Alice already checked.");
        await agentGroupService.sendAgentMessage({
          groupId: group.id,
          agentProjectId: alice.id,
          content: "Alice already checked.",
        });
      } else {
        const latestSection =
          prompt
            .split("# 最新的用户消息")[1]
            ?.split("# 更早的 20 条群消息：")[0] ?? "";
        const earlierSection = prompt.split("# 更早的 20 条群消息：")[1] ?? "";
        expect(latestSection.trim()).toBe("@Alice @Bob please check this");
        expect(earlierSection).toContain(
          "## Alice(2026-05-17T10:00:00.000Z)：\n\nAlice already checked.",
        );
      }
      return { assistantMessage: "", toolActions: [] };
    });

    await agentGroupService.sendUserMessage({
      groupId: group.id,
      content: "@Alice @Bob please check this",
    });
    await vi.advanceTimersByTimeAsync(1001);
    await vi.waitFor(() => {
      expect(state.send).toHaveBeenCalledTimes(2);
    });

    expect(state.send.mock.calls[0]?.[0]).toMatchObject({
      scope: { type: "project", projectId: alice.id },
    });
    expect(state.send.mock.calls[1]?.[0]).toMatchObject({
      scope: { type: "project", projectId: bob.id },
    });
  });

  it("passes image attachments from group messages to notified agents", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const { agentGroupService } = await import(
      "../../electron/main/services/agentGroupService"
    );
    const alice = await repositoryService.createProject({ name: "Alice" });
    const group = await agentGroupService.createGroup({ name: "Team" });
    await agentGroupService.addMembers({
      groupId: group.id,
      projectIds: [alice.id],
    });
    const imagePath = path.join(tempRoot, "sample.png");
    await fs.writeFile(imagePath, Buffer.from("fake-png"));

    await agentGroupService.sendUserMessage({
      groupId: group.id,
      content: `@Alice please read this\n\n@[image](${imagePath})`,
    });
    await vi.advanceTimersByTimeAsync(1001);
    await vi.waitFor(() => {
      expect(state.send).toHaveBeenCalledTimes(1);
    });

    expect(state.send.mock.calls[0]?.[0]).toMatchObject({
      attachments: [
        {
          name: "sample.png",
          path: imagePath,
          size: 8,
        },
      ],
    });
  });

  it("formats agent notifications with the latest user message and 20 earlier group messages", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const { agentGroupService } = await import(
      "../../electron/main/services/agentGroupService"
    );
    const alice = await repositoryService.createProject({ name: "Alice" });
    const group = await agentGroupService.createGroup({ name: "Team" });

    for (let index = 1; index <= 25; index += 1) {
      await agentGroupService.sendUserMessage({
        groupId: group.id,
        content: `message-${index}`,
      });
    }
    await vi.advanceTimersByTimeAsync(1001);

    await agentGroupService.addMembers({
      groupId: group.id,
      projectIds: [alice.id],
    });
    await agentGroupService.sendUserMessage({
      groupId: group.id,
      content: "@Alice please check the latest context",
    });
    await vi.advanceTimersByTimeAsync(1001);
    await vi.waitFor(() => {
      expect(state.send).toHaveBeenCalledTimes(1);
    });

    const prompt = String(state.send.mock.calls[0]?.[0]?.message ?? "");
    const latestSection =
      prompt
        .split("# 最新的用户消息")[1]
        ?.split("# 更早的 20 条群消息：")[0] ?? "";
    const earlierSection = prompt.split("# 更早的 20 条群消息：")[1] ?? "";
    expect(prompt).toContain("你收到了群聊消息。");
    expect(prompt).toContain("# 群信息");
    expect(prompt).toContain("- 群名称：Team");
    expect(prompt).toContain("- 群描述：暂无描述");
    expect(prompt).toContain("- 你是否被 @：是");
    expect(latestSection.trim()).toBe("@Alice please check the latest context");
    expect(earlierSection).not.toContain("message-5");
    expect(earlierSection).toContain(
      "## 用户(2026-05-17T10:00:00.000Z)：\n\nmessage-6",
    );
    expect(earlierSection).toContain(
      "## 用户(2026-05-17T10:00:00.000Z)：\n\nmessage-25",
    );
    expect(earlierSection).not.toContain("@Alice please check the latest context");
  });

  it("tracks typing agents while group notifications are running", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const { agentGroupService } = await import(
      "../../electron/main/services/agentGroupService"
    );
    const alice = await repositoryService.createProject({ name: "Alice" });
    const group = await agentGroupService.createGroup({ name: "Team" });
    await agentGroupService.addMembers({
      groupId: group.id,
      projectIds: [alice.id],
    });
    let finishSend: (() => void) | undefined;
    state.send.mockReturnValue(
      new Promise((resolve) => {
        finishSend = () => resolve({ assistantMessage: "", toolActions: [] });
      }),
    );
    const typingStates: string[][] = [];
    const unsubscribe = agentGroupService.onTypingUpdated((event) => {
      typingStates.push(event.agents.map((agent) => agent.agentName));
    });

    await agentGroupService.sendUserMessage({
      groupId: group.id,
      content: "@Alice please check this",
    });
    await vi.advanceTimersByTimeAsync(1001);
    await vi.waitFor(() => {
      expect(agentGroupService.getTypingState(group.id).agents).toMatchObject([
        { agentProjectId: alice.id, agentName: "Alice" },
      ]);
    });

    finishSend?.();
    await vi.waitFor(() => {
      expect(agentGroupService.getTypingState(group.id).agents).toEqual([]);
    });
    unsubscribe();
    expect(typingStates).toEqual([["Alice"], []]);
  });

  it("SendMessageToGroup writes an agent group message", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const { agentGroupService, createAgentGroupTools } = await import(
      "../../electron/main/services/agentGroupService"
    );
    const agent = await repositoryService.createProject({ name: "Alice" });
    const group = await agentGroupService.createGroup({ name: "Team" });
    await agentGroupService.addMembers({
      groupId: group.id,
      projectIds: [agent.id],
    });

    const sendTool = createAgentGroupTools({
      groupId: group.id,
      agentProjectId: agent.id,
    }).find((tool) => tool.name === "SendMessageToGroup");
    await sendTool?.handler({ content: "I can help." });

    const page = await agentGroupService.listMessages({
      groupId: group.id,
      limit: 5,
    });
    expect(page.messages).toMatchObject([
      {
        senderType: "agent",
        senderAgentId: agent.id,
        senderAgentName: "Alice",
        content: "I can help.",
      },
    ]);
  });

  it("keeps group runtime tools scoped to the current group", async () => {
    const { createAgentGroupTools } = await import(
      "../../electron/main/services/agentGroupService"
    );

    const toolNames = createAgentGroupTools({
      groupId: "g-current",
      agentProjectId: "agent-a",
    }).map((tool) => tool.name);

    expect(toolNames).toEqual([
      "ListGroupMembers",
      "ListGroupMessages",
      "SendMessageToGroup",
    ]);
  });
});
