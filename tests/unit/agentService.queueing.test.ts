import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspaceRoot: "/tmp/kian-agent-queueing",
  appendMessage: vi.fn(),
  getChatSession: vi.fn(),
  setChatSessionSdkSessionId: vi.fn(),
  resolveAgentModel: vi.fn(),
  continueRecent: vi.fn(),
  createSessionManager: vi.fn(),
  getClaudeStatus: vi.fn(),
  getMcpServers: vi.fn(),
  getAgentSystemPrompt: vi.fn(),
  getClaudeSecret: vi.fn(),
  listActiveSkillsForScope: vi.fn(),
  buildSessionSystemPrompt: vi.fn(),
  buildMcpServerSignature: vi.fn(),
  createMcpRuntime: vi.fn(),
  createAgentSession: vi.fn(),
  prompt: vi.fn(),
  sendUserMessage: vi.fn(),
  sendCustomMessage: vi.fn(),
  followUp: vi.fn(),
  abort: vi.fn(),
  clearQueue: vi.fn(),
  sessionListener: undefined as
    | ((event: {
        type: string;
        message?: unknown;
        assistantMessageEvent?: unknown;
      }) => void)
    | undefined,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock("@mariozechner/pi-ai", () => ({
  Type: {
    Object: (value: unknown) => value,
    Optional: (value: unknown) => value,
    String: (value: unknown) => value,
    Union: (value: unknown) => value,
    Literal: (value: unknown) => value,
    Array: (value: unknown) => value,
  },
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: {
    inMemory: () => ({
      setRuntimeApiKey: vi.fn(),
    }),
  },
  createAgentSession: (...args: unknown[]) => state.createAgentSession(...args),
  createCodingTools: () => [],
  DefaultResourceLoader: class {
    async reload(): Promise<void> {}
    getSkills(): { skills: never[] } {
      return { skills: [] };
    }
  },
  SessionManager: {
    continueRecent: (...args: unknown[]) => state.continueRecent(...args),
    create: (...args: unknown[]) => state.createSessionManager(...args),
  },
}));

vi.mock("../../electron/main/services/workspacePaths", () => ({
  get GLOBAL_CONFIG_DIR() {
    return path.join(state.workspaceRoot, ".global");
  },
  get WORKSPACE_ROOT() {
    return state.workspaceRoot;
  },
  get INTERNAL_ROOT() {
    return path.join(state.workspaceRoot, ".kian");
  },
}));

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: {
    appendMessage: (...args: unknown[]) => state.appendMessage(...args),
    getChatSession: (...args: unknown[]) => state.getChatSession(...args),
    setChatSessionSdkSessionId: (...args: unknown[]) =>
      state.setChatSessionSdkSessionId(...args),
  },
}));

vi.mock("../../electron/main/services/settingsService", () => ({
  settingsService: {
    getClaudeStatus: (...args: unknown[]) => state.getClaudeStatus(...args),
    getMcpServers: (...args: unknown[]) => state.getMcpServers(...args),
    getAgentSystemPrompt: (...args: unknown[]) =>
      state.getAgentSystemPrompt(...args),
    getClaudeSecret: (...args: unknown[]) => state.getClaudeSecret(...args),
    resolveAgentModel: (...args: unknown[]) => state.resolveAgentModel(...args),
  },
}));

vi.mock("../../electron/main/services/skillService", () => ({
  skillService: {
    listActiveSkillsForScope: (...args: unknown[]) =>
      state.listActiveSkillsForScope(...args),
  },
}));

vi.mock("../../electron/main/services/agentPrompt", () => ({
  buildSessionSystemPrompt: (...args: unknown[]) =>
    state.buildSessionSystemPrompt(...args),
}));

vi.mock("../../electron/main/services/appOperationMcpServer", () => ({
  createAppOperationTools: () => [],
}));

vi.mock("../../electron/main/services/builtinMcpServer", () => ({
  createBuiltinTools: () => [],
}));

vi.mock("../../electron/main/services/customTools", () => ({
  toToolDefinition: (tool: unknown) => tool,
}));

vi.mock("../../electron/main/services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/mediaMarkdown", () => ({
  buildExtendedMarkdown: vi.fn(),
  buildMediaMarkdown: vi.fn(),
  detectAttachmentMediaKind: vi.fn(),
  detectAttachmentMarkdownKind: vi.fn(),
  normalizeMediaMarkdownInText: (text: string) => text,
  resolveAttachmentAbsolutePath: vi.fn(),
}));

