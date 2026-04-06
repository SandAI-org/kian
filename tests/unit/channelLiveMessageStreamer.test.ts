import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditableChannelReplyStreamer } from "../../electron/main/services/chatChannel/channelLiveMessageStreamer";

describe("createEditableChannelReplyStreamer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeStreamer = (options?: { onStreamingDone?: () => Promise<void> }) => {
    const sendLiveMessage = vi.fn().mockResolvedValue("msg_001");
    const updateLiveMessage = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendDocument = vi.fn().mockResolvedValue(undefined);

    const streamer = createEditableChannelReplyStreamer({
      projectId: "main-agent",
      sendLiveMessage,
      updateLiveMessage,
      sendText,
      sendDocument,
      liveMessageMaxLength: 20_000,
      onStreamingDone: options?.onStreamingDone,
    });

    return { streamer, sendLiveMessage, updateLiveMessage, sendText, sendDocument };
  };

  const baseEvent = {
    requestId: "req_001",
    sessionId: "session_001",
    scope: { type: "main" as const },
    module: "main" as const,
  };

  it("sends tool running message and updates with assistant text", async () => {
    const { streamer, sendLiveMessage, updateLiveMessage, sendText, sendDocument } = makeStreamer();

    streamer.pushEvent({
      ...baseEvent,
      type: "tool_start",
      toolUseId: "tool_001",
      toolName: "exec_command",
    });

    await vi.runAllTimersAsync();

    streamer.pushEvent({
      ...baseEvent,
      type: "assistant_delta",
      delta: "Hello",
    });

    await vi.runAllTimersAsync();
    await streamer.finalize({
      fallbackAssistantMessage: "Hello",
      toolActions: [],
    });

    expect(sendLiveMessage).toHaveBeenCalledTimes(1);
    expect(sendLiveMessage).toHaveBeenCalledWith("正在执行工具 Exec Command");

    const lastUpdate =
      updateLiveMessage.mock.calls[updateLiveMessage.mock.calls.length - 1];
    expect(lastUpdate?.[1]).toBe("Hello");
    expect(sendText).not.toHaveBeenCalled();
    expect(sendDocument).not.toHaveBeenCalled();
  });

  it("updates tool running to tool done on the same card", async () => {
    const { streamer, sendLiveMessage, updateLiveMessage } = makeStreamer();

    streamer.pushEvent({
      ...baseEvent,
      type: "tool_start",
      toolUseId: "tool_001",
      toolName: "exec_command",
    });

    await vi.runAllTimersAsync();

    streamer.pushEvent({
      ...baseEvent,
      type: "tool_output",
      toolUseId: "tool_001",
      toolName: "exec_command",
      output: "done",
    });

    await vi.runAllTimersAsync();

    expect(sendLiveMessage).toHaveBeenCalledTimes(1);
    expect(sendLiveMessage).toHaveBeenCalledWith("正在执行工具 Exec Command");
    expect(updateLiveMessage).toHaveBeenCalledWith(
      "msg_001",
      "Exec Command 工具执行完成",
    );
  });

  it("tool done is replaced by final assistant message on the same card", async () => {
    const { streamer, sendLiveMessage, updateLiveMessage } = makeStreamer();

    streamer.pushEvent({
      ...baseEvent,
      type: "tool_start",
      toolUseId: "tool_001",
      toolName: "exec_command",
    });
    streamer.pushEvent({
      ...baseEvent,
      type: "tool_output",
      toolUseId: "tool_001",
      toolName: "exec_command",
      output: "ok",
    });

    await vi.runAllTimersAsync();

    streamer.pushEvent({
      ...baseEvent,
      type: "assistant_delta",
      delta: "Result is good",
    });

    await vi.runAllTimersAsync();
    await streamer.finalize({
      fallbackAssistantMessage: "Result is good",
      toolActions: [],
    });

    expect(sendLiveMessage).toHaveBeenCalledWith("正在执行工具 Exec Command");

    const lastUpdate =
      updateLiveMessage.mock.calls[updateLiveMessage.mock.calls.length - 1];
    expect(lastUpdate?.[1]).toBe("Result is good");
  });

  it("calls onStreamingDone at the end of finalize", async () => {
    const onStreamingDone = vi.fn().mockResolvedValue(undefined);
    const { streamer } = makeStreamer({ onStreamingDone });

    streamer.pushEvent({
      ...baseEvent,
      type: "assistant_delta",
      delta: "Hello",
    });

    await vi.runAllTimersAsync();
    await streamer.finalize({
      fallbackAssistantMessage: "Hello",
      toolActions: [],
    });

    expect(onStreamingDone).toHaveBeenCalledTimes(1);
  });

  it("does not throw if onStreamingDone fails", async () => {
    const onStreamingDone = vi.fn().mockRejectedValue(new Error("fail"));
    const { streamer } = makeStreamer({ onStreamingDone });

    streamer.pushEvent({
      ...baseEvent,
      type: "assistant_delta",
      delta: "Hello",
    });

    await vi.runAllTimersAsync();
    await expect(
      streamer.finalize({
        fallbackAssistantMessage: "Hello",
        toolActions: [],
      }),
    ).resolves.not.toThrow();

    expect(onStreamingDone).toHaveBeenCalledTimes(1);
  });

  it("starts a new card when tool event arrives after assistant text", async () => {
    const sendLiveMessage = vi
      .fn()
      .mockResolvedValueOnce("msg_001")
      .mockResolvedValueOnce("msg_002");
    const updateLiveMessage = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);

    const streamer = createEditableChannelReplyStreamer({
      projectId: "main-agent",
      sendLiveMessage,
      updateLiveMessage,
      sendText,
      liveMessageMaxLength: 20_000,
    });

    // First round: tool → assistant text
    streamer.pushEvent({
      ...baseEvent,
      type: "tool_start",
      toolUseId: "tool_001",
      toolName: "exec_command",
    });
    await vi.runAllTimersAsync();

    streamer.pushEvent({
      ...baseEvent,
      type: "assistant_delta",
      delta: "First result",
    });
    await vi.runAllTimersAsync();

    // Second round: new tool arrives after assistant text was output
    streamer.pushEvent({
      ...baseEvent,
      type: "tool_start",
      toolUseId: "tool_002",
      toolName: "read_file",
    });
    await vi.runAllTimersAsync();

    // Should have created two cards
    expect(sendLiveMessage).toHaveBeenCalledTimes(2);
    expect(sendLiveMessage).toHaveBeenNthCalledWith(1, "正在执行工具 Exec Command");
    expect(sendLiveMessage).toHaveBeenNthCalledWith(2, "正在执行工具 Read File");
  });

  it("flushes pending assistant text to current card before starting a new one", async () => {
    const sendLiveMessage = vi
      .fn()
      .mockResolvedValueOnce("msg_001")
      .mockResolvedValueOnce("msg_002")
      .mockResolvedValueOnce("msg_003");
    const updateLiveMessage = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);

    const streamer = createEditableChannelReplyStreamer({
      projectId: "main-agent",
      sendLiveMessage,
      updateLiveMessage,
      sendText,
      liveMessageMaxLength: 20_000,
    });

    // --- Round 1: tool A → assistant text ---
    streamer.pushEvent({
      ...baseEvent,
      type: "tool_start",
      toolUseId: "tool_001",
      toolName: "exec_command",
    });
    await vi.runAllTimersAsync();

    streamer.pushEvent({
      ...baseEvent,
      type: "assistant_delta",
      delta: "Result A",
    });
    // Don't advance timers yet — text is pending in scheduleTextFlush

    // --- Round 2: tool B arrives while "Result A" is still pending ---
    streamer.pushEvent({
      ...baseEvent,
      type: "tool_start",
      toolUseId: "tool_002",
      toolName: "read_file",
    });
    await vi.runAllTimersAsync();

    streamer.pushEvent({
      ...baseEvent,
      type: "assistant_delta",
      delta: "Result B",
    });
    await vi.runAllTimersAsync();

    // --- Round 3: tool C ---
    streamer.pushEvent({
      ...baseEvent,
      type: "tool_start",
      toolUseId: "tool_003",
      toolName: "write_file",
    });
    await vi.runAllTimersAsync();

    streamer.pushEvent({
      ...baseEvent,
      type: "assistant_delta",
      delta: "Result C",
    });
    await vi.runAllTimersAsync();

    // 3 cards created
    expect(sendLiveMessage).toHaveBeenCalledTimes(3);

    // Card 1 (msg_001) should have received "Result A" even though flush was pending
    const card1Updates = updateLiveMessage.mock.calls
      .filter((c) => c[0] === "msg_001")
      .map((c) => c[1]);
    expect(card1Updates).toContain("Result A");

    // Card 2 (msg_002) should have received "Result B"
    const card2Updates = updateLiveMessage.mock.calls
      .filter((c) => c[0] === "msg_002")
      .map((c) => c[1]);
    expect(card2Updates).toContain("Result B");

    // Card 3 (msg_003) should have received "Result C"
    const card3Updates = updateLiveMessage.mock.calls
      .filter((c) => c[0] === "msg_003")
      .map((c) => c[1]);
    expect(card3Updates).toContain("Result C");
  });
});
