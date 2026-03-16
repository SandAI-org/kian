import { completeSimple, getModel } from "@mariozechner/pi-ai";
import type {
  ChatSendPayload,
  ChatSendResponse,
  ChatStreamEvent,
} from "@shared/types";
import {
  deriveOptimisticChatSessionTitle,
  normalizeChatSessionTitleCandidate,
} from "@shared/utils/chatSessionTitle";
import { buildUserRequestMetadataJson } from "@shared/utils/chatPendingMessage";
import { agentService } from "./agentService";
import { chatEvents } from "./chatEvents";
import { logger } from "./logger";
import {
  buildExtendedMarkdown,
  detectAttachmentMarkdownKind,
  normalizeMediaMarkdownInText,
  resolveAttachmentAbsolutePath,
} from "./mediaMarkdown";
import { repositoryService } from "./repositoryService";
import { settingsService } from "./settingsService";

const formatUserMessage = (payload: ChatSendPayload): string => {
  const message = payload.message.trim();
  const base = message.length > 0 ? message : "（仅上传了附件）";
  const attachments = payload.attachments ?? [];
  if (attachments.length === 0) {
    return base;
  }

  const attachmentLines = attachments.map((file) => {
    const absolutePath = resolveAttachmentAbsolutePath(
      payload.scope,
      file.path,
    );
    const markdownKind = detectAttachmentMarkdownKind(file);
    return buildExtendedMarkdown(markdownKind, absolutePath);
  });
  return `${base}\n\n${attachmentLines.join("\n")}`;
};

type TimelineStep =
  | {
      type: "assistant";
      createdAt: string;
      content: string;
    }
  | {
      type: "tool";
      createdAt: string;
      toolUseId?: string;
      toolName: string;
      toolInput?: string;
      output?: string;
    };

const mergeToolOutput = (
  existing: string | undefined,
  incoming: string,
): string => {
  const next = incoming.trim();
  if (!next) {
    return existing ?? "";
  }
  if (!existing || !existing.trim()) {
    return next;
  }
  if (existing === next || existing.includes(next)) {
    return existing;
  }
  if (next.includes(existing)) {
    return next;
  }
  return `${existing}\n${next}`;
};

