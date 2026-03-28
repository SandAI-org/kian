import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  getChatSession: vi.fn(),
  listMessages: vi.fn(),
  updateChatSessionTitle: vi.fn(),
  agentSend: vi.fn(),
  agentInterrupt: vi.fn(),
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
    updateChatSessionTitle: (...args: unknown[]) =>
      state.updateChatSessionTitle(...args),
  },
}));

vi.mock("../../electron/main/services/agentService", () => ({
  agentService: {
    send: (...args: unknown[]) => state.agentSend(...args),
    interrupt: (...args: unknown[]) => state.agentInterrupt(...args),
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

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
};

describe("chatService queue orchestration", () => {
  beforeEach(() => {
    vi.resetModules();
    state.appendMessage.mockReset().mockResolvedValue(undefined);
    state.getChatSession.mockReset().mockResolvedValue({
      id: "session-1",
      title: "已有标题",
    });
    state.listMessages.mockReset().mockResolvedValue([]);
    state.updateChatSessionTitle.mockReset().mockResolvedValue(undefined);
    state.agentSend.mockReset().mockResolvedValue({
      assistantMessage: "处理完成",
      toolActions: [],
    });
    state.agentInterrupt.mockReset().mockResolvedValue(false);
    state.getClaudeStatus.mockReset().mockResolvedValue({
      providers: {},
      allEnabledModels: [],
      lastSelectedModel: undefined,
      lastSelectedThinkingLevel: "medium",
    });
    state.getClaudeSecret.mockReset().mockResolvedValue("");
    state.resolveAgentModel.mockReset().mockResolvedValue(undefined);
    state.emitHistoryUpdated.mockReset();
    state.emitQueueUpdated.mockReset();
    state.emitStream.mockReset();
    state.completeSimple.mockReset();
  });

  it("returns an immediate renderer ack with a generated requestId and persists the turn", async () => {
    const { chatService } = await import("../../electron/main/services/chatService");

    const ack = await chatService.sendFromRenderer({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      message: "直接发送",
    });

    expect(ack.queued).toBe(false);
    expect(ack.requestId).toEqual(expect.any(String));
    expect(ack.requestId.length).toBeGreaterThan(0);

    await vi.waitFor(() => {
      expect(state.appendMessage).toHaveBeenCalledTimes(2);
    });

    expect(state.appendMessage.mock.calls[0]?.[0]).toMatchObject({
      role: "user",
      content: "直接发送",
      metadataJson: expect.stringContaining(`"requestId":"${ack.requestId}"`),
    });
    expect(state.appendMessage.mock.calls[1]?.[0]).toMatchObject({
      role: "assistant",
      content: "处理完成",
    });
    expect(state.emitStream).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: ack.requestId,
        sessionId: "session-1",
        type: "request_started",
      }),
    );
  });

  it("interrupts only the targeted queued request and keeps later queued items", async () => {
    const rootDeferred = createDeferred<{
      assistantMessage: string;
      toolActions: string[];
    }>();
    state.agentSend.mockReset().mockImplementation(async (payload) => {
      if (
        payload &&
        typeof payload === "object" &&
        "requestId" in payload &&
        payload.requestId === "req-root"
      ) {
        return rootDeferred.promise;
      }
      return {
        assistantMessage: `完成 ${String((payload as { requestId?: string }).requestId ?? "")}`.trim(),
        toolActions: [],
      };
    });

    const { chatService } = await import("../../electron/main/services/chatService");

    const rootPromise = chatService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-root",
      message: "先处理当前请求",
    });

    await vi.waitFor(() => {
      expect(state.agentSend).toHaveBeenCalledTimes(1);
    });

    const queuedToCancel = chatService.dispatch({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-queued-1",
      message: "取消这一条",
    });
    const queuedToKeep = chatService.dispatch({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-queued-2",
      message: "保留这一条",
      skipUserMessagePersistence: true,
    });

    expect(queuedToCancel.queued).toBe(true);
    expect(queuedToKeep.queued).toBe(true);
    expect(chatService.getQueuedMessages({ type: "main" }, "session-1")).toEqual([
      expect.objectContaining({
        requestId: "req-queued-1",
        content: "取消这一条",
        persistUserMessage: true,
      }),
      expect.objectContaining({
        requestId: "req-queued-2",
        content: "保留这一条",
        persistUserMessage: false,
      }),
    ]);

    await expect(
      chatService.interrupt({
        scope: { type: "main" },
        sessionId: "session-1",
        requestId: "req-queued-1",
      }),
    ).resolves.toBe(true);

    await expect(queuedToCancel.completion).rejects.toThrow("已取消排队消息");
    expect(chatService.getQueuedMessages({ type: "main" }, "session-1")).toEqual([
      expect.objectContaining({
        requestId: "req-queued-2",
        persistUserMessage: false,
      }),
    ]);
    expect(state.agentInterrupt).toHaveBeenCalledWith({
      scope: { type: "main" },
      sessionId: "session-1",
      requestId: "req-queued-1",
    });

    rootDeferred.resolve({
      assistantMessage: "根请求完成",
      toolActions: [],
    });

    await expect(rootPromise).resolves.toEqual({
      assistantMessage: "根请求完成",
      toolActions: [],
    });
    await expect(queuedToKeep.completion).resolves.toEqual({
      assistantMessage: "完成 req-queued-2",
      toolActions: [],
    });

    expect(
      state.appendMessage.mock.calls.some(
        ([input]) =>
          input.role === "user" &&
          String(input.metadataJson).includes('"requestId":"req-queued-2"'),
      ),
    ).toBe(false);
  });
});
