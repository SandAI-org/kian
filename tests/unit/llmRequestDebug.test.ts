import type { Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { attachAgentLlmRequestDebug } from "../../electron/main/services/llmRequestDebug";

describe("llmRequestDebug", () => {
  it("preserves payload transformations without replacing the authenticated stream", async () => {
    const streamFunction = vi.fn();
    const payloadTransform = vi.fn(async (payload: unknown) => ({
      ...(payload as Record<string, unknown>),
      transformed: true,
    }));
    const agent = {
      streamFunction,
      onPayload: payloadTransform as SimpleStreamOptions["onPayload"],
    };
    const model = { provider: "openrouter", id: "deepseek-chat" } as Model<any>;

    attachAgentLlmRequestDebug(agent, () => ({ kind: "agent" }));
    attachAgentLlmRequestDebug(agent, () => ({ kind: "agent", requestId: "next" }));

    await expect(agent.onPayload?.({ message: "hello" }, model)).resolves.toEqual({
      message: "hello",
      transformed: true,
    });
    expect(payloadTransform).toHaveBeenCalledExactlyOnceWith({ message: "hello" }, model);
    expect(agent.streamFunction).toBe(streamFunction);
  });
});
