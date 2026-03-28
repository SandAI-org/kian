import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyChatHistoryUpdateToCache,
  applyChatQueueUpdateToCache,
  getChatMessagesQueryKey,
  getChatQueuedMessagesQueryKey,
  getChatSessionsQueryKey,
} from "../../src/renderer/modules/chat/chatQueryCache";

describe("chatQueryCache", () => {
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient?.clear();
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
      queryKey: sessionsKey,
      exact: true,
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
});
