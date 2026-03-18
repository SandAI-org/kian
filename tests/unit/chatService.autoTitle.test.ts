import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  getChatSession: vi.fn(),
  listMessages: vi.fn(),
  updateChatSessionTitle: vi.fn(),
  agentSend: vi.fn(),
  getClaudeStatus: vi.fn(),
  getClaudeSecret: vi.fn(),
  resolveAgentModel: vi.fn(),
  emitHistoryUpdated: vi.fn(),
  completeSimple: vi.fn(),
}));

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: {
    appendMessage: (...args: unknown[]) => state.appendMessage(...args),
    getChatSession: (...args: unknown[]) => state.getChatSession(...args),
    listMessages: (...args: unknown[]) => state.listMessages(...args),
    updateChatSessionTitle: (...args: unknown[]) =>
      state.updateChatSessionTitle(...args),
  },
}));

vi.mock("../../electron/main/services/agentService", () => ({
  agentService: {
    send: (...args: unknown[]) => state.agentSend(...args),
  },
}));

vi.mock("../../electron/main/services/settingsService", () => ({
  settingsService: {
    getClaudeStatus: (...args: unknown[]) => state.getClaudeStatus(...args),
    getClaudeSecret: (...args: unknown[]) => state.getClaudeSecret(...args),
    resolveAgentModel: (...args: unknown[]) => state.resolveAgentModel(...args),
  },
}));

vi.mock("../../electron/main/services/chatEvents", () => ({
  chatEvents: {
    emitHistoryUpdated: (...args: unknown[]) => state.emitHistoryUpdated(...args),
  },
}));

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: (...args: unknown[]) => state.completeSimple(...args),
}));

vi.mock("../../electron/main/services/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/mediaMarkdown", () => ({
  buildExtendedMarkdown: vi.fn(),
  detectAttachmentMarkdownKind: vi.fn(),
  normalizeMediaMarkdownInText: (text: string) => text,
  resolveAttachmentAbsolutePath: vi.fn(),
}));

describe("chatService auto title", () => {
  beforeEach(() => {
    vi.resetModules();
    state.appendMessage.mockReset().mockResolvedValue(undefined);
    state.getChatSession.mockReset().mockResolvedValue({
      id: "session-1",
      title: "",
    });
    state.listMessages.mockReset().mockResolvedValue([
      {
        id: "m-user-1",
        sessionId: "session-1",
        role: "user",
        content: "帮我整理一下这次迭代要做的任务",
        createdAt: "2026-03-14T00:00:00.000Z",
      },
      {
        id: "m-assistant-1",
        sessionId: "session-1",
        role: "assistant",
        content: "这次迭代可以分成需求梳理 开发排期 风险评估 三部分",
        createdAt: "2026-03-14T00:00:01.000Z",
      },
    ]);
    state.updateChatSessionTitle.mockReset().mockResolvedValue(undefined);
    state.agentSend.mockReset().mockResolvedValue({
      assistantMessage: "好的，开始处理。",
      toolActions: [],
    });
    state.getClaudeStatus.mockReset().mockResolvedValue({
      providers: {
        anthropic: {
          configured: true,
          enabled: true,
          apiKey: "test-key",
          enabledModels: ["claude-3-7-sonnet"],
        },
      },
      allEnabledModels: [
        {
          provider: "anthropic",
          modelId: "claude-3-7-sonnet",
          modelName: "Claude 3.7 Sonnet",
        },
      ],
      lastSelectedModel: undefined,
      lastSelectedThinkingLevel: "medium",
    });
    state.getClaudeSecret.mockReset().mockResolvedValue("test-key");
    state.resolveAgentModel
      .mockReset()
      .mockResolvedValue({ id: "mock-model" });
    state.emitHistoryUpdated.mockReset();
    state.completeSimple.mockReset().mockResolvedValue({
      content: [{ type: "text", text: "自动标题" }],
    });
  });

  it("uses payload.model when lastSelectedModel is not persisted", async () => {
    state.getChatSession
      .mockReset()
      .mockResolvedValueOnce({
        id: "session-1",
        title: "",
      })
      .mockResolvedValueOnce({
        id: "session-1",
        title: "帮我整理一下这次迭代要做的任务",
      });

    const { chatService } = await import("../../electron/main/services/chatService");

    await chatService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-1",
      message: "帮我整理一下这次迭代要做的任务",
      model: "anthropic:claude-3-7-sonnet",
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (state.updateChatSessionTitle.mock.calls.length >= 2) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(state.completeSimple).toHaveBeenCalledTimes(1);
    expect(state.resolveAgentModel).toHaveBeenCalledWith(
      "anthropic",
      "claude-3-7-sonnet",
    );
    expect(state.completeSimple.mock.calls[0]?.[1]).toMatchObject({
      messages: [
        {
          role: "user",
          content:
            "用户首轮消息：帮我整理一下这次迭代要做的任务\n\n助手首轮回复：这次迭代可以分成需求梳理 开发排期 风险评估 三部分",
        },
      ],
    });
    expect(state.updateChatSessionTitle).toHaveBeenCalledWith({
      scope: { type: "main" },
      sessionId: "session-1",
      title: "帮我整理一下这次迭代要做的任务",
    });
    expect(state.updateChatSessionTitle).toHaveBeenCalledWith({
      scope: { type: "main" },
      sessionId: "session-1",
      title: "自动标题",
    });
  });

  it("skips title update when title generation fails", async () => {
    state.completeSimple.mockReset().mockRejectedValue(new Error("rate limited"));
    state.getChatSession
      .mockReset()
      .mockResolvedValueOnce({
        id: "session-1",
        title: "",
      })
      .mockResolvedValueOnce({
        id: "session-1",
        title: "给我讲一个冷笑话",
      });

    const { chatService } = await import("../../electron/main/services/chatService");

    await chatService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-2",
      message: "给我讲一个冷笑话",
      model: "anthropic:claude-3-7-sonnet",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.updateChatSessionTitle).toHaveBeenCalledTimes(1);
    expect(state.updateChatSessionTitle).toHaveBeenCalledWith({
      scope: { type: "main" },
      sessionId: "session-1",
      title: "给我讲一个冷笑话",
    });
  });
});
