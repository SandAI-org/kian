import { toFriendlyToolName } from "@shared/utils/toolName";

export interface ToolCallInfo {
  toolUseId: string;
  toolName: string;
  status: "starting" | "running" | "done";
  toolInput?: string;
  output?: string;
}

export type StreamingBlock =
  | {
      kind: "assistant";
      key: string;
      content: string;
      createdAt: string;
    }
  | {
      kind: "thinking";
      key: string;
      content: string;
      createdAt: string;
    }
  | {
      kind: "tool";
      key: string;
      createdAt: string;
      tool: ToolCallInfo;
    };

const TOOL_STATUS_PRIORITY: Record<ToolCallInfo["status"], number> = {
  starting: 0,
  running: 1,
  done: 2,
};

export const formatToolDisplayName = (rawName: string): string => {
  return toFriendlyToolName(rawName);
};

const formatStreamingToolDisplayName = (
  rawName: string,
  toolInput?: string,
): string => {
  const normalizedName = rawName.trim() || "工具";
  if (normalizedName !== "callSubAgent") {
    return formatToolDisplayName(normalizedName);
  }

  const rawInput = toolInput?.trim();
  if (!rawInput) {
    return formatToolDisplayName(normalizedName);
  }

  try {
    const parsed = JSON.parse(rawInput) as {
      agent?: unknown;
      project?: unknown;
    };
    const targetName =
      typeof parsed.agent === "string"
        ? parsed.agent.trim()
        : typeof parsed.project === "string"
          ? parsed.project.trim()
          : "";
    if (!targetName) {
      return formatToolDisplayName(normalizedName);
    }
    return `${formatToolDisplayName(normalizedName)}（${targetName}）`;
  } catch {
    return formatToolDisplayName(normalizedName);
  }
};

const mergeToolStatus = (
  current: ToolCallInfo["status"],
  incoming: ToolCallInfo["status"],
): ToolCallInfo["status"] =>
  TOOL_STATUS_PRIORITY[incoming] > TOOL_STATUS_PRIORITY[current]
    ? incoming
    : current;

export const normalizeToolDetailText = (
  value: string | undefined,
): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const mergeToolDetailText = (
  existing: string | undefined,
  incoming: string | undefined,
): string | undefined => {
  const next = normalizeToolDetailText(incoming);
  if (!next) return normalizeToolDetailText(existing);

  const current = normalizeToolDetailText(existing);
  if (!current) return next;
  if (current === next || current.includes(next)) return current;
  if (next.includes(current)) return next;
  return `${current}\n${next}`;
};

const findLastBlockIndexByKind = (
  blocks: StreamingBlock[],
  kind: StreamingBlock["kind"],
): number => {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.kind === kind) {
      return index;
    }
  }
  return -1;
};

const appendStreamingTextDelta = (
  blocks: StreamingBlock[],
  delta: string,
  createdAt: string,
  createKey: (prefix: string) => string,
  kind: "assistant" | "thinking",
): StreamingBlock[] => {
  if (!delta) return blocks;
  const targetIndex = blocks.length - 1;
  const target =
    targetIndex >= 0 && targetIndex < blocks.length ? blocks[targetIndex] : undefined;

  if (target?.kind === kind) {
    const next = [...blocks];
    next[targetIndex] = {
      ...target,
      content: `${target.content}${delta}`,
    };
    return next;
  }
  return [
    ...blocks,
    {
      kind,
      key: createKey(kind === "assistant" ? "stream-assistant" : "stream-thinking"),
      content: delta,
      createdAt,
    },
  ];
};

