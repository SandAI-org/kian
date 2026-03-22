import type { ChatScope, ChatStreamEvent } from "@shared/types";
import { getToolEmoji, toFriendlyToolName } from "@shared/utils/toolName";
import { logger } from "../logger";
import {
  extractExtendedMarkdownTokens,
  resolveAttachmentAbsolutePath,
} from "../mediaMarkdown";

const TELEGRAM_FILE_MARKDOWN_PATTERN =
  /@\[(?:image|video|audio|file|attachment)(?:\|[^\]]*)?\]\(([^)\n]+)\)/gi;
const TELEGRAM_TOOL_INPUT_MAX_LENGTH = 280;
const TELEGRAM_TOOL_OUTPUT_MAX_LENGTH = 640;
const TOOL_SUMMARY_NAME = "工具摘要";
const REMOTE_ATTACHMENT_URL_PATTERN = /^https?:\/\//i;
const DATA_IMAGE_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;
const FILE_URL_PATTERN = /^file:\/\//i;

const resolveFileUrlPath = (value: string): string | null => {
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return null;
  }
};

const inferCodeFenceLanguage = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "text";
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // ignore parse failures and fallback to text.
    }
  }
  if (
    /^(?:\$?\s*)?(?:pnpm|npm|yarn|git|ls|cat|rg|cd|pwd|node|python|bash|sh)\b/m.test(
      trimmed,
    )
  ) {
    return "bash";
  }
  return "text";
};

const buildMarkdownCodeBlock = (value: string): string => {
  const normalized = value.replace(/\r\n/g, "\n");
  const backtickRuns = normalized.match(/`+/g) ?? [];
  const maxBackticks = backtickRuns.reduce(
    (max, item) => Math.max(max, item.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, maxBackticks + 1));
  const language = inferCodeFenceLanguage(normalized);
  return `${fence}${language}\n${normalized}\n${fence}`;
};

const formatFriendlyToolName = (toolName: string | undefined): string =>
  toFriendlyToolName(toolName?.trim() || "工具");

const formatFriendlyToolHeader = (toolName: string | undefined): string =>
  `${getToolEmoji(toolName?.trim() || "工具")} ${formatFriendlyToolName(
    toolName,
  )}`;

export interface TelegramToolCallSummary {
  toolUseId?: string;
  toolName: string;
  toolInput?: string;
  output?: string;
}

interface TelegramAssistantTimelineAssistantBlock {
  type: "assistant";
  message: string;
}

interface TelegramAssistantTimelineToolBlock {
  type: "tool";
  tool: TelegramToolCallSummary;
}

export type TelegramAssistantTimelineBlock =
  | TelegramAssistantTimelineAssistantBlock
  | TelegramAssistantTimelineToolBlock;

export interface TelegramAssistantProgressiveStreamer {
  pushEvent: (event: ChatStreamEvent) => void;
  finalize: (input: {
    fallbackAssistantMessage: string;
    toolActions?: string[];
    isError?: boolean;
  }) => Promise<void>;
}

export const extractTelegramFileAttachments = (
  content: string,
  scope: ChatScope,
  options?: {
    includeRemoteImages?: boolean;
  },
): string[] => {
  if (!content.trim()) return [];
  const includeRemoteImages = options?.includeRemoteImages ?? false;
  const unique = new Set<string>();
  const results: string[] = [];
  const tokens = extractExtendedMarkdownTokens(content);
  for (const token of tokens) {
    const normalizedPath = token.path.trim();
    if (!normalizedPath) continue;

    if (
      REMOTE_ATTACHMENT_URL_PATTERN.test(normalizedPath) ||
      DATA_IMAGE_URL_PATTERN.test(normalizedPath)
    ) {
      if (
        includeRemoteImages &&
        token.kind === "image"
      ) {
        if (unique.has(normalizedPath)) continue;
        unique.add(normalizedPath);
        results.push(normalizedPath);
      }
      continue;
    }

    const fileUrlPath = FILE_URL_PATTERN.test(normalizedPath)
      ? resolveFileUrlPath(normalizedPath)
      : null;
    const absolutePath = resolveAttachmentAbsolutePath(
      scope,
      fileUrlPath ?? normalizedPath,
    );
    if (!absolutePath || unique.has(absolutePath)) continue;
    unique.add(absolutePath);
    results.push(absolutePath);
  }
  return results;
};

export const stripTelegramFileMarkdown = (content: string): string => {
  const stripped = content.replace(TELEGRAM_FILE_MARKDOWN_PATTERN, "");
  return stripped
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const normalizeTelegramToolDetail = (
  value: string | undefined,
  maxLength: number,
): string | undefined => {
  if (!value) return undefined;
  const normalized = stripTelegramFileMarkdown(value).trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...(内容过长，已截断)`;
};

const mergeTelegramToolDetail = (
  existing: string | undefined,
  incoming: string | undefined,
): string | undefined => {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing === incoming || existing.includes(incoming)) return existing;
  if (incoming.includes(existing)) return incoming;
  return `${existing}\n${incoming}`;
};

