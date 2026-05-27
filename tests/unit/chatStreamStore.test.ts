import { beforeEach, describe, expect, it } from "vitest";

import { useChatStreamStore } from "../../src/renderer/store/chatStreamStore";
import type { ChatStreamEvent } from "../../src/shared/types";

const createStreamEvent = (
  event: Partial<ChatStreamEvent>,
): ChatStreamEvent => ({
  requestId: "req-1",
  sessionId: "session-1",
  scope: { type: "main" },
  module: "main",
  type: "assistant_delta",
  delta: "hello",
  ...event,
});

describe("chatStreamStore", () => {
  beforeEach(() => {
    useChatStreamStore.setState({ sessions: {} });
  });

  it("tracks the active request from delta events without a start event", () => {
    useChatStreamStore
      .getState()
      .ingestStreamEvent(createStreamEvent({ requestId: "req-from-delta" }));

    expect(
      useChatStreamStore.getState().sessions["session-1"]?.activeRequestId,
    ).toBe("req-from-delta");
  });
});
