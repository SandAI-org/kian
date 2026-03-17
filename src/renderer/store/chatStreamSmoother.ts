import type { ChatStreamEvent } from "@shared/types";

const STREAM_SMOOTHING_MAX_CHARS = 12;
const STREAM_SMOOTHING_INTERVAL_MS = 16;

type TimerHandle = ReturnType<typeof setTimeout>;

interface StreamQueueState {
  sessionId: string;
  pending: ChatStreamEvent[];
  timer: TimerHandle | null;
}

type EmitStreamEvent = (event: ChatStreamEvent) => void;

const isSmoothedDeltaEvent = (event: ChatStreamEvent): boolean =>
  event.type === "assistant_delta" || event.type === "thinking_delta";

const splitDeltaText = (delta: string): string[] => {
  if (!delta) return [];
  const chars = Array.from(delta);
  if (chars.length <= STREAM_SMOOTHING_MAX_CHARS) {
    return [delta];
  }

  const parts: string[] = [];
  for (let index = 0; index < chars.length; index += STREAM_SMOOTHING_MAX_CHARS) {
    parts.push(chars.slice(index, index + STREAM_SMOOTHING_MAX_CHARS).join(""));
  }
  return parts;
};

const buildStreamKey = (event: Pick<ChatStreamEvent, "sessionId" | "requestId">): string =>
  `${event.sessionId}:${event.requestId}`;

export class ChatStreamSmoother {
  private readonly queues = new Map<string, StreamQueueState>();

  push(event: ChatStreamEvent, emit: EmitStreamEvent): void {
    const key = buildStreamKey(event);
    if (!isSmoothedDeltaEvent(event)) {
      this.flushKey(key, emit);
      emit(event);
      this.cleanupKey(key);
      return;
    }

    const parts = splitDeltaText(event.delta ?? "");
    if (parts.length === 0) return;

    const state = this.getOrCreateQueue(key, event.sessionId);
    const canEmitImmediately =
      state.pending.length === 0 && state.timer === null;

    if (canEmitImmediately) {
      emit({
        ...event,
        delta: parts[0],
      });
    } else {
      state.pending.push({
        ...event,
        delta: parts[0],
      });
    }

    for (const part of parts.slice(1)) {
      state.pending.push({
        ...event,
        delta: part,
      });
    }

    this.scheduleDrain(key, emit);
  }

  flushSession(sessionId: string, emit: EmitStreamEvent): void {
    for (const [key, state] of this.queues.entries()) {
      if (state.sessionId !== sessionId) continue;
      this.flushKey(key, emit);
      this.cleanupKey(key);
    }
  }

  private getOrCreateQueue(key: string, sessionId: string): StreamQueueState {
    const existing = this.queues.get(key);
    if (existing) return existing;

    const created: StreamQueueState = {
      sessionId,
      pending: [],
      timer: null,
    };
    this.queues.set(key, created);
    return created;
  }

  private scheduleDrain(key: string, emit: EmitStreamEvent): void {
    const state = this.queues.get(key);
    if (!state || state.timer || state.pending.length === 0) return;

    state.timer = setTimeout(() => {
      const active = this.queues.get(key);
      if (!active) return;

      active.timer = null;
      const next = active.pending.shift();
      if (next) {
        emit(next);
      }

      if (active.pending.length > 0) {
        this.scheduleDrain(key, emit);
        return;
      }

      this.cleanupKey(key);
    }, STREAM_SMOOTHING_INTERVAL_MS);
  }

  private flushKey(key: string, emit: EmitStreamEvent): void {
    const state = this.queues.get(key);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    while (state.pending.length > 0) {
      const next = state.pending.shift();
      if (next) emit(next);
    }
  }

  private cleanupKey(key: string): void {
    const state = this.queues.get(key);
    if (!state) return;
    if (state.timer || state.pending.length > 0) return;
    this.queues.delete(key);
  }
}

export {
  STREAM_SMOOTHING_INTERVAL_MS,
  STREAM_SMOOTHING_MAX_CHARS,
  splitDeltaText,
};
