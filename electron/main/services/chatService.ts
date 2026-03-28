import { completeSimple } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import type {
  ChatQueuedMessageDTO,
  ChatSendPayload,
  ChatSendDispatchResponse,
  ChatSendResponse,
  ChatStreamEvent,
} from "@shared/types";
import {
  deriveOptimisticChatSessionTitle,
  normalizeChatSessionTitleCandidate,
} from "@shared/utils/chatSessionTitle";
import { agentService } from "./agentService";
import { chatEvents } from "./chatEvents";
import { logger } from "./logger";
import { normalizeMediaMarkdownInText } from "./mediaMarkdown";
import { repositoryService } from "./repositoryService";
import { settingsService } from "./settingsService";
import {
  applyChatStreamEventToTimeline,
  createChatTurnTimelineState,
  formatUserMessageContent,
  persistChatTurnTimeline,
  persistUserMessage,
} from "./chatTurnTimeline";

type SessionQueueItem = {
  payload: ChatSendPayload;
  deliveryMode: "steer" | "followUp";
  queuedAt: string;
  onStream?: (event: ChatStreamEvent) => void;
  resolve: (result: ChatSendResponse) => void;
  reject: (error: unknown) => void;
};

type SessionQueueState = {
  processing: boolean;
  currentRequestId?: string;
  items: SessionQueueItem[];
};

const sessionQueueStore = new Map<string, SessionQueueState>();

const getQueueStoreKey = (payload: Pick<ChatSendPayload, "scope" | "sessionId">): string =>
  payload.scope.type === "main"
    ? `main:${payload.sessionId}`
    : `${payload.scope.projectId}:${payload.sessionId}`;

const getOrCreateQueueState = (
  payload: Pick<ChatSendPayload, "scope" | "sessionId">,
): SessionQueueState => {
  const storeKey = getQueueStoreKey(payload);
  const existing = sessionQueueStore.get(storeKey);
  if (existing) {
    return existing;
  }
  const created: SessionQueueState = {
    processing: false,
    items: [],
  };
  sessionQueueStore.set(storeKey, created);
  return created;
};

const buildQueuedMessageDto = (item: SessionQueueItem): ChatQueuedMessageDTO => ({
  requestId: item.payload.requestId ?? "",
  deliveryMode: item.deliveryMode,
  content: formatUserMessageContent({
    scope: item.payload.scope,
    message: item.payload.message,
    attachments: item.payload.attachments,
  }),
  queuedAt: item.queuedAt,
  persistUserMessage: !item.payload.skipUserMessagePersistence,
  sourceName: item.payload.queuedSourceName?.trim() || undefined,
});

const emitQueueUpdated = (
  payload: Pick<ChatSendPayload, "scope" | "sessionId">,
): void => {
  const state = sessionQueueStore.get(getQueueStoreKey(payload));
  if (typeof chatEvents.emitQueueUpdated !== "function") {
    return;
  }
  chatEvents.emitQueueUpdated({
    scope: payload.scope,
    sessionId: payload.sessionId,
    queuedMessages: (state?.items ?? []).map(buildQueuedMessageDto),
  });
};

const emitStreamEvent = (event: ChatStreamEvent): void => {
  if (typeof chatEvents.emitStream !== "function") {
    return;
  }
  chatEvents.emitStream(event);
};

const buildAutoTitlePromptInput = async (
  payload: ChatSendPayload,
): Promise<{
  promptInput: string;
  userMessage: string;
  assistantMessage?: string;
}> => {
  const fallbackUserMessage = payload.message?.trim().slice(0, 200) ?? "";
  const messages = await repositoryService.listMessages(
    payload.scope,
    payload.sessionId,
  );

  const firstUserMessage = messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );
  const firstAssistantMessage = messages.find(
    (message) => message.role === "assistant" && message.content.trim(),
  );

  const userMessage =
    firstUserMessage?.content.trim().slice(0, 200) || fallbackUserMessage;
  const assistantMessage = firstAssistantMessage?.content.trim().slice(0, 400);

  const promptInput = assistantMessage
    ? `用户首轮消息：${userMessage}\n\n助手首轮回复：${assistantMessage}`
    : userMessage;

  return {
    promptInput,
    userMessage,
    assistantMessage,
  };
};

