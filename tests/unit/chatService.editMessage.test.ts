import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  getChatSession: vi.fn(),
  listMessages: vi.fn(),
  truncateChatMessagesFrom: vi.fn(),
  updateChatSessionTitle: vi.fn(),
  agentSend: vi.fn(),
  agentInterrupt: vi.fn(),
  rewindToUserMessage: vi.fn(),
  getClaudeStatus: vi.fn(),
  getClaudeSecret: vi.fn(),
  resolveAgentModel: vi.fn(),
  emitHistoryUpdated: vi.fn(),
  emitQueueUpdated: vi.fn(),
  emitStream: vi.fn(),
  completeSimple: vi.fn(),
}));

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: {
    appendMessage: (...args: unknown[]) => state.appendMessage(...args),
    getChatSession: (...args: unknown[]) => state.getChatSession(...args),
    listMessages: (...args: unknown[]) => state.listMessages(...args),
    truncateChatMessagesFrom: (...args: unknown[]) =>
      state.truncateChatMessagesFrom(...args),
    updateChatSessionTitle: (...args: unknown[]) =>
      state.updateChatSessionTitle(...args),
  },
}));

vi.mock("../../electron/main/services/agentService", () => ({
  agentService: {
    send: (...args: unknown[]) => state.agentSend(...args),
    interrupt: (...args: unknown[]) => state.agentInterrupt(...args),
    rewindToUserMessage: (...args: unknown[]) =>
      state.rewindToUserMessage(...args),
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
    emitQueueUpdated: (...args: unknown[]) => state.emitQueueUpdated(...args),
    emitStream: (...args: unknown[]) => state.emitStream(...args),
  },
}));

vi.mock("@earendil-works/pi-ai/compat", () => ({
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

const buildMessage = (
  id: string,
  role: "user" | "assistant",
  content: string,
) => ({
  id,
  sessionId: "session-1",
  role,
  content,
  createdAt: "2026-07-20T00:00:00.000Z",
});

describe("chatService.editMessage", () => {
  beforeEach(() => {
    vi.resetModules();
    state.appendMessage.mockReset().mockResolvedValue(undefined);
    state.getChatSession.mockReset().mockResolvedValue({
      id: "session-1",
      title: "已有标题",
    });
    state.listMessages.mockReset().mockResolvedValue([
      buildMessage("m1", "user", "第一句"),
      buildMessage("m2", "assistant", "第一句的回复"),
      buildMessage("m3", "user", "第二句"),
      buildMessage("m4", "assistant", "第二句的回复"),
    ]);
    state.truncateChatMessagesFrom.mockReset().mockResolvedValue(true);
    state.agentSend.mockReset().mockResolvedValue({
      assistantMessage: "处理完成",
      toolActions: [],
    });
    state.agentInterrupt.mockReset().mockResolvedValue(false);
    state.rewindToUserMessage.mockReset().mockResolvedValue(undefined);
    state.getClaudeStatus.mockReset().mockResolvedValue({
      providers: {},
      allEnabledModels: [],
      lastSelectedModel: undefined,
      lastSelectedThinkingLevel: "medium",
    });
    state.getClaudeSecret.mockReset().mockResolvedValue("");
    state.resolveAgentModel.mockReset().mockResolvedValue(undefined);
    state.updateChatSessionTitle.mockReset().mockResolvedValue(undefined);
    state.emitHistoryUpdated.mockReset();
    state.emitQueueUpdated.mockReset();
    state.emitStream.mockReset();
    state.completeSimple.mockReset();
  });

  it("rewinds the agent session, truncates history, then resends the edited text", async () => {
    const { chatService } = await import(
      "../../electron/main/services/chatService"
    );

    const ack = await chatService.editMessage({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      editTargetMessageId: "m1",
      message: "修改后的第一句",
    });

    expect(ack.requestId).toEqual(expect.any(String));
    expect(state.rewindToUserMessage).toHaveBeenCalledWith({
      scope: { type: "main" },
      sessionId: "session-1",
      userMessageIndexFromEnd: 1,
      expectedText: "第一句",
    });
    expect(state.truncateChatMessagesFrom).toHaveBeenCalledWith({
      scope: { type: "main" },
      sessionId: "session-1",
      messageId: "m1",
    });

    await vi.waitFor(() => {
      expect(state.agentSend).toHaveBeenCalledTimes(1);
    });
    const sentPayload = state.agentSend.mock.calls[0]?.[0] as {
      message: string;
      editTargetMessageId?: string;
    };
    expect(sentPayload.message).toBe("修改后的第一句");
    expect(sentPayload.editTargetMessageId).toBeUndefined();

    await vi.waitFor(() => {
      expect(state.appendMessage).toHaveBeenCalled();
    });
    expect(state.appendMessage.mock.calls[0]?.[0]).toMatchObject({
      role: "user",
      content: "修改后的第一句",
    });
  });

  it("rejects when the target message is not a user message", async () => {
    const { chatService } = await import(
      "../../electron/main/services/chatService"
    );

    await expect(
      chatService.editMessage({
        scope: { type: "main" },
        module: "main",
        sessionId: "session-1",
        editTargetMessageId: "m2",
        message: "改写",
      }),
    ).rejects.toThrow("找不到要编辑的消息");
    expect(state.rewindToUserMessage).not.toHaveBeenCalled();
    expect(state.truncateChatMessagesFrom).not.toHaveBeenCalled();
  });

  it("does not truncate display history when the agent rewind fails", async () => {
    state.rewindToUserMessage
      .mockReset()
      .mockRejectedValue(new Error("会话恢复失败"));
    const { chatService } = await import(
      "../../electron/main/services/chatService"
    );

    await expect(
      chatService.editMessage({
        scope: { type: "main" },
        module: "main",
        sessionId: "session-1",
        editTargetMessageId: "m3",
        message: "改写",
      }),
    ).rejects.toThrow("会话恢复失败");
    expect(state.truncateChatMessagesFrom).not.toHaveBeenCalled();
    expect(state.agentSend).not.toHaveBeenCalled();
  });
});
