import type {
  ChatAttachmentDTO,
  ChatMessageMetadata,
  ChatScope,
  ChatStreamEvent,
} from "@shared/types";
import { buildUserRequestMetadataJson } from "@shared/utils/chatPendingMessage";
import {
  buildExtendedMarkdown,
  detectAttachmentMarkdownKind,
  normalizeMediaMarkdownInText,
  resolveAttachmentAbsolutePath,
} from "./mediaMarkdown";
import { repositoryService } from "./repositoryService";

type TimelineStep =
  | {
      type: "assistant";
      createdAt: string;
      content: string;
    }
  | {
      type: "thinking";
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

type PersistedTimelineMessage = {
  role: "assistant" | "tool" | "system";
  createdAt: string;
  content: string;
  toolCallJson?: string;
  metadataJson?: string;
};

export interface ChatTurnTimelineState {
  timeline: TimelineStep[];
  toolStepByUseId: Map<string, Extract<TimelineStep, { type: "tool" }>>;
}

const buildThinkingMetadataJson = (): string =>
  JSON.stringify({
    kind: "thinking",
  } satisfies ChatMessageMetadata);

const buildRequestStartedMetadataJson = (
  requestStartedAt: string,
): string =>
  JSON.stringify({
    requestStartedAt,
  });

const buildThinkingMetadataWithRequestStartedAtJson = (
  requestStartedAt: string,
): string =>
  JSON.stringify({
    kind: "thinking",
    requestStartedAt,
  } satisfies ChatMessageMetadata & { requestStartedAt: string });

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

const findLastTimelineStepIndex = (
  timeline: TimelineStep[],
  type: TimelineStep["type"],
): number => {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index]?.type === type) {
      return index;
    }
  }
  return -1;
};

const appendTextDelta = (
  timeline: TimelineStep[],
  delta: string,
  createdAt: string,
  type: "assistant" | "thinking",
): void => {
  if (!delta) return;
  const targetIndex = timeline.length - 1;
  const target =
    targetIndex >= 0 && targetIndex < timeline.length
      ? timeline[targetIndex]
      : undefined;

  if (target?.type === type) {
    target.content += delta;
    return;
  }
  timeline.push({
    type,
    createdAt,
    content: delta,
  });
};

const ensureThinkingContent = (
  timeline: TimelineStep[],
  content: string,
  createdAt: string,
): void => {
  const next = content.trim();
  if (!next) return;

  const targetIndex = findLastTimelineStepIndex(timeline, "thinking");
  const target =
    targetIndex >= 0 && targetIndex < timeline.length
      ? timeline[targetIndex]
      : undefined;

  if (target?.type === "thinking") {
    if (!target.content.trim() || next.includes(target.content)) {
      target.content = next;
      return;
    }
    if (target.content.includes(next)) {
      return;
    }
    target.content = `${target.content}${next}`;
    return;
  }

  timeline.push({
    type: "thinking",
    createdAt,
    content: next,
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

const collectPersistedTimelineMessages = (input: {
  timeline: TimelineStep[];
  fallbackAssistantMessage: string;
  requestStartedAt: string;
}): PersistedTimelineMessage[] => {
  const persistedMessages: PersistedTimelineMessage[] = [];

  for (const step of input.timeline) {
    if (step.type === "assistant") {
      const content = normalizeMediaMarkdownInText(step.content.trim());
      if (!content) continue;
      persistedMessages.push({
        role: "assistant",
        createdAt: step.createdAt,
        content,
        metadataJson: buildRequestStartedMetadataJson(input.requestStartedAt),
      });
      continue;
    }

    if (step.type === "thinking") {
      const content = normalizeMediaMarkdownInText(step.content.trim());
      if (!content) continue;
      persistedMessages.push({
        role: "system",
        createdAt: step.createdAt,
        content,
        metadataJson: buildThinkingMetadataWithRequestStartedAtJson(
          input.requestStartedAt,
        ),
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
        metadataJson: buildRequestStartedMetadataJson(input.requestStartedAt),
      });
    } else {
      persistedMessages.push({
        role: "tool",
        createdAt: step.createdAt,
        content: `调用工具：${toolName}`,
        toolCallJson,
        metadataJson: buildRequestStartedMetadataJson(input.requestStartedAt),
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
      content: input.fallbackAssistantMessage,
      metadataJson: buildRequestStartedMetadataJson(input.requestStartedAt),
    });
  }

  return persistedMessages;
};

export const createChatTurnTimelineState = (): ChatTurnTimelineState => ({
  timeline: [],
  toolStepByUseId: new Map(),
});

export const applyChatStreamEventToTimeline = (
  state: ChatTurnTimelineState,
  event: ChatStreamEvent,
): void => {
  const eventCreatedAt = event.createdAt ?? new Date().toISOString();

  if (event.type === "assistant_delta") {
    appendTextDelta(state.timeline, event.delta ?? "", eventCreatedAt, "assistant");
    return;
  }

  if (event.type === "thinking_delta") {
    appendTextDelta(state.timeline, event.delta ?? "", eventCreatedAt, "thinking");
    return;
  }

  if (event.type === "thinking_end" && event.thinking?.trim()) {
    ensureThinkingContent(state.timeline, event.thinking, eventCreatedAt);
    return;
  }

  if (event.type === "tool_start") {
    const step = ensureToolStep(
      state.timeline,
      state.toolStepByUseId,
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
      state.timeline,
      state.toolStepByUseId,
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
      state.timeline,
      state.toolStepByUseId,
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

export const persistChatTurnTimeline = async (input: {
  scope: ChatScope;
  sessionId: string;
  timeline: TimelineStep[];
  fallbackAssistantMessage: string;
  requestStartedAt: string;
}): Promise<number> => {
  const persistedMessages = collectPersistedTimelineMessages({
    timeline: input.timeline,
    fallbackAssistantMessage: input.fallbackAssistantMessage,
    requestStartedAt: input.requestStartedAt,
  });

  for (const item of persistedMessages) {
    await repositoryService.appendMessage({
      scope: input.scope,
      sessionId: input.sessionId,
      role: item.role,
      content: item.content,
      toolCallJson: item.role === "tool" ? item.toolCallJson : undefined,
      metadataJson: item.metadataJson,
      createdAt: item.createdAt,
    });
  }

  return persistedMessages.length;
};

export const formatUserMessageContent = (input: {
  scope: ChatScope;
  message: string;
  attachments?: ChatAttachmentDTO[];
}): string => {
  const message = input.message.trim();
  const base = message.length > 0 ? message : "（仅上传了附件）";
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    return base;
  }

  const attachmentLines = attachments.map((file) => {
    const absolutePath = resolveAttachmentAbsolutePath(input.scope, file.path);
    const markdownKind = detectAttachmentMarkdownKind(file);
    return buildExtendedMarkdown(markdownKind, absolutePath);
  });
  return `${base}\n\n${attachmentLines.join("\n")}`;
};

export const persistUserMessage = async (input: {
  scope: ChatScope;
  sessionId: string;
  message: string;
  attachments?: ChatAttachmentDTO[];
  requestId?: string;
  createdAt?: string;
  requestStartedAt?: string;
}): Promise<void> => {
  await repositoryService.appendMessage({
    scope: input.scope,
    sessionId: input.sessionId,
    role: "user",
    content: formatUserMessageContent({
      scope: input.scope,
      message: input.message,
      attachments: input.attachments,
    }),
    metadataJson: input.requestId
      ? buildUserRequestMetadataJson(
          input.requestId,
          input.requestStartedAt ?? input.createdAt,
        )
      : undefined,
    createdAt: input.createdAt,
  });
};
