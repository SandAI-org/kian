import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  ToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  OpenAiRequestError,
  StreamTranslator,
  translateRequest,
  translateResponse,
} from "../../electron/main/services/openaiCompat/translate";

const model = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "test-provider",
  baseUrl: "https://example.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
} as unknown as Model<Api>;

const usage = {
  input: 10,
  output: 5,
  cacheRead: 3,
  cacheWrite: 2,
  totalTokens: 20,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistantMessage = (
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text: "你好" }],
  api: "openai-completions",
  provider: "test-provider",
  model: "test-model",
  usage,
  stopReason: "stop",
  timestamp: 1_754_000_000_000,
  ...overrides,
});

describe("translateRequest", () => {
  it("converts system/user/assistant/tool messages into a pi context", async () => {
    const result = await translateRequest(
      {
        model: "test-provider:test-model",
        messages: [
          { role: "system", content: "系统提示" },
          { role: "user", content: "查天气" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: { name: "get_weather", arguments: '{"city":"北京"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "晴天" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "查询天气",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        temperature: 0.7,
        max_tokens: 100,
        reasoning_effort: "high",
      },
      model,
    );

    expect(result.context.systemPrompt).toBe("系统提示");
    expect(result.context.messages).toHaveLength(3);
    expect(result.context.messages[0]).toMatchObject({
      role: "user",
      content: "查天气",
    });
    expect(result.context.messages[1]).toMatchObject({
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "call_1",
          name: "get_weather",
          arguments: { city: "北京" },
        },
      ],
    });
    expect(result.context.messages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "get_weather",
      content: [{ type: "text", text: "晴天" }],
    });
    expect(result.context.tools).toHaveLength(1);
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(100);
    expect(result.reasoning).toBe("high");
  });

  it("converts data-URI image parts and merges multiple system messages", async () => {
    const result = await translateRequest(
      {
        model: "m",
        messages: [
          { role: "system", content: "A" },
          { role: "developer", content: "B" },
          {
            role: "user",
            content: [
              { type: "text", text: "看图" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,aGVsbG8=" },
              },
            ],
          },
        ],
      },
      model,
    );

    expect(result.context.systemPrompt).toBe("A\n\nB");
    expect(result.context.messages[0].content).toEqual([
      { type: "text", text: "看图" },
      { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
    ]);
  });

  it("ignores reasoning_effort for non-reasoning models and unknown levels", async () => {
    const plainModel = { ...model, reasoning: false } as Model<Api>;
    const result = await translateRequest(
      {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "high",
      },
      plainModel,
    );
    expect(result.reasoning).toBeUndefined();

    const unknownLevel = await translateRequest(
      {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "none",
      },
      model,
    );
    expect(unknownLevel.reasoning).toBeUndefined();
  });

  it("prefers max_completion_tokens over max_tokens", async () => {
    const result = await translateRequest(
      {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
        max_completion_tokens: 200,
      },
      model,
    );
    expect(result.maxTokens).toBe(200);
  });

  it("rejects empty messages and invalid tool arguments", async () => {
    await expect(translateRequest({ model: "m", messages: [] }, model)).rejects.toThrow(
      OpenAiRequestError,
    );
    await expect(
      translateRequest(
        {
          model: "m",
          messages: [
            {
              role: "assistant",
              tool_calls: [{ id: "c", function: { name: "f", arguments: "{bad" } }],
            },
          ],
        },
        model,
      ),
    ).rejects.toThrow(OpenAiRequestError);
  });
});

describe("translateResponse", () => {
  it("maps text, tool calls, thinking, usage and finish reason", () => {
    const message = assistantMessage({
      content: [
        { type: "thinking", thinking: "推理中" },
        { type: "text", text: "你好" },
        { type: "toolCall", id: "call_9", name: "fn", arguments: { a: 1 } },
      ],
      stopReason: "toolUse",
      responseId: "resp-1",
    });
    const result = translateResponse(message, "test-provider:test-model") as any;

    expect(result.id).toBe("chatcmpl-resp-1");
    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe("test-provider:test-model");
    expect(result.choices[0].finish_reason).toBe("tool_calls");
    expect(result.choices[0].message.content).toBe("你好");
    expect(result.choices[0].message.reasoning_content).toBe("推理中");
    expect(result.choices[0].message.tool_calls).toEqual([
      {
        id: "call_9",
        type: "function",
        function: { name: "fn", arguments: '{"a":1}' },
      },
    ]);
    expect(result.usage).toMatchObject({
      prompt_tokens: 15,
      completion_tokens: 5,
      total_tokens: 20,
      prompt_tokens_details: { cached_tokens: 3 },
    });
  });

  it("returns null content when only tool calls are present", () => {
    const message = assistantMessage({
      content: [{ type: "toolCall", id: "c", name: "fn", arguments: {} }],
      stopReason: "toolUse",
    });
    const result = translateResponse(message, "m") as any;
    expect(result.choices[0].message.content).toBeNull();
  });
});

describe("StreamTranslator", () => {
  const partialWithToolCall = (toolCall: ToolCall): AssistantMessage =>
    assistantMessage({ content: [toolCall] });

  it("emits role first, then content and finish chunks", () => {
    const translator = new StreamTranslator("m");
    const start = translator.translate({
      type: "start",
      partial: assistantMessage(),
    }) as any[];
    expect(start[0].choices[0].delta).toEqual({ role: "assistant" });

    const delta = translator.translate({
      type: "text_delta",
      contentIndex: 0,
      delta: "你",
      partial: assistantMessage(),
    }) as any[];
    expect(delta[0].choices[0].delta).toEqual({ content: "你" });

    const thinking = translator.translate({
      type: "thinking_delta",
      contentIndex: 0,
      delta: "思考",
      partial: assistantMessage(),
    }) as any[];
    expect(thinking[0].choices[0].delta).toEqual({ reasoning_content: "思考" });

    const done = translator.translate({
      type: "done",
      reason: "stop",
      message: assistantMessage(),
    }) as any[];
    expect(done[0].choices[0].finish_reason).toBe("stop");
    expect(done[0].usage.total_tokens).toBe(20);
  });

  it("streams tool calls with argument deltas", () => {
    const translator = new StreamTranslator("m");
    translator.translate({ type: "start", partial: assistantMessage() });

    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_1",
      name: "fn",
      arguments: {},
    };
    const started = translator.translate({
      type: "toolcall_start",
      contentIndex: 0,
      partial: partialWithToolCall(toolCall),
    }) as any[];
    expect(started[0].choices[0].delta.tool_calls[0]).toMatchObject({
      index: 0,
      id: "call_1",
      function: { name: "fn", arguments: "" },
    });

    const delta = translator.translate({
      type: "toolcall_delta",
      contentIndex: 0,
      delta: '{"a":',
      partial: partialWithToolCall(toolCall),
    }) as any[];
    expect(delta[0].choices[0].delta.tool_calls[0]).toEqual({
      index: 0,
      function: { arguments: '{"a":' },
    });

    const ended = translator.translate({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { ...toolCall, arguments: { a: 1 } },
      partial: partialWithToolCall(toolCall),
    });
    expect(ended).toEqual([]);
  });

  it("emits full arguments at toolcall_end when no deltas were streamed", () => {
    const translator = new StreamTranslator("m");
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_1",
      name: "fn",
      arguments: { a: 1 },
    };
    translator.translate({
      type: "toolcall_start",
      contentIndex: 0,
      partial: partialWithToolCall(toolCall),
    });
    const ended = translator.translate({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall,
      partial: partialWithToolCall(toolCall),
    }) as any[];
    expect(ended[0].choices[0].delta.tool_calls[0]).toEqual({
      index: 0,
      function: { arguments: '{"a":1}' },
    });
  });

  it("ignores text_end and thinking events without payload", () => {
    const translator = new StreamTranslator("m");
    const events: AssistantMessageEvent[] = [
      {
        type: "text_start",
        contentIndex: 0,
        partial: assistantMessage(),
      },
      {
        type: "text_end",
        contentIndex: 0,
        content: "全文",
        partial: assistantMessage(),
      },
    ];
    for (const event of events) {
      expect(translator.translate(event)).toEqual([]);
    }
  });
});
