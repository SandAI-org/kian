import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  Message,
  Model,
  Api,
  TextContent,
  ThinkingLevel,
  Tool,
  ToolCall,
} from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";

/** Request validation failure surfaced to the client as a 400. */
export class OpenAiRequestError extends Error {}

interface OpenAiContentPart {
  type?: string;
  text?: string;
  image_url?: { url?: string };
}

interface OpenAiToolCallInput {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChatMessage {
  role?: string;
  content?: string | OpenAiContentPart[] | null;
  tool_calls?: OpenAiToolCallInput[];
  tool_call_id?: string;
}

export interface OpenAiChatCompletionRequest {
  model?: string;
  messages?: OpenAiChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: string;
  tools?: Array<{
    type?: string;
    function?: { name?: string; description?: string; parameters?: unknown };
  }>;
}

export interface TranslatedRequest {
  context: Context;
  temperature?: number;
  maxTokens?: number;
  reasoning?: ThinkingLevel;
}

const IMAGE_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

const REASONING_LEVELS: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const toImageContent = async (url: string): Promise<ImageContent> => {
  const dataUriMatch = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  if (dataUriMatch) {
    return { type: "image", mimeType: dataUriMatch[1], data: dataUriMatch[2] };
  }
  if (!/^https?:\/\//.test(url)) {
    throw new OpenAiRequestError(
      "image_url must be a data: URI or an http(s) URL",
    );
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new OpenAiRequestError(
      `failed to download image_url (${response.status}): ${url}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > IMAGE_DOWNLOAD_LIMIT_BYTES) {
    throw new OpenAiRequestError(`image_url exceeds 20MB limit: ${url}`);
  }
  return {
    type: "image",
    mimeType: response.headers.get("content-type")?.split(";")[0] || "image/png",
    data: buffer.toString("base64"),
  };
};

const toUserContent = async (
  content: string | OpenAiContentPart[],
): Promise<string | (TextContent | ImageContent)[]> => {
  if (typeof content === "string") return content;
  const parts: (TextContent | ImageContent)[] = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text ?? "" });
    } else if (part.type === "image_url") {
      if (!part.image_url?.url) {
        throw new OpenAiRequestError("image_url part is missing url");
      }
      parts.push(await toImageContent(part.image_url.url));
    } else {
      throw new OpenAiRequestError(
        `unsupported content part type: ${part.type ?? "unknown"}`,
      );
    }
  }
  return parts;
};

const textOfContent = (
  content: string | OpenAiContentPart[] | null | undefined,
): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
};

const parseToolArguments = (raw: string | undefined): Record<string, any> => {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new OpenAiRequestError(`tool call arguments are not valid JSON: ${raw}`);
  }
};

export const translateRequest = async (
  request: OpenAiChatCompletionRequest,
  model: Model<Api>,
): Promise<TranslatedRequest> => {
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new OpenAiRequestError("messages must be a non-empty array");
  }

  const systemParts: string[] = [];
  const messages: Message[] = [];
  const toolNamesById = new Map<string, string>();

  for (const message of request.messages) {
    switch (message.role) {
      case "system":
      case "developer": {
        systemParts.push(textOfContent(message.content));
        break;
      }
      case "user": {
        messages.push({
          role: "user",
          content: await toUserContent(message.content ?? ""),
          timestamp: Date.now(),
        });
        break;
      }
      case "assistant": {
        const content: (TextContent | ToolCall)[] = [];
        const text = textOfContent(message.content);
        if (text) {
          content.push({ type: "text", text });
        }
        for (const toolCall of message.tool_calls ?? []) {
          const id = toolCall.id || randomUUID();
          const name = toolCall.function?.name ?? "";
          toolNamesById.set(id, name);
          content.push({
            type: "toolCall",
            id,
            name,
            arguments: parseToolArguments(toolCall.function?.arguments),
          });
        }
        messages.push({
          role: "assistant",
          content,
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: (message.tool_calls?.length ?? 0) > 0 ? "toolUse" : "stop",
          timestamp: Date.now(),
        });
        break;
      }
      case "tool": {
        if (!message.tool_call_id) {
          throw new OpenAiRequestError("tool message is missing tool_call_id");
        }
        messages.push({
          role: "toolResult",
          toolCallId: message.tool_call_id,
          toolName: toolNamesById.get(message.tool_call_id) ?? "",
          content: [{ type: "text", text: textOfContent(message.content) }],
          isError: false,
          timestamp: Date.now(),
        });
        break;
      }
      default:
        throw new OpenAiRequestError(
          `unsupported message role: ${message.role ?? "unknown"}`,
        );
    }
  }

  let tools: Tool[] | undefined;
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    tools = request.tools
      .filter((tool) => tool.type === "function" && tool.function?.name)
      .map((tool) => ({
        name: tool.function!.name!,
        description: tool.function!.description ?? "",
        parameters: (tool.function!.parameters ?? {
          type: "object",
          properties: {},
        }) as Tool["parameters"],
      }));
  }

  const maxTokens = request.max_completion_tokens ?? request.max_tokens;
  const reasoning =
    model.reasoning &&
    REASONING_LEVELS.includes(request.reasoning_effort as ThinkingLevel)
      ? (request.reasoning_effort as ThinkingLevel)
      : undefined;

  return {
    context: {
      systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages,
      tools,
    },
    temperature: request.temperature,
    maxTokens,
    reasoning,
  };
};

const FINISH_REASONS: Record<string, string> = {
  stop: "stop",
  length: "length",
  toolUse: "tool_calls",
};

const toOpenAiUsage = (usage: AssistantMessage["usage"]) => {
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: usage.output,
    total_tokens: promptTokens + usage.output,
    prompt_tokens_details: { cached_tokens: usage.cacheRead },
    ...(usage.reasoning !== undefined
      ? { completion_tokens_details: { reasoning_tokens: usage.reasoning } }
      : {}),
  };
};

const toOpenAiToolCall = (toolCall: ToolCall) => ({
  id: toolCall.id,
  type: "function" as const,
  function: {
    name: toolCall.name,
    arguments: JSON.stringify(toolCall.arguments),
  },
});

export const translateResponse = (
  message: AssistantMessage,
  requestModel: string,
): Record<string, unknown> => {
  const text = message.content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("");
  const reasoning = message.content
    .filter((item) => item.type === "thinking")
    .map((item) => item.thinking)
    .join("");
  const toolCalls = message.content
    .filter((item): item is ToolCall => item.type === "toolCall")
    .map(toOpenAiToolCall);

  return {
    id: `chatcmpl-${message.responseId ?? randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(message.timestamp / 1000),
    model: requestModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || (toolCalls.length > 0 ? null : ""),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: FINISH_REASONS[message.stopReason] ?? "stop",
      },
    ],
    usage: toOpenAiUsage(message.usage),
  };
};

/**
 * Stateful translator turning a pi AssistantMessageEvent sequence into
 * OpenAI chat.completion.chunk payloads for one streamed response.
 */
export class StreamTranslator {
  private readonly id = `chatcmpl-${randomUUID()}`;
  private readonly created = Math.floor(Date.now() / 1000);
  private roleSent = false;
  private nextToolIndex = 0;
  private readonly toolIndexByContentIndex = new Map<number, number>();
  private readonly toolArgsSeen = new Set<number>();

