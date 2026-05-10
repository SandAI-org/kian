import { describe, expect, it, vi } from "vitest";
import { attachAgentLlmRequestDebug } from "../../electron/main/services/llmRequestDebug";

describe("llmRequestDebug", () => {
  it("wraps the existing stream function without dropping auth options", async () => {
    let forwardedOptions:
      | {
          apiKey?: string;
          onPayload?: (payload: unknown, model: unknown) => Promise<unknown>;
        }
      | undefined;
    const streamResult = {};
    const streamFn = vi.fn((_model, _context, options) => {
      forwardedOptions = options;
      return streamResult;
    });
    const agent = { streamFn };

    attachAgentLlmRequestDebug(agent, () => ({ kind: "agent" }));

    const payloadTransform = vi.fn(async (payload: unknown) => ({
      ...(payload as Record<string, unknown>),
      transformed: true,
    }));
    const result = agent.streamFn(
      { provider: "openrouter", id: "deepseek-chat" },
      { systemPrompt: "", messages: [], tools: [] },
      {
        apiKey: "openrouter-key",
        onPayload: payloadTransform,
      },
    );

    expect(result).toBe(streamResult);
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(forwardedOptions?.apiKey).toBe("openrouter-key");
    await expect(
      forwardedOptions?.onPayload?.({ message: "hello" }, {}),
    ).resolves.toEqual({
      message: "hello",
      transformed: true,
    });
  });
});