const isToolStreamEvent = (event: ChatStreamEvent): boolean =>
  event.type === "tool_start" ||
  event.type === "tool_progress" ||
  event.type === "tool_output";

export const buildTelegramToolCallsFromStreamEvents = (
  streamEvents: ChatStreamEvent[],
  toolActions: string[] = [],
): TelegramToolCallSummary[] => {
  const steps = new Map<string, TelegramToolCallSummary>();

  const ensureStep = (
    toolUseId: string | undefined,
    toolName: string | undefined,
  ): TelegramToolCallSummary => {
    const normalizedUseId = toolUseId?.trim() || undefined;
    const normalizedToolName = toolName?.trim() || "工具";
    const key = normalizedUseId || `tool-${normalizedToolName}`;
    const existing = steps.get(key);
    if (existing) {
      if (normalizedToolName && existing.toolName === "工具") {
        existing.toolName = normalizedToolName;
      }
      return existing;
    }

    const created: TelegramToolCallSummary = {
      toolUseId: normalizedUseId,
      toolName: normalizedToolName,
    };
    steps.set(key, created);
    return created;
  };

  for (const event of streamEvents) {
    if (!isToolStreamEvent(event)) continue;
    const step = ensureStep(event.toolUseId, event.toolName);
    if (event.toolName?.trim()) {
      step.toolName = event.toolName.trim();
    }
    const normalizedInput = normalizeTelegramToolDetail(
      event.toolInput,
      TELEGRAM_TOOL_INPUT_MAX_LENGTH,
    );
    if (normalizedInput) {
      step.toolInput = step.toolInput
        ? mergeTelegramToolDetail(step.toolInput, normalizedInput)
        : normalizedInput;
    }
    if (event.type !== "tool_output") continue;
    const normalizedOutput = normalizeTelegramToolDetail(
      event.output,
      TELEGRAM_TOOL_OUTPUT_MAX_LENGTH,
    );
    if (normalizedOutput) {
      step.output = mergeTelegramToolDetail(step.output, normalizedOutput);
    }
  }

  for (const action of toolActions) {
    const normalizedAction = normalizeTelegramToolDetail(
      action,
      TELEGRAM_TOOL_OUTPUT_MAX_LENGTH,
    );
    if (!normalizedAction) continue;
    const hasSameOutput = Array.from(steps.values()).some(
      (item) => item.output === normalizedAction,
    );
    if (hasSameOutput) continue;
    steps.set(`tool-action-${steps.size}`, {
      toolName: TOOL_SUMMARY_NAME,
      output: normalizedAction,
    });
  }

  return Array.from(steps.values()).filter(
    (item) =>
      item.toolName.trim().length > 0 ||
      Boolean(item.toolInput?.trim()) ||
      Boolean(item.output?.trim()),
  );
};

