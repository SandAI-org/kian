import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatStreamSmoother,
  STREAM_SMOOTHING_INTERVAL_MS,
  STREAM_SMOOTHING_MAX_CHARS,
  splitDeltaText,
} from "../../src/renderer/store/chatStreamSmoother";
import type { ChatStreamEvent } from "../../src/shared/types";

const createAssistantDelta = (
  delta: string,
  overrides: Partial<ChatStreamEvent> = {},
): ChatStreamEvent => ({
  requestId: "req-1",
  sessionId: "session-1",
  scope: { type: "main" },
  module: "main",
  type: "assistant_delta",
  delta,
  ...overrides,
});

describe("chatStreamSmoother", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("splits long delta text into smaller pieces", () => {
    const delta = "1234567890abcdefghijklmn";

    expect(splitDeltaText(delta)).toEqual([
      "1234567890ab",
      "cdefghijklmn",
    ]);
    expect(splitDeltaText("短文本")).toEqual(["短文本"]);
    expect(splitDeltaText("")).toEqual([]);
  });

  it("replays pending delta chunks over time", () => {
    vi.useFakeTimers();
    const smoother = new ChatStreamSmoother();
    const emitted: ChatStreamEvent[] = [];
    const delta = "1234567890abcdefghijklmn";

    smoother.push(createAssistantDelta(delta), (event) => {
      emitted.push(event);
    });

    expect(emitted.map((event) => event.delta)).toEqual(["1234567890ab"]);

    vi.advanceTimersByTime(STREAM_SMOOTHING_INTERVAL_MS);
    expect(emitted.map((event) => event.delta)).toEqual([
      "1234567890ab",
      "cdefghijklmn",
    ]);
  });

  it("flushes pending chunks before terminal events", () => {
    vi.useFakeTimers();
    const smoother = new ChatStreamSmoother();
    const emitted: ChatStreamEvent[] = [];
    const delta = "1234567890abcdefghijklmn";

    smoother.push(createAssistantDelta(delta), (event) => {
      emitted.push(event);
    });
    smoother.push(
      {
        requestId: "req-1",
        sessionId: "session-1",
        scope: { type: "main" },
        module: "main",
        type: "assistant_done",
        fullText: delta,
      },
      (event) => {
        emitted.push(event);
      },
    );

    expect(emitted.map((event) => event.type)).toEqual([
      "assistant_delta",
      "assistant_delta",
      "assistant_done",
    ]);
    expect(emitted[1]?.delta).toBe("cdefghijklmn");
    expect(emitted[2]?.fullText).toBe(delta);
  });

  it("flushes all pending chunks for a session", () => {
    vi.useFakeTimers();
    const smoother = new ChatStreamSmoother();
    const emitted: ChatStreamEvent[] = [];
    const first = "1234567890abcdefghijklmn";
    const second = "ABCDEFGHIJKLmnopqrstuvwx";

    smoother.push(createAssistantDelta(first), (event) => {
      emitted.push(event);
    });
    smoother.push(
      createAssistantDelta(second, {
        requestId: "req-2",
      }),
      (event) => {
        emitted.push(event);
      },
    );

    smoother.flushSession("session-1", (event) => {
      emitted.push(event);
    });

    expect(
      emitted
        .filter((event) => event.type === "assistant_delta")
        .map((event) => event.delta),
    ).toEqual([
      first.slice(0, STREAM_SMOOTHING_MAX_CHARS),
      second.slice(0, STREAM_SMOOTHING_MAX_CHARS),
      first.slice(STREAM_SMOOTHING_MAX_CHARS),
      second.slice(STREAM_SMOOTHING_MAX_CHARS),
    ]);
  });
});