const maybeSetOptimisticSessionTitle = async (
  payload: ChatSendPayload,
): Promise<string | undefined> => {
  const optimisticTitle = deriveOptimisticChatSessionTitle(payload.message);
  if (!optimisticTitle) {
    return undefined;
  }

  const session = await repositoryService.getChatSession(
    payload.scope,
    payload.sessionId,
  );
  if (!session) {
    logger.debug("Optimistic title skipped: session not found", {
      sessionId: payload.sessionId,
      scope: payload.scope,
    });
    return undefined;
  }

  const currentTitle = session.title.trim();
  if (currentTitle) {
    return currentTitle;
  }

  await repositoryService.updateChatSessionTitle({
    scope: payload.scope,
    sessionId: payload.sessionId,
    title: optimisticTitle,
  });

  logger.debug("Optimistic title applied", {
    sessionId: payload.sessionId,
    scope: payload.scope,
    title: optimisticTitle,
  });

  return optimisticTitle;
};


const resolveAutoTitleModel = (
  payload: ChatSendPayload,
  status: Awaited<ReturnType<typeof settingsService.getClaudeStatus>>,
):
  | {
      modelKey: string;
      source:
        | "payload.model"
        | "settings.lastSelectedModel"
        | "settings.firstEnabledModel";
    }
  | undefined => {
  const modelFromPayload = payload.model?.trim();
  if (modelFromPayload) {
    return {
      modelKey: modelFromPayload,
      source: "payload.model",
    };
  }

  const lastSelectedModel = status.lastSelectedModel?.trim();
  if (lastSelectedModel) {
    return {
      modelKey: lastSelectedModel,
      source: "settings.lastSelectedModel",
    };
  }

  const firstEnabledModel = status.allEnabledModels[0];
  if (!firstEnabledModel) {
    return undefined;
  }
  return {
    modelKey: `${firstEnabledModel.provider}:${firstEnabledModel.modelId}`,
    source: "settings.firstEnabledModel",
  };
};