  constructor(private readonly requestModel: string) {}

  private chunk(
    delta: Record<string, unknown>,
    finishReason: string | null = null,
    usage?: AssistantMessage["usage"],
  ): Record<string, unknown> {
    if (!this.roleSent) {
      this.roleSent = true;
      delta = { role: "assistant", ...delta };
    }
    return {
      id: this.id,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.requestModel,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage: toOpenAiUsage(usage) } : {}),
    };
  }

  translate(event: AssistantMessageEvent): Record<string, unknown>[] {
    switch (event.type) {
      case "start":
        return [this.chunk({})];
      case "text_delta":
        return [this.chunk({ content: event.delta })];
      case "thinking_delta":
        return [this.chunk({ reasoning_content: event.delta })];
      case "toolcall_start": {
        const toolIndex = this.nextToolIndex++;
        this.toolIndexByContentIndex.set(event.contentIndex, toolIndex);
        const started = event.partial.content[event.contentIndex];
        if (started?.type !== "toolCall") return [];
        return [
          this.chunk({
            tool_calls: [
              {
                index: toolIndex,
                id: started.id,
                type: "function",
                function: { name: started.name, arguments: "" },
              },
            ],
          }),
        ];
      }
      case "toolcall_delta": {
        const toolIndex = this.toolIndexByContentIndex.get(event.contentIndex);
        if (toolIndex === undefined) return [];
        this.toolArgsSeen.add(toolIndex);
        return [
          this.chunk({
            tool_calls: [{ index: toolIndex, function: { arguments: event.delta } }],
          }),
        ];
      }
      case "toolcall_end": {
        const toolIndex = this.toolIndexByContentIndex.get(event.contentIndex);
        // Providers that never emitted argument deltas still need the
        // arguments to reach the client before the stream finishes.
        if (toolIndex === undefined || this.toolArgsSeen.has(toolIndex)) {
          return [];
        }
        return [
          this.chunk({
            tool_calls: [
              {
                index: toolIndex,
                function: { arguments: JSON.stringify(event.toolCall.arguments) },
              },
            ],
          }),
        ];
      }
      case "done":
        return [
          this.chunk({}, FINISH_REASONS[event.reason] ?? "stop", event.message.usage),
        ];
      default:
        return [];
    }
  }
}