const normalizeTelegramToolCall = (
  item: TelegramToolCallSummary,
): TelegramToolCallSummary | null => {
  const toolName = item.toolName?.trim() || "工具";
  const toolInput = normalizeTelegramToolDetail(
    item.toolInput,
    TELEGRAM_TOOL_INPUT_MAX_LENGTH,
  );
  const output = normalizeTelegramToolDetail(
    item.output,
    TELEGRAM_TOOL_OUTPUT_MAX_LENGTH,
  );
  if (!toolName && !toolInput && !output) return null;
  return {
    toolUseId: item.toolUseId?.trim() || undefined,
    toolName,
    toolInput,
    output,
  };
};

export const normalizeTelegramToolCalls = (
  toolCalls: TelegramToolCallSummary[] | undefined,
): TelegramToolCallSummary[] => {
  if (!toolCalls || toolCalls.length === 0) return [];
  return toolCalls
    .map((item) => normalizeTelegramToolCall(item))
    .filter((item): item is TelegramToolCallSummary => Boolean(item));
};

export const formatTelegramToolCallMessage = (
  toolCall: TelegramToolCallSummary,
): string => {
  const normalized = normalizeTelegramToolCall(toolCall);
  if (!normalized) return "🛠️ 工具：工具";
  return `🧰 工具：${formatFriendlyToolHeader(normalized.toolName)}`;
};

export const formatTelegramToolRunningMessage = (
  toolCall: TelegramToolCallSummary,
): string => {
  const normalized = normalizeTelegramToolCall(toolCall);
  const toolName = normalized?.toolName ?? "工具";
  return `正在执行工具 ${formatFriendlyToolName(toolName)}`;
};

export const formatTelegramToolDoneMessage = (
  toolCall: TelegramToolCallSummary,
): string => {
  const normalized = normalizeTelegramToolCall(toolCall);
  const toolName = normalized?.toolName ?? "工具";
  return `${formatFriendlyToolName(toolName)} 工具执行完成`;
};

const formatTelegramToolCallLines = (
  toolCalls: TelegramToolCallSummary[] | undefined,
): string[] => {
  if (!toolCalls || toolCalls.length === 0) return [];
  const lines: string[] = ["", "🧰 工具调用过程:"];
  for (const call of toolCalls) {
    const normalized = normalizeTelegramToolCall(call);
    if (!normalized) continue;
    lines.push(formatFriendlyToolHeader(normalized.toolName));
  }
  return lines;
};

export const formatTelegramAssistantBody = (input: {
  message: string;
  hasAttachments: boolean;
  isError: boolean;
  toolCalls?: TelegramToolCallSummary[];
}): string => {
  const lines: string[] = [];
  const body =
    input.message.trim() ||
    (input.hasAttachments ? "（已生成附件）" : "（空响应）");
  lines.push(`${input.isError ? "错误: " : ""}${body}`);
  lines.push(...formatTelegramToolCallLines(input.toolCalls));
  return lines.join("\n");
};

