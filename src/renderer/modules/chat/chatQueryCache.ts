import { api } from "@renderer/lib/api";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ChatHistoryUpdatedEvent,
  ChatScope,
  ChatSessionDTO,
} from "@shared/types";

let chatQueryBridgeInitialized = false;

export const getChatScopeKey = (scope: ChatScope): string =>
  scope.type === "main" ? "main" : scope.projectId;

export const getChatSessionsQueryKey = (scopeKey: string) =>
  ["chat-sessions", scopeKey] as const;

export const getChatMessagesQueryKey = (scopeKey: string, sessionId: string) =>
  ["chat-messages", scopeKey, sessionId] as const;

const sortSessionsByUpdatedAt = (
  sessions: ChatSessionDTO[],
): ChatSessionDTO[] =>
  [...sessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

export const patchChatSessionList = (
  queryClient: QueryClient,
  scope: ChatScope,
  sessionId: string,
  updater: (session: ChatSessionDTO) => ChatSessionDTO,
): void => {
  queryClient.setQueryData<ChatSessionDTO[] | undefined>(
    getChatSessionsQueryKey(getChatScopeKey(scope)),
    (current) => {
      if (!current) return current;

      let changed = false;
      const next = current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        const updated = updater(session);
        if (updated !== session) {
          changed = true;
        }
        return updated;
      });

      if (!changed) {
        return current;
      }

      return sortSessionsByUpdatedAt(next);
    },
  );
};

export const applyChatHistoryUpdateToCache = (
  queryClient: QueryClient,
  event: ChatHistoryUpdatedEvent,
): void => {
  patchChatSessionList(queryClient, event.scope, event.sessionId, (session) => {
    const nextTitle = event.sessionTitle?.trim() || session.title;
    const nextUpdatedAt = event.sessionUpdatedAt ?? event.createdAt;
    if (
      nextTitle === session.title &&
      nextUpdatedAt === session.updatedAt
    ) {
      return session;
    }

    return {
      ...session,
      title: nextTitle,
      updatedAt: nextUpdatedAt,
    };
  });

  if (!event.messageId.trim()) {
    return;
  }

  void queryClient.invalidateQueries({
    queryKey: getChatMessagesQueryKey(
      getChatScopeKey(event.scope),
      event.sessionId,
    ),
    exact: true,
  });
};

export const initializeChatQueryBridge = (queryClient: QueryClient): void => {
  if (typeof window === "undefined" || chatQueryBridgeInitialized) {
    return;
  }

  chatQueryBridgeInitialized = true;
  api.chat.subscribeHistoryUpdated((event) => {
    applyChatHistoryUpdateToCache(queryClient, event);
  });
};
