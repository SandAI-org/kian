import { describe, expect, it } from "vitest";

import {
  appendStreamingAssistantDelta,
  appendStreamingThinkingDelta,
  ensureStreamingThinkingDone,
  type StreamingBlock,
  upsertStreamingTool,
} from "../../src/renderer/modules/chat/streamingState";

describe("streamingState thinking blocks", () => {
  const createKey = (prefix: string): string => `${prefix}-1`;

  it("keeps interleaved thinking deltas in separate blocks", () => {
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

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({
      kind: "thinking",
      content: "first thought",
    });
    expect(blocks[1]).toMatchObject({
      kind: "assistant",
      content: "answer",
    });
    expect(blocks[2]).toMatchObject({
      kind: "thinking",
      content: " second thought",
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

  it("shows the target agent name for callSubAgent while streaming", () => {
    const blocks = upsertStreamingTool(
      [],
      {
        toolUseId: "tool-1",
        toolName: "callSubAgent",
        status: "starting",
        toolInput: JSON.stringify({ agent: "老婆" }),
      },
      "2026-03-17T00:00:00.000Z",
      createKey,
    );

    expect(blocks[0]).toMatchObject({
      kind: "tool",
      tool: {
        toolName: "Call Sub Agent（老婆）",
      },
    });
  });
});