export const buildTelegramAssistantTimelineFromStreamEvents = (input: {
  streamEvents: ChatStreamEvent[];
  fallbackAssistantMessage: string;
  toolActions?: string[];
}): TelegramAssistantTimelineBlock[] => {
  const blocks: TelegramAssistantTimelineBlock[] = [];
  const toolBlockByUseId = new Map<string, TelegramAssistantTimelineToolBlock>();

  const appendAssistantDelta = (delta: string): void => {
    if (!delta) return;
    const last = blocks[blocks.length - 1];
    if (last?.type === "assistant") {
      last.message += delta;
      return;
    }
    blocks.push({
      type: "assistant",
      message: delta,
    });
  };

  const ensureToolBlock = (
    toolUseId: string | undefined,
    toolName: string | undefined,
  ): TelegramAssistantTimelineToolBlock => {
    const normalizedUseId = toolUseId?.trim() || undefined;
    const normalizedToolName = toolName?.trim() || "工具";

    if (normalizedUseId) {
      const existing = toolBlockByUseId.get(normalizedUseId);
      if (existing) {
        if (
          normalizedToolName &&
          (!existing.tool.toolName || existing.tool.toolName === "工具")
        ) {
          existing.tool.toolName = normalizedToolName;
        }
        return existing;
      }
    }

    const last = blocks[blocks.length - 1];
    if (
      !normalizedUseId &&
      last?.type === "tool" &&
      !last.tool.toolUseId &&
      !last.tool.output &&
      last.tool.toolName === normalizedToolName
    ) {
      return last;
    }

    const created: TelegramAssistantTimelineToolBlock = {
      type: "tool",
      tool: {
        toolUseId: normalizedUseId,
        toolName: normalizedToolName,
      },
    };
    blocks.push(created);
    if (normalizedUseId) {
      toolBlockByUseId.set(normalizedUseId, created);
    }
    return created;
  };

  for (const event of input.streamEvents) {
    if (event.type === "assistant_delta") {
      appendAssistantDelta(event.delta ?? "");
      continue;
    }

    if (event.type === "tool_start" || event.type === "tool_progress") {
      const toolBlock = ensureToolBlock(event.toolUseId, event.toolName);
      if (event.toolName?.trim()) {
        toolBlock.tool.toolName = event.toolName.trim();
      }
      const normalizedInput = normalizeTelegramToolDetail(
        event.toolInput,
        TELEGRAM_TOOL_INPUT_MAX_LENGTH,
      );
      if (normalizedInput) {
        toolBlock.tool.toolInput = toolBlock.tool.toolInput
          ? mergeTelegramToolDetail(toolBlock.tool.toolInput, normalizedInput)
          : normalizedInput;
      }
      continue;
    }

    if (event.type === "tool_output") {
      const toolBlock = ensureToolBlock(event.toolUseId, event.toolName);
      if (event.toolName?.trim()) {
        toolBlock.tool.toolName = event.toolName.trim();
      }
      const normalizedOutput = normalizeTelegramToolDetail(
        event.output,
        TELEGRAM_TOOL_OUTPUT_MAX_LENGTH,
      );
      if (normalizedOutput) {
        toolBlock.tool.output = mergeTelegramToolDetail(
          toolBlock.tool.output,
          normalizedOutput,
        );
      }
      continue;
    }

    if (event.type === "error" && event.error?.trim()) {
      blocks.push({
        type: "assistant",
        message: `错误: ${event.error.trim()}`,
      });
      continue;
    }

    if (
      event.type === "assistant_done" &&
      event.fullText?.trim() &&
      !blocks.some(
        (item) => item.type === "assistant" && item.message.trim().length > 0,
      )
    ) {
      appendAssistantDelta(event.fullText.trim());
    }
  }

  const toolActions = input.toolActions ?? [];
  for (const action of toolActions) {
    const normalizedAction = normalizeTelegramToolDetail(
      action,
      TELEGRAM_TOOL_OUTPUT_MAX_LENGTH,
    );
    if (!normalizedAction) continue;
    const hasSameOutput = blocks.some(
      (item) =>
        item.type === "tool" && item.tool.output?.trim() === normalizedAction,
    );
    if (hasSameOutput) continue;
    blocks.push({
      type: "tool",
      tool: {
        toolName: TOOL_SUMMARY_NAME,
        output: normalizedAction,
      },
    });
  }

  if (
    !blocks.some(
      (item) => item.type === "assistant" && item.message.trim().length > 0,
    )
  ) {
    const fallbackMessage = input.fallbackAssistantMessage.trim();
    if (fallbackMessage) {
      blocks.push({
        type: "assistant",
        message: fallbackMessage,
      });
    }
  }

  const normalizedBlocks: TelegramAssistantTimelineBlock[] = [];
  for (const block of blocks) {
    if (block.type === "assistant") {
      const message = block.message.trim();
      if (!message) continue;
      normalizedBlocks.push({
        type: "assistant",
        message,
      });
      continue;
    }

    const normalizedToolCall = normalizeTelegramToolCall(block.tool);
    if (!normalizedToolCall) continue;
    normalizedBlocks.push({
      type: "tool",
      tool: normalizedToolCall,
    });
  }

  return normalizedBlocks;
};