vi.mock("../../electron/main/services/mcpRuntime", () => ({
  buildMcpServerSignature: (...args: unknown[]) =>
    state.buildMcpServerSignature(...args),
  createMcpRuntime: (...args: unknown[]) => state.createMcpRuntime(...args),
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

describe("agentService queued delivery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T08:00:00.000Z"));
    state.sessionListener = undefined;
    state.appendMessage.mockReset().mockResolvedValue(undefined);
    state.getChatSession.mockReset().mockResolvedValue(null);
    state.setChatSessionSdkSessionId.mockReset().mockResolvedValue(undefined);
    state.resolveAgentModel.mockReset().mockResolvedValue({
      provider: "anthropic",
      id: "claude-test",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      name: "Claude Test",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    });
    state.continueRecent.mockReset().mockReturnValue({
      buildSessionContext: () => ({ model: null }),
    });
    state.createSessionManager.mockReset().mockReturnValue({
      buildSessionContext: () => ({ model: null }),
    });
    state.getClaudeStatus.mockReset().mockResolvedValue({
      allEnabledModels: [{ provider: "anthropic", modelId: "claude-test" }],
      providers: {
        anthropic: {
          apiKey: "test-key",
        },
      },
    });
    state.getMcpServers.mockReset().mockResolvedValue([]);
    state.getAgentSystemPrompt.mockReset().mockResolvedValue("system prompt");
    state.getClaudeSecret.mockReset().mockResolvedValue("");
    state.listActiveSkillsForScope.mockReset().mockResolvedValue([]);
    state.buildSessionSystemPrompt
      .mockReset()
      .mockImplementation((prompt) => prompt);
    state.buildMcpServerSignature.mockReset().mockReturnValue("mcp-signature");
    state.createMcpRuntime.mockReset().mockResolvedValue({
      tools: [],
      warnings: [],
      dispose: vi.fn().mockResolvedValue(undefined),
    });
    state.prompt.mockReset().mockResolvedValue(undefined);
    state.sendUserMessage.mockReset().mockResolvedValue(undefined);
    state.sendCustomMessage.mockReset().mockResolvedValue(undefined);
    state.followUp.mockReset().mockResolvedValue(undefined);
    state.abort.mockReset().mockResolvedValue(undefined);
    state.clearQueue.mockReset();
    state.createAgentSession.mockReset().mockImplementation(async () => ({
      session: {
        sessionId: "sdk-session-1",
        subscribe: (
          listener: (event: { type: string; message?: unknown; assistantMessageEvent?: unknown }) => void,
        ) => {
          state.sessionListener = listener;
          return () => {
            state.sessionListener = undefined;
          };
        },
        setThinkingLevel: vi.fn(),
        sendCustomMessage: (...args: unknown[]) => state.sendCustomMessage(...args),
        followUp: (...args: unknown[]) => state.followUp(...args),
        prompt: (...args: unknown[]) => state.prompt(...args),
        sendUserMessage: (...args: unknown[]) => state.sendUserMessage(...args),
        abort: (...args: unknown[]) => state.abort(...args),
        clearQueue: (...args: unknown[]) => state.clearQueue(...args),
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues a steer message into the active session and persists it when consumed", async () => {
    const { agentService } = await import("../../electron/main/services/agentService");
    const streamEvents: Array<{ requestId: string; type: string }> = [];

    const sendPromise = agentService.send(
      {
        scope: { type: "main" },
        module: "main",
        sessionId: "session-1",
        requestId: "req-root",
        message: "先处理当前任务",
      },
      (event) => {
        streamEvents.push({ requestId: event.requestId, type: event.type });
      },
    );

    await vi.waitFor(() => {
      expect(state.sessionListener).toBeTypeOf("function");
    });

    await agentService.queueMessage({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-queued",
      message: "改成新的方向",
      deliveryMode: "steer",
    });

    expect(state.prompt.mock.calls[1]).toEqual([
      "改成新的方向",
      { streamingBehavior: "steer" },
    ]);

    state.sessionListener?.({
      type: "message_start",
      message: {
        role: "user",
        timestamp: "2026-03-22T07:00:00.000Z",
        content: [{ type: "text", text: "改成新的方向" }],
      },
    });
    state.sessionListener?.({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "已按新方向处理",
      },
    });
    state.sessionListener?.({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "已按新方向处理" }],
      },
    });
    state.sessionListener?.({
      type: "agent_end",
    });

    await sendPromise;

    const queuedUserCall = state.appendMessage.mock.calls.find(
      ([message]) => message.role === "user",
    )?.[0];

    expect(queuedUserCall).toMatchObject({
      role: "user",
      content: "改成新的方向",
      metadataJson: expect.stringContaining('"requestId":"req-queued"'),
    });
    expect(queuedUserCall?.createdAt).not.toBe("2026-03-22T07:00:00.000Z");
    expect(state.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "已按新方向处理",
      }),
    );
    expect(streamEvents).toEqual(
      expect.arrayContaining([
        { requestId: "req-queued", type: "request_started" },
        { requestId: "req-queued", type: "assistant_done" },
      ]),
    );
  });

  it("exposes queued messages for renderer recovery and removes them once consumed", async () => {
    const { agentService } = await import("../../electron/main/services/agentService");

    const sendPromise = agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-root",
      message: "先处理当前任务",
    });

    await vi.waitFor(() => {
      expect(state.sessionListener).toBeTypeOf("function");
    });

    await agentService.queueMessage({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-queued",
      message: "改成新的方向",
      deliveryMode: "followUp",
    });

    expect(
      agentService.getQueuedMessages({ type: "main" }, "session-1"),
    ).toEqual([
      expect.objectContaining({
        requestId: "req-queued",
        deliveryMode: "followUp",
        content: "改成新的方向",
        persistUserMessage: true,
      }),
    ]);

    state.sessionListener?.({
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text: "改成新的方向" }],
      },
    });

    expect(
      agentService.getQueuedMessages({ type: "main" }, "session-1"),
    ).toEqual([]);

    state.sessionListener?.({
      type: "agent_end",
    });

    await sendPromise;
  });

  it("uses the avatar prompt and disables skills and tools for digital avatar sessions", async () => {
    state.getChatSession.mockResolvedValue({
      id: "session-avatar",
      module: "main",
      kind: "digital_avatar",
    });
    state.createMcpRuntime.mockResolvedValue({
      tools: [{ name: "mock_mcp_tool" }],
      warnings: [],
      dispose: vi.fn().mockResolvedValue(undefined),
    });

    const { agentService } = await import("../../electron/main/services/agentService");

    const sendPromise = agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-avatar",
      requestId: "req-avatar",
      message: "帮我回复这段消息",
    });

    await vi.waitFor(() => {
      expect(state.createAgentSession).toHaveBeenCalled();
    });

    expect(state.getAgentSystemPrompt).toHaveBeenCalledWith(
      "main",
      "digital_avatar",
    );
    expect(state.listActiveSkillsForScope).not.toHaveBeenCalled();
    expect(
      (
        state.createAgentSession.mock.calls[0]?.[0] as {
          customTools?: Array<{ name?: string }>;
        }
      ).customTools ?? [],
    ).toEqual([]);

    state.sessionListener?.({ type: "agent_end" });
    await sendPromise;
  });

  it("rebuilds an existing session when the session switches to digital avatar", async () => {
    const { agentService } = await import("../../electron/main/services/agentService");

    state.getChatSession.mockResolvedValueOnce(null);
    let sendPromise = agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-switch",
      requestId: "req-normal",
      message: "普通会话消息",
    });
    await vi.waitFor(() => {
      expect(state.createAgentSession).toHaveBeenCalledTimes(1);
    });
    state.sessionListener?.({ type: "agent_end" });
    await sendPromise;

    state.getChatSession.mockResolvedValue({
      id: "session-switch",
      module: "main",
      kind: "digital_avatar",
    });
    state.getAgentSystemPrompt.mockClear();

    sendPromise = agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-switch",
      requestId: "req-avatar-switch",
      message: "数字分身消息",
    });
    await vi.waitFor(() => {
      expect(state.createAgentSession).toHaveBeenCalledTimes(2);
    });

    expect(state.getAgentSystemPrompt).toHaveBeenCalledWith(
      "main",
      "digital_avatar",
    );

    state.sessionListener?.({ type: "agent_end" });
    await sendPromise;
  });

  it("uses the avatar prompt and disables skills for channel runtime sessions", async () => {
    state.getChatSession.mockResolvedValue({
      id: "session-channel-runtime",
      module: "main",
      kind: "channel_runtime",
      hidden: true,
    });
    state.createMcpRuntime.mockResolvedValue({
      tools: [{ name: "mock_mcp_tool" }],
      warnings: [],
      dispose: vi.fn().mockResolvedValue(undefined),
    });

    const { agentService } = await import("../../electron/main/services/agentService");

    const sendPromise = agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-channel-runtime",
      requestId: "req-channel-runtime",
      message: "来自渠道的数字人消息",
      capabilityMode: "chat_only",
    });

    await vi.waitFor(() => {
      expect(state.createAgentSession).toHaveBeenCalled();
    });

    expect(state.getAgentSystemPrompt).toHaveBeenCalledWith(
      "main",
      "channel_runtime",
    );
    expect(state.listActiveSkillsForScope).not.toHaveBeenCalled();
    expect(
      (
        state.createAgentSession.mock.calls[0]?.[0] as {
          customTools?: Array<{ name?: string }>;
        }
      ).customTools ?? [],
    ).toEqual([]);

    state.sessionListener?.({ type: "agent_end" });
    await sendPromise;
  });

  it("finalizes an active queued turn when the root prompt is aborted", async () => {
    const { agentService } = await import("../../electron/main/services/agentService");
    const streamEvents: Array<{
      requestId: string;
      type: string;
      fullText?: string;
    }> = [];
    const rootPrompt = createDeferred<void>();

    state.prompt.mockReset().mockImplementation((message: string) => {
      if (message === "先处理当前任务") {
        return rootPrompt.promise;
      }
      return Promise.resolve(undefined);
    });

    const sendPromise = agentService.send(
      {
        scope: { type: "main" },
        module: "main",
        sessionId: "session-1",
        requestId: "req-root",
        message: "先处理当前任务",
      },
      (event) => {
        streamEvents.push({
          requestId: event.requestId,
          type: event.type,
          fullText: "fullText" in event ? event.fullText : undefined,
        });
      },
    );

    await vi.waitFor(() => {
      expect(state.sessionListener).toBeTypeOf("function");
    });

    await agentService.queueMessage({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-queued",
      message: "改成新的方向",
      deliveryMode: "steer",
    });

    state.sessionListener?.({
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text: "改成新的方向" }],
      },
    });
    state.sessionListener?.({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "已按新方向处理",
      },
    });

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    rootPrompt.reject(abortError);

    await expect(sendPromise).resolves.toMatchObject({
      assistantMessage: "已停止当前回答。",
    });

    expect(streamEvents).toEqual(
      expect.arrayContaining([
        {
          requestId: "req-queued",
          type: "assistant_done",
          fullText: "已按新方向处理",
        },
      ]),
    );
    expect(state.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "已按新方向处理",
      }),
    );
  });

  it("persists a fallback assistant message for an active queued turn on error", async () => {
    const { agentService } = await import("../../electron/main/services/agentService");
    const streamEvents: Array<{
      requestId: string;
      type: string;
      fullText?: string;
    }> = [];
    const rootPrompt = createDeferred<void>();

    state.prompt.mockReset().mockImplementation((message: string) => {
      if (message === "先处理当前任务") {
        return rootPrompt.promise;
      }
      return Promise.resolve(undefined);
    });

    const sendPromise = agentService.send(
      {
        scope: { type: "main" },
        module: "main",
        sessionId: "session-1",
        requestId: "req-root",
        message: "先处理当前任务",
      },
      (event) => {
        streamEvents.push({
          requestId: event.requestId,
          type: event.type,
          fullText: "fullText" in event ? event.fullText : undefined,
        });
      },
    );

    await vi.waitFor(() => {
      expect(state.sessionListener).toBeTypeOf("function");
    });

    await agentService.queueMessage({
      scope: { type: "main" },
      module: "main",
      sessionId: "session-1",
      requestId: "req-queued",
      message: "改成新的方向",
      deliveryMode: "steer",
    });

    state.sessionListener?.({
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text: "改成新的方向" }],
      },
    });

    rootPrompt.reject(new Error("network failure"));

    await expect(sendPromise).rejects.toThrow("network failure");

    expect(streamEvents).toEqual(
      expect.arrayContaining([
        {
          requestId: "req-queued",
          type: "assistant_done",
          fullText: "处理失败：network failure",
        },
      ]),
    );
    expect(state.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "处理失败：network failure",
      }),
    );
  });
});
