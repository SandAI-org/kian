import { describe, expect, it } from "vitest";

import {
  appendStreamingAssistantDelta,
  appendStreamingThinkingDelta,
  ensureStreamingThinkingDone,
  type StreamingBlock,
} from "../../src/renderer/modules/chat/streamingState";

describe("streamingState thinking merge", () => {
  const createKey = (prefix: string): string => `${prefix}-1`;

  it("merges thinking deltas into a single block even when assistant text is interleaved", () => {
    let blocks: StreamingBlock[] = [];

    blocks = appendStreamingThinkingDelta(
      blocks,
      "first thought",
      "2026-03-17T00:00:00.000Z",
      createKey,
    );
    blocks = appendStreamingAssistantDelta(
      blocks,
      "answer",
      "2026-03-17T00:00:01.000Z",
      createKey,
    );
    blocks = appendStreamingThinkingDelta(
      blocks,
      " second thought",
      "2026-03-17T00:00:02.000Z",
      createKey,
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: "thinking",
      content: "first thought second thought",
    });
    expect(blocks[1]).toMatchObject({
      kind: "assistant",
      content: "answer",
    });
  });

  it("keeps a single thinking block when the final thinking content arrives", () => {
    let blocks: StreamingBlock[] = [];

    blocks = appendStreamingThinkingDelta(
      blocks,
      "partial",
      "2026-03-17T00:00:00.000Z",
      createKey,
    );
    blocks = appendStreamingAssistantDelta(
      blocks,
      "answer",
      "2026-03-17T00:00:01.000Z",
      createKey,
    );
    blocks = ensureStreamingThinkingDone(
      blocks,
      "partial with suffix",
      "2026-03-17T00:00:02.000Z",
      createKey,
    );

    expect(blocks.filter((block) => block.kind === "thinking")).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "thinking",
      content: "partial with suffix",
    });
  });
});
