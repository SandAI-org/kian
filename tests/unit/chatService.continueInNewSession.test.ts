import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  duplicateChatSessionUpToMessage: vi.fn(),
  deleteChatSession: vi.fn(),
  forkSessionContext: vi.fn(),
  emitAppOperation: vi.fn(),
  emitHistoryUpdated: vi.fn(),
  emitQueueUpdated: vi.fn(),
  emitStream: vi.fn(),
  getClaudeStatus: vi.fn(),
  getClaudeSecret: vi.fn(),
  resolveAgentModel: vi.fn(),
  completeSimple: vi.fn(),
}));

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: {
    duplicateChatSessionUpToMessage: (...args: unknown[]) =>
      state.duplicateChatSessionUpToMessage(...args),
    deleteChatSession: (...args: unknown[]) => state.deleteChatSession(...args),
  },
}));

vi.mock("../../electron/main/services/agentService", () => ({
  agentService: {
    forkSessionContext: (...args: unknown[]) =>
      state.forkSessionContext(...args),
  },
}));

vi.mock("../../electron/main/services/appOperationEvents", () => ({
  appOperationEvents: {
    emit: (...args: unknown[]) => state.emitAppOperation(...args),
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
  sessionId: "session-new",
  role,
  content,
  createdAt: "2026-07-20T00:00:00.000Z",
});

const newSession = {
  id: "session-new",
  scopeType: "main" as const,
  module: "main" as const,
  kind: "normal" as const,
  hidden: false,
  title: "旧标题",
  sdkSessionId: null,
  metadataJson: null,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

describe("chatService.continueInNewSession", () => {
  beforeEach(() => {
    vi.resetModules();
    state.duplicateChatSessionUpToMessage.mockReset().mockResolvedValue({
      session: newSession,
      copiedMessages: [
        buildMessage("c1", "user", "第一句"),
        buildMessage("c2", "assistant", "第一句的回复"),
        buildMessage("c3", "user", "第二句"),
        buildMessage("c4", "assistant", "第二句的回复"),
      ],
      nextUserMessageText: "第三句",
    });
    state.deleteChatSession.mockReset().mockResolvedValue(undefined);
    state.forkSessionContext.mockReset().mockResolvedValue(true);
    state.emitAppOperation.mockReset();
    state.emitHistoryUpdated.mockReset();
    state.emitQueueUpdated.mockReset();
    state.emitStream.mockReset();
    state.getClaudeStatus.mockReset();
    state.getClaudeSecret.mockReset();
    state.resolveAgentModel.mockReset();
    state.completeSimple.mockReset();
  });

  it("duplicates the history, forks agent context, and opens the new session", async () => {
    const { chatService } = await import(
      "../../electron/main/services/chatService"
    );

    const session = await chatService.continueInNewSession({
      scope: { type: "main" },
      sessionId: "session-1",
      messageId: "m4",
    });

    expect(session).toEqual(newSession);
    expect(state.duplicateChatSessionUpToMessage).toHaveBeenCalledWith({
      scope: { type: "main" },
      sessionId: "session-1",
      messageId: "m4",
    });
    expect(state.forkSessionContext).toHaveBeenCalledWith({
      scope: { type: "main" },
      sourceSessionId: "session-1",
      targetSessionId: "session-new",
      keepUserMessageCount: 2,
      nextUserMessageText: "第三句",
    });
    expect(state.emitAppOperation).toHaveBeenCalledWith({
      type: "open_chat_session",
      scope: { type: "main" },
      sessionId: "session-new",
      module: "main",
    });
    expect(state.deleteChatSession).not.toHaveBeenCalled();
  });

  it("rolls back the new session when forking the agent context fails", async () => {
    state.forkSessionContext
      .mockReset()
      .mockRejectedValue(new Error("fork 失败"));
    const { chatService } = await import(
      "../../electron/main/services/chatService"
    );

    await expect(
      chatService.continueInNewSession({
        scope: { type: "main" },
        sessionId: "session-1",
        messageId: "m4",
      }),
    ).rejects.toThrow("fork 失败");
    expect(state.deleteChatSession).toHaveBeenCalledWith({
      scope: { type: "main" },
      sessionId: "session-new",
    });
    expect(state.emitAppOperation).not.toHaveBeenCalled();
  });

  it("propagates duplication errors without forking or navigating", async () => {
    state.duplicateChatSessionUpToMessage
      .mockReset()
      .mockRejectedValue(new Error("消息不存在"));
    const { chatService } = await import(
      "../../electron/main/services/chatService"
    );

    await expect(
      chatService.continueInNewSession({
        scope: { type: "main" },
        sessionId: "session-1",
        messageId: "missing",
      }),
    ).rejects.toThrow("消息不存在");
    expect(state.forkSessionContext).not.toHaveBeenCalled();
    expect(state.emitAppOperation).not.toHaveBeenCalled();
    expect(state.deleteChatSession).not.toHaveBeenCalled();
  });
});