const normalizeToolInput = (input: string | undefined): string | undefined => {
  const trimmed = input?.trim();
  return trimmed ? trimmed : undefined;
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

const appendAssistantDelta = (
  timeline: TimelineStep[],
  delta: string,
  createdAt: string,
): void => {
  if (!delta) return;
  const last = timeline[timeline.length - 1];
  if (last?.type === "assistant") {
    last.content += delta;
    return;
  }
  timeline.push({
    type: "assistant",
    createdAt,
    content: delta,
  });
};

const ensureToolStep = (
  timeline: TimelineStep[],
  toolStepByUseId: Map<string, Extract<TimelineStep, { type: "tool" }>>,
  toolUseId: string | undefined,
  toolName: string | undefined,
  createdAt: string,
): Extract<TimelineStep, { type: "tool" }> => {
  const normalizedToolName = toolName?.trim() || "工具";

  if (toolUseId) {
    const existing = toolStepByUseId.get(toolUseId);
    if (existing) {
      if (!existing.toolName || existing.toolName === "工具") {
        existing.toolName = normalizedToolName;
      }
      return existing;
    }
  }

  const last = timeline[timeline.length - 1];
  if (
    !toolUseId &&
    last?.type === "tool" &&
    !last.toolUseId &&
    !last.output &&
    last.toolName === normalizedToolName
  ) {
    return last;
  }

  const next: Extract<TimelineStep, { type: "tool" }> = {
    type: "tool",
    createdAt,
    toolUseId,
    toolName: normalizedToolName,
  };
  timeline.push(next);
  if (toolUseId) {
    toolStepByUseId.set(toolUseId, next);
  }
  return next;
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

    const status = await settingsService.getClaudeStatus();
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

    const model = getModel(
      provider as Parameters<typeof getModel>[0],
      modelId as never,
    );

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
      await repositoryService.appendMessage({
        scope: payload.scope,
        sessionId: payload.sessionId,
        role: "user",
        content: formatUserMessage(payload),
        metadataJson: payload.requestId
          ? buildUserRequestMetadataJson(payload.requestId)
          : undefined,
      });
    }

    await maybeSetOptimisticSessionTitle(payload);

    const timeline: TimelineStep[] = [];
    const toolStepByUseId = new Map<
      string,
      Extract<TimelineStep, { type: "tool" }>
    >();

    const streamProxy = (event: ChatStreamEvent): void => {
      onStream?.(event);
      const eventCreatedAt = event.createdAt ?? new Date().toISOString();

      if (event.type === "assistant_delta") {
        appendAssistantDelta(timeline, event.delta ?? "", eventCreatedAt);
        return;
      }

      if (event.type === "tool_start") {
        const step = ensureToolStep(
          timeline,
          toolStepByUseId,
          event.toolUseId,
          event.toolName,
          eventCreatedAt,
        );
        const toolInput = normalizeToolInput(event.toolInput);
        if (toolInput) {
          step.toolInput = toolInput;
        }
        return;
      }

      if (event.type === "tool_progress") {
        const step = ensureToolStep(
          timeline,
          toolStepByUseId,
          event.toolUseId,
          event.toolName,
          eventCreatedAt,
        );
        const toolInput = normalizeToolInput(event.toolInput);
        if (toolInput && !step.toolInput) {
          step.toolInput = toolInput;
        }
        return;
      }

      if (event.type === "tool_output") {
        const step = ensureToolStep(
          timeline,
          toolStepByUseId,
          event.toolUseId,
          event.toolName,
          eventCreatedAt,
        );
        if (event.toolName?.trim()) {
          step.toolName = event.toolName.trim();
        }
        if (event.output?.trim()) {
          step.output = mergeToolOutput(step.output, event.output);
        }
      }
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

    const persistedMessages: Array<{
      role: "assistant" | "tool";
      createdAt: string;
      content: string;
      toolCallJson?: string;
    }> = [];

    for (const step of timeline) {
      if (step.type === "assistant") {
        const content = normalizeMediaMarkdownInText(step.content.trim());
        if (!content) continue;
        persistedMessages.push({
          role: "assistant",
          createdAt: step.createdAt,
          content,
        });
        continue;
      }

      const toolName = step.toolName?.trim() || "工具";
      const toolInput = normalizeToolInput(step.toolInput);
      const toolCallJson = JSON.stringify({
        toolCall: {
          toolUseId: step.toolUseId,
          toolName,
          input: toolInput,
        },
      });
      if (step.output?.trim()) {
        persistedMessages.push({
          role: "tool",
          createdAt: step.createdAt,
          content: `工具输出（${toolName}）\n${step.output.trim()}`,
          toolCallJson,
        });
      } else {
        persistedMessages.push({
          role: "tool",
          createdAt: step.createdAt,
          content: `调用工具：${toolName}`,
          toolCallJson,
        });
      }
    }

    const hasAssistantMessage = persistedMessages.some(
      (item) => item.role === "assistant",
    );
    if (!hasAssistantMessage) {
      persistedMessages.push({
        role: "assistant",
        createdAt: new Date().toISOString(),
        content: result.assistantMessage,
      });
    }

    for (const item of persistedMessages) {
      await repositoryService.appendMessage({
        scope: payload.scope,
        sessionId: payload.sessionId,
        role: item.role,
        content: item.content,
        toolCallJson: item.role === "tool" ? item.toolCallJson : undefined,
        createdAt: item.createdAt,
      });
    }

    logger.info("Auto title queued", {
      sessionId: payload.sessionId,
      scope: payload.scope,
      module: payload.module,
      persistedMessageCount:
        persistedMessages.length + (payload.skipUserMessagePersistence ? 0 : 1),
      userMessageLength: payload.message.trim().length,
    });

    // Fire-and-forget: auto-generate session title
    void generateSessionTitle(payload).catch(() => {});

    return result;
  },
};
