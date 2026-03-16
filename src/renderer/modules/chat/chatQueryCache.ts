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

const buildSessionFromHistoryEvent = (
  event: ChatHistoryUpdatedEvent,
): ChatSessionDTO | null => {
  if (!event.sessionModule) {
    return null;
  }

  return {
    id: event.sessionId,
    scopeType: event.scope.type,
    projectId: event.scope.type === "project" ? event.scope.projectId : undefined,
    module: event.sessionModule,
    title: event.sessionTitle?.trim() ?? "",
    sdkSessionId: null,
    createdAt: event.createdAt,
    updatedAt: event.sessionUpdatedAt ?? event.createdAt,
  };
};

export const upsertChatSessionList = (
  queryClient: QueryClient,
  scope: ChatScope,
  session: ChatSessionDTO,
): void => {
  queryClient.setQueryData<ChatSessionDTO[] | undefined>(
    getChatSessionsQueryKey(getChatScopeKey(scope)),
    (current) => {
      if (!current || current.length === 0) {
        return [session];
      }

      const existingIndex = current.findIndex((item) => item.id === session.id);
      if (existingIndex < 0) {
        return sortSessionsByUpdatedAt([...current, session]);
      }

      const next = [...current];
      next[existingIndex] = {
        ...next[existingIndex],
        ...session,
      };
      return sortSessionsByUpdatedAt(next);
    },
  );
};

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
  const sessionsQueryKey = getChatSessionsQueryKey(getChatScopeKey(event.scope));
  const currentSessions =
    queryClient.getQueryData<ChatSessionDTO[]>(sessionsQueryKey) ?? [];
  const existingSession = currentSessions.find(
    (session) => session.id === event.sessionId,
  );

  if (!existingSession) {
    const inferredSession = buildSessionFromHistoryEvent(event);
    if (inferredSession) {
      upsertChatSessionList(queryClient, event.scope, inferredSession);
    } else {
      void queryClient.invalidateQueries({
        queryKey: sessionsQueryKey,
        exact: true,
      });
    }
  }

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

  if (!existingSession || typeof event.sessionTitle === "string") {
    void queryClient.invalidateQueries({
      queryKey: sessionsQueryKey,
      exact: true,
    });
  }

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
