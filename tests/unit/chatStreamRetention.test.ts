import { describe, expect, it } from "vitest";

import { shouldRetainCompletedStreamingBlocks } from "../../src/shared/utils/chatStreamRetention";

describe("shouldRetainCompletedStreamingBlocks", () => {
  it("retains completed blocks when the next queued request starts after the previous request finished", () => {
    expect(
      shouldRetainCompletedStreamingBlocks({
        previousSessionId: "session-1",
        currentSessionId: "session-1",
        previousActiveRequestId: undefined,
        activeRequestId: "req-queued",
        previousStreamingBlockCount: 1,
      }),
    ).toBe(true);
  });

  it("retains blocks when the next request starts before the previous stream has been terminalized locally", () => {
    expect(
      shouldRetainCompletedStreamingBlocks({
        previousSessionId: "session-1",
        currentSessionId: "session-1",
        previousActiveRequestId: "req-root",
        activeRequestId: "req-queued",
        previousStreamingBlockCount: 1,
      }),
    ).toBe(true);
  });

  it("does not retain blocks when there is no new active request", () => {
    expect(
      shouldRetainCompletedStreamingBlocks({
        previousSessionId: "session-1",
        currentSessionId: "session-1",
        previousActiveRequestId: undefined,
        activeRequestId: undefined,
        previousStreamingBlockCount: 1,
      }),
    ).toBe(false);
  });
});
