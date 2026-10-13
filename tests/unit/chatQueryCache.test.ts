import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyChatHistoryUpdateToCache,
  applyChatQueueUpdateToCache,
  getChatMessagesQueryKey,
  getChatQueuedMessagesQueryKey,
  getChatSessionsQueryKey,
  initializeChatQueryBridge,
} from "../../src/renderer/modules/chat/chatQueryCache";

describe("chatQueryCache", () => {
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient?.clear();
  });

  it("invalidates model lists for all sessions without depending on the main layout", () => {
    queryClient = new QueryClient();
    const subscribe = vi.fn();
    vi.stubGlobal("window", {
      api: {
        appOperation: { subscribe },
        chat: { subscribeHistoryUpdated: vi.fn(), subscribeQueueUpdated: vi.fn() },
      },
    });
    try {
      const first = ["settings", "claude", "main", "session-a"];
      const second = ["settings", "claude", "agent-b", "session-b"];
      queryClient.setQueryData(first, { lastSelectedModel: "openai:model-a" });
      queryClient.setQueryData(second, { lastSelectedModel: "openai:model-b" });
      initializeChatQueryBridge(queryClient);
      initializeChatQueryBridge(queryClient);
      expect(subscribe).toHaveBeenCalledTimes(1);
      subscribe.mock.calls[0][0]({ type: "reload_settings" });
      expect(queryClient.getQueryState(first)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(second)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryData(first)).toEqual({ lastSelectedModel: "openai:model-a" });
      expect(queryClient.getQueryData(second)).toEqual({ lastSelectedModel: "openai:model-b" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("patches an already loaded message list with the appended message payload", () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const sessionsKey = getChatSessionsQueryKey("main");
    const messagesKey = getChatMessagesQueryKey("main", "session-1");

    queryClient.setQueryData(sessionsKey, [
      {
        id: "session-1",
        scopeType: "main",
        module: "main",
        title: "当前会话",
        sdkSessionId: null,
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
    ]);
    queryClient.setQueryData(messagesKey, [
      {
        id: "m-1",
        sessionId: "session-1",
        role: "user",
        content: "你好",
        createdAt: "2026-03-23T00:00:00.000Z",
      },
    ]);

    applyChatHistoryUpdateToCache(queryClient, {
      scope: { type: "main" },
      sessionId: "session-1",
      messageId: "m-2",
      role: "assistant",
      createdAt: "2026-03-23T00:00:01.000Z",
      sessionUpdatedAt: "2026-03-23T00:00:01.000Z",
      message: {
        id: "m-2",
        sessionId: "session-1",
        role: "assistant",
        content: "你好，我在。",
        createdAt: "2026-03-23T00:00:01.000Z",
      },
    });

    expect(queryClient.getQueryData(messagesKey)).toEqual([
      {
        id: "m-1",
        sessionId: "session-1",
        role: "user",
        content: "你好",
        createdAt: "2026-03-23T00:00:00.000Z",
      },
      {
        id: "m-2",
        sessionId: "session-1",
        role: "assistant",
        content: "你好，我在。",
        createdAt: "2026-03-23T00:00:01.000Z",
      },
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["chat-sessions", "main"],
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: messagesKey,
      exact: true,
    });
  });

  it("invalidates the message query instead of fabricating partial history when the list is not loaded", () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const sessionsKey = getChatSessionsQueryKey("main");
    const messagesKey = getChatMessagesQueryKey("main", "session-1");

    queryClient.setQueryData(sessionsKey, [
      {
        id: "session-1",
        scopeType: "main",
        module: "main",
        title: "当前会话",
        sdkSessionId: null,
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
    ]);

    applyChatHistoryUpdateToCache(queryClient, {
      scope: { type: "main" },
      sessionId: "session-1",
      messageId: "m-2",
      role: "assistant",
      createdAt: "2026-03-23T00:00:01.000Z",
      sessionUpdatedAt: "2026-03-23T00:00:01.000Z",
      message: {
        id: "m-2",
        sessionId: "session-1",
        role: "assistant",
        content: "你好，我在。",
        createdAt: "2026-03-23T00:00:01.000Z",
      },
    });

    expect(queryClient.getQueryData(messagesKey)).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: messagesKey,
      exact: true,
    });
  });

  it("does not add hidden sessions to the visible session list", () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const sessionsKey = getChatSessionsQueryKey("main");
    const messagesKey = getChatMessagesQueryKey("main", "hidden-session");

    queryClient.setQueryData(sessionsKey, []);
    queryClient.setQueryData(messagesKey, []);

    applyChatHistoryUpdateToCache(queryClient, {
      scope: { type: "main" },
      sessionId: "hidden-session",
      messageId: "m-hidden",
      role: "assistant",
      createdAt: "2026-03-23T00:00:01.000Z",
      sessionModule: "main",
      sessionKind: "normal",
      sessionHidden: true,
      sessionUpdatedAt: "2026-03-23T00:00:01.000Z",
      message: {
        id: "m-hidden",
        sessionId: "hidden-session",
        role: "assistant",
        content: "后台任务结果",
        createdAt: "2026-03-23T00:00:01.000Z",
      },
    });

    expect(queryClient.getQueryData(sessionsKey)).toEqual([]);
    expect(queryClient.getQueryData(messagesKey)).toEqual([
      {
        id: "m-hidden",
        sessionId: "hidden-session",
        role: "assistant",
        content: "后台任务结果",
        createdAt: "2026-03-23T00:00:01.000Z",
      },
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["chat-sessions", "main"],
    });
  });

  it("stores queue snapshots under the per-session queued message key", () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const queuedKey = getChatQueuedMessagesQueryKey("main", "session-1");

    applyChatQueueUpdateToCache(queryClient, {
      scope: { type: "main" },
      sessionId: "session-1",
      queuedMessages: [
        {
          requestId: "req-1",
          deliveryMode: "followUp",
          content: "稍后处理",
          queuedAt: "2026-03-23T00:00:10.000Z",
          persistUserMessage: true,
        },
      ],
    });

    expect(queryClient.getQueryData(queuedKey)).toEqual([
      {
        requestId: "req-1",
        deliveryMode: "followUp",
        content: "稍后处理",
        queuedAt: "2026-03-23T00:00:10.000Z",
        persistUserMessage: true,
      },
    ]);
  });

  it("builds a separate query key for digital avatar session lists", () => {
    expect(getChatSessionsQueryKey("main", ["digital_avatar"])).toEqual([
      "chat-sessions",
      "main",
      "digital_avatar",
    ]);
  });
});