export const createTelegramAssistantProgressiveStreamer = (input: {
  sendToolRunningMessage?: (tool: TelegramToolCallSummary) => Promise<void>;
  sendToolDoneMessage?: (tool: TelegramToolCallSummary) => Promise<void>;
  sendAssistantMessage: (message: string, isError: boolean) => Promise<void>;
}): TelegramAssistantProgressiveStreamer => {
  let assistantBuffer = "";
  let sawAssistantDelta = false;
  let sentAssistantMessage = false;
  const toolsByKey = new Map<string, TelegramToolCallSummary>();
  const emittedToolOutputs = new Set<string>();
  const emittedRunningToolKeys = new Set<string>();
  const emittedDoneToolKeys = new Set<string>();
  let sendQueue: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>): void => {
    sendQueue = sendQueue.then(task).catch((error) => {
      logger.warn("Failed to send progressive telegram stream message", {
        error,
      });
    });
  };

  const flushAssistantBuffer = (): void => {
    const message = assistantBuffer.trim();
    assistantBuffer = "";
    if (!message) return;
    sentAssistantMessage = true;
    enqueue(() => input.sendAssistantMessage(message, false));
  };

  const toolKeyFrom = (
    toolUseId: string | undefined,
    toolName: string | undefined,
  ): string => {
    const normalizedUseId = toolUseId?.trim();
    if (normalizedUseId) {
      return `id:${normalizedUseId}`;
    }
    const normalizedToolName = toolName?.trim() || "工具";
    return `name:${normalizedToolName}`;
  };

  const ensureTool = (
    toolUseId: string | undefined,
    toolName: string | undefined,
  ): TelegramToolCallSummary => {
    const key = toolKeyFrom(toolUseId, toolName);
    const normalizedToolName = toolName?.trim() || "工具";
    const existing = toolsByKey.get(key);
    if (existing) {
      if (!existing.toolName || existing.toolName === "工具") {
        existing.toolName = normalizedToolName;
      }
      if (!existing.toolUseId && toolUseId?.trim()) {
        existing.toolUseId = toolUseId.trim();
      }
      return existing;
    }

    const created: TelegramToolCallSummary = {
      toolUseId: toolUseId?.trim() || undefined,
      toolName: normalizedToolName,
    };
    toolsByKey.set(key, created);
    return created;
  };

  const emitToolRunning = (
    tool: TelegramToolCallSummary,
    keyOverride?: string,
  ): void => {
    const normalized = normalizeTelegramToolCall(tool);
    if (!normalized) return;
    const key =
      keyOverride ??
      toolKeyFrom(normalized.toolUseId ?? undefined, normalized.toolName);
    if (emittedRunningToolKeys.has(key)) return;
    emittedRunningToolKeys.add(key);
    if (!input.sendToolRunningMessage) return;
    enqueue(() => input.sendToolRunningMessage!(normalized));
  };

  const emitToolDone = (
    tool: TelegramToolCallSummary,
    keyOverride?: string,
  ): void => {
    const normalized = normalizeTelegramToolCall(tool);
    if (!normalized) return;
    const key =
      keyOverride ??
      toolKeyFrom(normalized.toolUseId ?? undefined, normalized.toolName);
    if (emittedDoneToolKeys.has(key)) return;
    emittedDoneToolKeys.add(key);
    if (normalized.output?.trim()) {
      emittedToolOutputs.add(normalized.output.trim());
    }
    if (!input.sendToolDoneMessage) return;
    enqueue(() => input.sendToolDoneMessage!(normalized));
  };

  const pushEvent = (event: ChatStreamEvent): void => {
    if (event.type === "assistant_delta") {
      sawAssistantDelta = true;
      assistantBuffer += event.delta ?? "";
      return;
    }

    if (event.type === "assistant_done") {
      if (!sawAssistantDelta && event.fullText?.trim()) {
        assistantBuffer += event.fullText;
      }
      flushAssistantBuffer();
      return;
    }

    if (event.type === "tool_start" || event.type === "tool_progress") {
      flushAssistantBuffer();
      const tool = ensureTool(event.toolUseId, event.toolName);
      const normalizedInput = normalizeTelegramToolDetail(
        event.toolInput,
        TELEGRAM_TOOL_INPUT_MAX_LENGTH,
      );
      if (normalizedInput) {
        tool.toolInput = tool.toolInput
          ? mergeTelegramToolDetail(tool.toolInput, normalizedInput)
          : normalizedInput;
      }
      const key = toolKeyFrom(tool.toolUseId, tool.toolName);
      if (
        !emittedRunningToolKeys.has(key) &&
        (tool.toolInput?.trim() || event.type === "tool_progress")
      ) {
        emitToolRunning(tool, key);
      }
      return;
    }

    if (event.type === "tool_output") {
      flushAssistantBuffer();
      const tool = ensureTool(event.toolUseId, event.toolName);
      const normalizedOutput = normalizeTelegramToolDetail(
        event.output,
        TELEGRAM_TOOL_OUTPUT_MAX_LENGTH,
      );
      if (normalizedOutput) {
        tool.output = mergeTelegramToolDetail(tool.output, normalizedOutput);
      }
      const key = toolKeyFrom(tool.toolUseId, tool.toolName);
      if (!emittedRunningToolKeys.has(key)) {
        emitToolRunning(tool, key);
      }
      emitToolDone(tool, key);
      return;
    }

    if (event.type === "error" && event.error?.trim()) {
      flushAssistantBuffer();
      sentAssistantMessage = true;
      enqueue(() => input.sendAssistantMessage(event.error!.trim(), true));
    }
  };

  const finalize = async (finalInput: {
    fallbackAssistantMessage: string;
    toolActions?: string[];
    isError?: boolean;
  }): Promise<void> => {
    flushAssistantBuffer();

    for (const tool of toolsByKey.values()) {
      const key = toolKeyFrom(tool.toolUseId, tool.toolName);
      if (tool.output?.trim()) {
        if (!emittedRunningToolKeys.has(key)) {
          emitToolRunning(tool, key);
        }
        emitToolDone(tool, key);
        continue;
      }
      if (tool.toolInput?.trim() && !emittedRunningToolKeys.has(key)) {
        emitToolRunning(tool, key);
      }
    }

    for (const action of finalInput.toolActions ?? []) {
      const normalizedAction = normalizeTelegramToolDetail(
        action,
        TELEGRAM_TOOL_OUTPUT_MAX_LENGTH,
      );
      if (!normalizedAction) continue;
      const alreadyEmitted = Array.from(emittedToolOutputs).some(
        (existing) =>
          existing === normalizedAction ||
          existing.startsWith(normalizedAction.slice(0, 100)) ||
          normalizedAction.startsWith(existing.slice(0, 100)),
      );
      if (alreadyEmitted) continue;
      emitToolDone(
        {
          toolName: TOOL_SUMMARY_NAME,
          output: normalizedAction,
        },
        `summary:${normalizedAction}`,
      );
    }

    if (!sentAssistantMessage) {
      const fallback = finalInput.fallbackAssistantMessage.trim();
      if (fallback || finalInput.isError) {
        enqueue(() =>
          input.sendAssistantMessage(
            fallback || "（空响应）",
            Boolean(finalInput.isError),
          ),
        );
      }
    }

    await sendQueue;
  };

  return {
    pushEvent,
    finalize,
  };
};
