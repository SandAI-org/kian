import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  getChatSession: vi.fn(),
  updateChatSessionTitle: vi.fn(),
  agentSend: vi.fn(),
}));

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: {
    appendMessage: (...args: unknown[]) => state.appendMessage(...args),
    getChatSession: (...args: unknown[]) => state.getChatSession(...args),
    updateChatSessionTitle: (...args: unknown[]) =>
      state.updateChatSessionTitle(...args),
  },
}));

vi.mock("../../electron/main/services/agentService", () => ({
  agentService: {
    send: (...args: unknown[]) => state.agentSend(...args),
  },
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

describe("chatService timeline persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    state.appendMessage.mockReset().mockResolvedValue(undefined);
    state.getChatSession.mockReset().mockResolvedValue({
      id: "session-1",
      title: "",
    });
    state.updateChatSessionTitle.mockReset().mockResolvedValue(undefined);
    state.agentSend.mockReset().mockImplementation(async (_payload, onStream) => {
      onStream?.({
        requestId: "req-1",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "thinking_delta",
        delta: "先分析需求",
        createdAt: "2026-03-10T00:00:00.500Z",
      });
      onStream?.({
        requestId: "req-1",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "tool_start",
        toolUseId: "tool-1",
        toolName: "callSubAgent",
        createdAt: "2026-03-10T00:00:01.000Z",
      });
      onStream?.({
        requestId: "req-1",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "tool_output",
        toolUseId: "tool-1",
        toolName: "callSubAgent",
        output: "已委派",
        createdAt: "2026-03-10T00:00:02.000Z",
      });
      onStream?.({
        requestId: "req-1",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "assistant_delta",
        delta: "处理完成",
        createdAt: "2026-03-10T00:00:03.000Z",
      });

      return {
        assistantMessage: "处理完成",
        toolActions: [],
      };
    });
  });

  it("persists stream-derived timestamps for tool and assistant messages", async () => {
    const { chatService } = await import("../../electron/main/services/chatService");

    await chatService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-1",
      message: "帮我委派任务",
    });

    expect(state.appendMessage).toHaveBeenCalledTimes(4);
    expect(state.appendMessage.mock.calls[1]?.[0]).toMatchObject({
      role: "system",
      createdAt: "2026-03-10T00:00:00.500Z",
      metadataJson: expect.stringContaining('"kind":"thinking"'),
    });
    expect(state.appendMessage.mock.calls[2]?.[0]).toMatchObject({
      role: "tool",
      createdAt: "2026-03-10T00:00:01.000Z",
    });
    expect(state.appendMessage.mock.calls[3]?.[0]).toMatchObject({
      role: "assistant",
      createdAt: "2026-03-10T00:00:03.000Z",
    });
  });

  it("persists interleaved thinking deltas as separate thinking messages", async () => {
    state.appendMessage.mockReset().mockResolvedValue(undefined);
    state.agentSend.mockReset().mockImplementation(async (_payload, onStream) => {
      onStream?.({
        requestId: "req-2",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "thinking_delta",
        delta: "第一段思考",
        createdAt: "2026-03-10T00:00:00.500Z",
      });
      onStream?.({
        requestId: "req-2",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "assistant_delta",
        delta: "先说结论。",
        createdAt: "2026-03-10T00:00:01.000Z",
      });
      onStream?.({
        requestId: "req-2",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "thinking_delta",
        delta: "第二段思考",
        createdAt: "2026-03-10T00:00:01.500Z",
      });
      onStream?.({
        requestId: "req-2",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "assistant_delta",
        delta: "再补一句。",
        createdAt: "2026-03-10T00:00:02.000Z",
      });

      return {
        assistantMessage: "先说结论。再补一句。",
        toolActions: [],
      };
    });

    const { chatService } = await import("../../electron/main/services/chatService");

    await chatService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-2",
      message: "解释一下",
    });

    const thinkingMessages = state.appendMessage.mock.calls
      .map((call) => call[0])
      .filter(
        (message) =>
          message.role === "system" &&
          String(message.metadataJson).includes('"kind":"thinking"'),
      );

    expect(thinkingMessages).toHaveLength(2);
    expect(thinkingMessages[0]).toMatchObject({
      content: "第一段思考",
      createdAt: "2026-03-10T00:00:00.500Z",
    });
    expect(thinkingMessages[1]).toMatchObject({
      content: "第二段思考",
      createdAt: "2026-03-10T00:00:01.500Z",
    });
  });

  it("ignores queued turn stream events from a different requestId", async () => {
    state.appendMessage.mockReset().mockResolvedValue(undefined);
    state.agentSend.mockReset().mockImplementation(async (_payload, onStream) => {
      onStream?.({
        requestId: "req-root",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "assistant_delta",
        delta: "根请求回复",
        createdAt: "2026-03-10T00:00:01.000Z",
      });
      onStream?.({
        requestId: "req-queued",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "assistant_delta",
        delta: "排队请求回复",
        createdAt: "2026-03-10T00:00:02.000Z",
      });

      return {
        assistantMessage: "根请求回复",
        toolActions: [],
      };
    });

    const { chatService } = await import("../../electron/main/services/chatService");

    await chatService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-root",
      message: "处理主请求",
    });

    const persistedAssistantMessages = state.appendMessage.mock.calls
      .map((call) => call[0])
      .filter((message) => message.role === "assistant");

    expect(persistedAssistantMessages).toHaveLength(1);
    expect(persistedAssistantMessages[0]?.content).toBe("根请求回复");
  });
});