const ensureStreamingTextDone = (
  blocks: StreamingBlock[],
  fullText: string | undefined,
  createdAt: string,
  createKey: (prefix: string) => string,
  kind: "assistant" | "thinking",
): StreamingBlock[] => {
  const text = fullText?.trim();
  if (!text) return blocks;
  const targetIndex =
    kind === "thinking"
      ? findLastBlockIndexByKind(blocks, kind)
      : blocks.findIndex(
          (block) => block.kind === kind && block.content.trim().length > 0,
        );

  if (targetIndex >= 0) {
    const target = blocks[targetIndex];
    if (target?.kind === kind) {
      if (target.content.trim() === text || target.content.includes(text)) {
        return blocks;
      }

      const next = [...blocks];
      next[targetIndex] = {
        ...target,
        content: text.includes(target.content) ? text : `${target.content}${text}`,
      };
      return next;
    }
  }

  return [
    ...blocks,
    {
      kind,
      key: createKey(kind === "assistant" ? "stream-assistant" : "stream-thinking"),
      content: text,
      createdAt,
    },
  ];
};

export const appendStreamingAssistantDelta = (
  blocks: StreamingBlock[],
  delta: string,
  createdAt: string,
  createKey: (prefix: string) => string,
): StreamingBlock[] =>
  appendStreamingTextDelta(
    blocks,
    delta,
    createdAt,
    createKey,
    "assistant",
  );

export const appendStreamingThinkingDelta = (
  blocks: StreamingBlock[],
  delta: string,
  createdAt: string,
  createKey: (prefix: string) => string,
): StreamingBlock[] =>
  appendStreamingTextDelta(
    blocks,
    delta,
    createdAt,
    createKey,
    "thinking",
  );

export const ensureStreamingAssistantDone = (
  blocks: StreamingBlock[],
  fullText: string | undefined,
  createdAt: string,
  createKey: (prefix: string) => string,
): StreamingBlock[] =>
  ensureStreamingTextDone(
    blocks,
    fullText,
    createdAt,
    createKey,
    "assistant",
  );

export const ensureStreamingThinkingDone = (
  blocks: StreamingBlock[],
  fullText: string | undefined,
  createdAt: string,
  createKey: (prefix: string) => string,
): StreamingBlock[] =>
  ensureStreamingTextDone(
    blocks,
    fullText,
    createdAt,
    createKey,
    "thinking",
  );

export const upsertStreamingTool = (
  blocks: StreamingBlock[],
  incoming: ToolCallInfo,
  createdAt: string,
  createKey: (prefix: string) => string,
): StreamingBlock[] => {
  const normalizedIncoming: ToolCallInfo = {
    ...incoming,
    toolName: formatStreamingToolDisplayName(
      incoming.toolName || "工具",
      incoming.toolInput,
    ),
    toolInput: normalizeToolDetailText(incoming.toolInput),
    output: normalizeToolDetailText(incoming.output),
  };

  let found = false;
  let changed = false;
  const nextBlocks = blocks.map((block) => {
    if (
      block.kind !== "tool" ||
      block.tool.toolUseId !== normalizedIncoming.toolUseId
    ) {
      return block;
    }

    found = true;
    const nextStatus = mergeToolStatus(
      block.tool.status,
      normalizedIncoming.status,
    );
    const nextName = block.tool.toolName || normalizedIncoming.toolName;
    const nextToolInput = mergeToolDetailText(
      block.tool.toolInput,
      normalizedIncoming.toolInput,
    );
    const nextOutput = mergeToolDetailText(
      block.tool.output,
      normalizedIncoming.output,
    );
    if (
      nextStatus === block.tool.status &&
      nextName === block.tool.toolName &&
      nextToolInput === block.tool.toolInput &&
      nextOutput === block.tool.output
    ) {
      return block;
    }

    changed = true;
    return {
      ...block,
      tool: {
        ...block.tool,
        status: nextStatus,
        toolName: nextName,
        toolInput: nextToolInput,
        output: nextOutput,
      },
    };
  });

  if (found) {
    return changed ? nextBlocks : blocks;
  }

  return [
    ...nextBlocks,
    {
      kind: "tool",
      key: createKey("stream-tool"),
      createdAt,
      tool: normalizedIncoming,
    },
  ];
};
