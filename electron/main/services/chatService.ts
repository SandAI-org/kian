import { completeSimple } from "@mariozechner/pi-ai";
import type {
  ChatSendPayload,
  ChatSendResponse,
  ChatStreamEvent,
} from "@shared/types";
import {
  deriveOptimisticChatSessionTitle,
  normalizeChatSessionTitleCandidate,
} from "@shared/utils/chatSessionTitle";
import { agentService } from "./agentService";
import { logger } from "./logger";
import { normalizeMediaMarkdownInText } from "./mediaMarkdown";
import { repositoryService } from "./repositoryService";
import { settingsService } from "./settingsService";
import {
  applyChatStreamEventToTimeline,
  createChatTurnTimelineState,
  persistChatTurnTimeline,
  persistUserMessage,
} from "./chatTurnTimeline";

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

export const chatService = {
  async send(
    payload: ChatSendPayload,
    onStream?: (event: ChatStreamEvent) => void,
  ): Promise<ChatSendResponse> {
    // Record user message
    if (!payload.skipUserMessagePersistence) {
      await persistUserMessage({
        scope: payload.scope,
        sessionId: payload.sessionId,
        message: payload.message,
        attachments: payload.attachments,
        requestId: payload.requestId,
      });
    }

    await maybeSetOptimisticSessionTitle(payload);

    const timelineState = createChatTurnTimelineState();

    const streamProxy = (event: ChatStreamEvent): void => {
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
        assistantMessage: `处理失败：${errorMessage}`,
        toolActions: [],
      };
    }

    const persistedMessageCount = await persistChatTurnTimeline({
      scope: payload.scope,
      sessionId: payload.sessionId,
      timeline: timelineState.timeline,
      fallbackAssistantMessage: result.assistantMessage,
    });

    logger.info("Auto title queued", {
      sessionId: payload.sessionId,
      scope: payload.scope,
      module: payload.module,
      persistedMessageCount:
        persistedMessageCount + (payload.skipUserMessagePersistence ? 0 : 1),
      userMessageLength: payload.message.trim().length,
    });

    // Fire-and-forget: auto-generate session title
    void generateSessionTitle(payload).catch(() => {});

    return result;
  },
};
