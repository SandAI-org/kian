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

    expect(state.appendMessage).toHaveBeenCalledTimes(3);
    expect(state.appendMessage.mock.calls[1]?.[0]).toMatchObject({
      role: "tool",
      createdAt: "2026-03-10T00:00:01.000Z",
    });
    expect(state.appendMessage.mock.calls[2]?.[0]).toMatchObject({
      role: "assistant",
      createdAt: "2026-03-10T00:00:03.000Z",
    });
  });
});