const generateSessionTitle = async (
  payload: ChatSendPayload,
): Promise<void> => {
  try {
    const optimisticTitle = deriveOptimisticChatSessionTitle(payload.message);
    const session = await repositoryService.getChatSession(
      payload.scope,
      payload.sessionId,
    );
    if (!session) {
      logger.debug("Auto title skipped: session not found", {
        sessionId: payload.sessionId,
        scope: payload.scope,
      });
      return;
    }
    const currentTitle = session.title.trim();
    if (currentTitle && currentTitle !== optimisticTitle) {
      logger.debug("Auto title skipped: session already has title", {
        sessionId: payload.sessionId,
        scope: payload.scope,
        currentTitle,
      });
      return;
    }

    const { promptInput, userMessage, assistantMessage } =
      await buildAutoTitlePromptInput(payload);
    if (!userMessage) {
      logger.debug("Auto title skipped: empty user message", {
        sessionId: payload.sessionId,
        scope: payload.scope,
      });
      return;
    }

    const status = await settingsService.getClaudeStatus(payload.scope);
    const resolvedModel = resolveAutoTitleModel(payload, status);
    if (!resolvedModel) {
      logger.debug("Auto title skipped: no available model", {
        sessionId: payload.sessionId,
        scope: payload.scope,
      });
      return;
    }

    const [provider, ...modelParts] = resolvedModel.modelKey.split(":");
    const modelId = modelParts.join(":");
    if (!provider || !modelId) {
      logger.warn("Auto title skipped: invalid model key", {
        sessionId: payload.sessionId,
        scope: payload.scope,
        modelKey: resolvedModel.modelKey,
      });
      return;
    }

    // Get API key for the provider
    const providerState = status.providers[provider];
    const apiKey =
      providerState?.apiKey ||
      (await settingsService.getClaudeSecret(provider));
    if (!apiKey) {
      logger.debug("Auto title skipped: missing provider api key", {
        sessionId: payload.sessionId,
        scope: payload.scope,
        provider,
        modelId,
      });
      return;
    }

    logger.info("Auto title generation started", {
      sessionId: payload.sessionId,
      scope: payload.scope,
      module: payload.module,
      modelKey: resolvedModel.modelKey,
      modelSource: resolvedModel.source,
      userMessagePreview: userMessage.slice(0, 80),
      assistantMessagePreview: assistantMessage?.slice(0, 80),
    });

    const model = await settingsService.resolveAgentModel(provider, modelId);
    if (!model) {
      logger.warn("Auto title skipped: model could not be resolved", {
        sessionId: payload.sessionId,
        scope: payload.scope,
        provider,
        modelId,
      });
      return;
    }

    const result = await completeSimple(
      model,
      {
        systemPrompt:
          "你是一个标题生成助手。根据用户的消息内容，生成一个简短的中文标题。要求：不超过15个字，不要引号，不要标点符号，直接输出标题文字。",
        messages: [
          {
            role: "user",
            content: promptInput,
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey },
    );

    const titleText = result.content
      .filter(
        (c): c is { type: "text"; text: string } =>
          "type" in c && c.type === "text",
      )
      .map((c) => c.text)
      .join("")
      .trim();

    const nextTitle = normalizeChatSessionTitleCandidate(titleText)
      .slice(0, 30)
      .trim();
    if (!nextTitle) {
      logger.debug("Auto title skipped: model returned empty title", {
        sessionId: payload.sessionId,
        scope: payload.scope,
        modelKey: resolvedModel.modelKey,
      });
      return;
    }

    await repositoryService.updateChatSessionTitle({
      scope: payload.scope,
      sessionId: payload.sessionId,
      title: nextTitle,
    });

    logger.info("Auto title generation succeeded", {
      sessionId: payload.sessionId,
      scope: payload.scope,
      modelKey: resolvedModel.modelKey,
      title: nextTitle,
    });

  } catch (error) {
    logger.warn("Auto title generation failed", {
      sessionId: payload.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const processQueuedMessage = async (
  item: SessionQueueItem,
  requestStartedAt: string,
): Promise<ChatSendResponse> => {
  const { payload, onStream } = item;

  if (!payload.skipUserMessagePersistence) {
    await persistUserMessage({
      scope: payload.scope,
      sessionId: payload.sessionId,
      message: payload.message,
      attachments: payload.attachments,
      requestId: payload.requestId,
      createdAt: requestStartedAt,
      requestStartedAt,
    });
  }

  await maybeSetOptimisticSessionTitle(payload);

  const timelineState = createChatTurnTimelineState();

  const streamProxy = (event: ChatStreamEvent): void => {
    emitStreamEvent(event);
    onStream?.(event);
    if (event.requestId !== (payload.requestId ?? event.requestId)) {
      return;
    }
    applyChatStreamEventToTimeline(timelineState, event);
  };

  let result: ChatSendResponse;
  try {
    result = await agentService.send(payload, streamProxy);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error("Agent send failed", {
      scope: payload.scope,
      sessionId: payload.sessionId,
      module: payload.module,
      error: errorMessage,
    });

    result = {
      assistantMessage: errorMessage,
      toolActions: [],
    };
  }

  const persistedMessageCount = await persistChatTurnTimeline({
    scope: payload.scope,
    sessionId: payload.sessionId,
    timeline: timelineState.timeline,
    fallbackAssistantMessage: result.assistantMessage,
    requestStartedAt,
  });

  logger.info("Auto title queued", {
    sessionId: payload.sessionId,
    scope: payload.scope,
    module: payload.module,
    persistedMessageCount:
      persistedMessageCount + (payload.skipUserMessagePersistence ? 0 : 1),
    userMessageLength: payload.message.trim().length,
  });

  void generateSessionTitle(payload).catch(() => {});

  return result;
};

const processSessionQueue = async (
  payload: Pick<ChatSendPayload, "scope" | "sessionId">,
): Promise<void> => {
  const storeKey = getQueueStoreKey(payload);
  const state = sessionQueueStore.get(storeKey);
  if (!state || state.processing) {
    return;
  }

  state.processing = true;

  try {
    while (state.items.length > 0) {
      const item = state.items.shift();
      if (!item) {
        continue;
      }
      state.currentRequestId = item.payload.requestId;
      emitQueueUpdated(item.payload);

      const requestStartedAt = new Date().toISOString();
      const requestStartedEvent: ChatStreamEvent = {
        requestId: item.payload.requestId ?? "",
        sessionId: item.payload.sessionId,
        scope: item.payload.scope,
        module: item.payload.module,
        createdAt: requestStartedAt,
        type: "request_started",
      };
      emitStreamEvent(requestStartedEvent);
      item.onStream?.(requestStartedEvent);

      try {
        const result = await processQueuedMessage(item, requestStartedAt);
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      } finally {
        state.currentRequestId = undefined;
      }
    }
  } finally {
    state.processing = false;
    state.currentRequestId = undefined;
    if (state.items.length === 0) {
      sessionQueueStore.delete(storeKey);
    }
    emitQueueUpdated(payload);
  }
};

export const chatService = {
  dispatch(
    payload: ChatSendPayload,
    onStream?: (event: ChatStreamEvent) => void,
    deliveryMode: "steer" | "followUp" = "followUp",
  ): {
    queued: boolean;
    completion: Promise<ChatSendResponse>;
    requestId: string;
  } {
    const requestId =
      payload.requestId?.trim() ||
      randomUUID();
    const normalizedPayload: ChatSendPayload = {
      ...payload,
      requestId,
    };
    const state = getOrCreateQueueState(normalizedPayload);
    const queued = state.processing || state.items.length > 0;
    const queuedAt = new Date().toISOString();

    let resolve!: (result: ChatSendResponse) => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<ChatSendResponse>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });

    state.items.push({
      payload: normalizedPayload,
      deliveryMode,
      queuedAt,
      onStream,
      resolve,
      reject,
    });
    if (queued) {
      emitQueueUpdated(normalizedPayload);
    }
    void processSessionQueue(normalizedPayload);

    return {
      queued,
      completion,
      requestId,
    };
  },

  async send(
    payload: ChatSendPayload,
    onStream?: (event: ChatStreamEvent) => void,
  ): Promise<ChatSendResponse> {
    return chatService.dispatch(payload, onStream).completion;
  },

  async sendFromRenderer(
    payload: ChatSendPayload,
  ): Promise<ChatSendDispatchResponse> {
    const dispatched = chatService.dispatch(payload);
    return {
      requestId: dispatched.requestId,
      queued: dispatched.queued,
    };
  },

  async queueMessage(payload: ChatSendPayload & { deliveryMode?: "steer" | "followUp" }): Promise<boolean> {
    chatService.dispatch(payload, undefined, payload.deliveryMode ?? "followUp");
    return true;
  },

  getQueuedMessages(
    scope: ChatSendPayload["scope"],
    sessionId: string,
  ): ChatQueuedMessageDTO[] {
    const state = sessionQueueStore.get(
      getQueueStoreKey({ scope, sessionId }),
    );
    if (!state || state.items.length === 0) {
      return [];
    }
    return state.items.map(buildQueuedMessageDto);
  },

  async interrupt(
    payload: Pick<ChatSendPayload, "scope" | "sessionId"> & {
      requestId?: string;
    },
  ): Promise<boolean> {
    const storeKey = getQueueStoreKey(payload);
    const state = sessionQueueStore.get(storeKey);
    const hasQueuedMessages = Boolean(state && state.items.length > 0);

    if (state && state.items.length > 0) {
      const shouldKeepQueuedItem = (requestId: string): boolean => {
        if (!payload.requestId) {
          return false;
        }
        if (state.currentRequestId === payload.requestId) {
          return false;
        }
        return requestId !== payload.requestId;
      };
      const preserved = state.items.filter((item) =>
        shouldKeepQueuedItem(item.payload.requestId ?? ""),
      );
      const cancelled = state.items.filter(
        (item) => !shouldKeepQueuedItem(item.payload.requestId ?? ""),
      );
      state.items = preserved;
      for (const item of cancelled) {
        item.reject(new Error("已取消排队消息"));
      }
      emitQueueUpdated(payload);
    }

    const interrupted = await agentService.interrupt({
      scope: payload.scope,
      sessionId: payload.sessionId,
      requestId: payload.requestId,
    });

    return interrupted || hasQueuedMessages;
  },
};
