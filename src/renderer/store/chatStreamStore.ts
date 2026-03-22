import { api } from "@renderer/lib/api";
import {
  appendStreamingAssistantDelta,
  appendStreamingThinkingDelta,
  ensureStreamingAssistantDone,
  ensureStreamingThinkingDone,
  upsertStreamingTool,
  type StreamingBlock,
} from "@renderer/modules/chat/streamingState";
import { ChatStreamSmoother } from "@renderer/store/chatStreamSmoother";
import type { ChatHistoryUpdatedEvent, ChatStreamEvent } from "@shared/types";
import { create } from "zustand";

interface SessionStreamState {
  streamingBlocks: StreamingBlock[];
  streamingInProgress: boolean;
  streamingThinkingActive: boolean;
  streamError?: string;
  activeRequestId?: string;
  blockCounter: number;
}

interface ChatStreamStoreState {
  sessions: Record<string, SessionStreamState>;
  beginRequest: (sessionId: string, requestId: string) => void;
  releaseRequest: (sessionId: string, requestId?: string) => void;
  clearSessionStream: (sessionId: string) => void;
  ingestStreamEvent: (event: ChatStreamEvent) => void;
  ingestHistoryUpdated: (event: ChatHistoryUpdatedEvent) => void;
}

const createEmptySessionState = (): SessionStreamState => ({
  streamingBlocks: [],
  streamingInProgress: false,
  streamingThinkingActive: false,
  streamError: undefined,
  activeRequestId: undefined,
  blockCounter: 0,
});

const nextSessionsState = (
  sessions: Record<string, SessionStreamState>,
  sessionId: string,
  updater: (current: SessionStreamState) => SessionStreamState,
): Record<string, SessionStreamState> => {
  const current = sessions[sessionId] ?? createEmptySessionState();
  const next = updater(current);
  if (next === current) return sessions;
  return {
    ...sessions,
    [sessionId]: next,
  };
};

export const useChatStreamStore = create<ChatStreamStoreState>((set) => ({
  sessions: {},

  beginRequest: (sessionId, requestId) => {
    set((state) => {
      const sessions = nextSessionsState(state.sessions, sessionId, (current) => {
        if (
          current.activeRequestId === requestId &&
          current.streamingInProgress &&
          current.streamingBlocks.length === 0 &&
          !current.streamError
        ) {
          return current;
        }
        return {
          streamingBlocks: [],
          streamingInProgress: true,
          streamingThinkingActive: false,
          streamError: undefined,
          activeRequestId: requestId,
          blockCounter: 0,
        };
      });
      if (sessions === state.sessions) return state;
      return { sessions };
    });
  },

  releaseRequest: (sessionId, requestId) => {
    set((state) => {
      const sessions = nextSessionsState(state.sessions, sessionId, (current) => {
        if (!current.activeRequestId) return current;
        if (requestId && current.activeRequestId !== requestId) return current;
        return {
          ...current,
          activeRequestId: undefined,
        };
      });
      if (sessions === state.sessions) return state;
      return { sessions };
    });
  },

  clearSessionStream: (sessionId) => {
    set((state) => {
      const sessions = nextSessionsState(state.sessions, sessionId, (current) => {
        if (
          current.streamingBlocks.length === 0 &&
          !current.streamingInProgress &&
          !current.streamError &&
          !current.activeRequestId &&
          current.blockCounter === 0
        ) {
          return current;
        }
        return createEmptySessionState();
      });
      if (sessions === state.sessions) return state;
      return { sessions };
    });
  },

  ingestStreamEvent: (event) => {
    set((state) => {
      const sessions = nextSessionsState(
        state.sessions,
        event.sessionId,
        (current): SessionStreamState => {
          if (event.type === "request_started") {
            const nextRequestId = event.requestId;
            if (
              current.activeRequestId === nextRequestId &&
              current.streamingInProgress &&
              current.streamingBlocks.length === 0 &&
              !current.streamError
            ) {
              return current;
            }
            return {
              streamingBlocks: [],
              streamingInProgress: true,
              streamingThinkingActive: false,
              streamError: undefined,
              activeRequestId: nextRequestId,
              blockCounter: current.blockCounter,
            };
          }

          if (
            current.activeRequestId &&
            current.activeRequestId !== event.requestId
          ) {
            return current;
          }

          let nextBlocks = current.streamingBlocks;
          let nextInProgress = current.streamingInProgress;
          let nextThinkingActive = current.streamingThinkingActive;
          let nextError = current.streamError;
          let nextRequestId = current.activeRequestId;
          let nextCounter = current.blockCounter;
          const eventCreatedAt = event.createdAt ?? new Date().toISOString();
          const createStreamingBlockKey = (prefix: string): string => {
            nextCounter += 1;
            return `${prefix}-${nextCounter}`;
          };

          if (event.type === "assistant_delta") {
            nextInProgress = true;
            nextThinkingActive = false;
            nextError = undefined;
            nextBlocks = appendStreamingAssistantDelta(
              nextBlocks,
              event.delta ?? "",
              eventCreatedAt,
              createStreamingBlockKey,
            );
          } else if (event.type === "thinking_start") {
            nextInProgress = true;
            nextThinkingActive = true;
            nextError = undefined;
          } else if (event.type === "thinking_delta") {
            nextInProgress = true;
            nextThinkingActive = true;
            nextError = undefined;
            nextBlocks = appendStreamingThinkingDelta(
              nextBlocks,
              event.delta ?? "",
              eventCreatedAt,
              createStreamingBlockKey,
            );
          } else if (event.type === "thinking_end") {
            nextInProgress = true;
            nextThinkingActive = false;
            nextError = undefined;
            nextBlocks = ensureStreamingThinkingDone(
              nextBlocks,
              event.thinking,
              eventCreatedAt,
              createStreamingBlockKey,
            );
          } else if (event.type === "assistant_done") {
            nextInProgress = false;
            nextThinkingActive = false;
            nextError = undefined;
            nextRequestId = undefined;
            nextBlocks = ensureStreamingAssistantDone(
              nextBlocks,
              event.fullText,
              eventCreatedAt,
              createStreamingBlockKey,
            );
          } else if (event.type === "tool_start") {
            const toolUseId = event.toolUseId?.trim();
            if (!toolUseId) return current;
            nextInProgress = true;
            nextThinkingActive = false;
            nextError = undefined;
            nextBlocks = upsertStreamingTool(
              nextBlocks,
              {
                toolUseId,
                toolName: event.toolName ?? "工具",
                status: "starting",
                toolInput: event.toolInput,
              },
              eventCreatedAt,
              createStreamingBlockKey,
            );
          } else if (event.type === "tool_progress") {
            const toolUseId = event.toolUseId?.trim();
            if (!toolUseId) return current;
            nextInProgress = true;
            nextThinkingActive = false;
            nextError = undefined;
            nextBlocks = upsertStreamingTool(
              nextBlocks,
              {
                toolUseId,
                toolName: event.toolName ?? "工具",
                status: "running",
                toolInput: event.toolInput,
              },
              eventCreatedAt,
              createStreamingBlockKey,
            );
          } else if (event.type === "tool_output") {
            const toolUseId = event.toolUseId?.trim();
            if (!toolUseId) return current;
            nextInProgress = true;
            nextThinkingActive = false;
            nextError = undefined;
            nextBlocks = upsertStreamingTool(
              nextBlocks,
              {
                toolUseId,
                toolName: event.toolName ?? "工具",
                status: "done",
                output: event.output,
              },
              eventCreatedAt,
              createStreamingBlockKey,
            );
          } else if (event.type === "error") {
            nextInProgress = false;
            nextThinkingActive = false;
            nextRequestId = undefined;
            nextError = event.error ?? "流式输出失败";
          } else {
            return current;
          }

          if (
            nextBlocks === current.streamingBlocks &&
            nextInProgress === current.streamingInProgress &&
            nextThinkingActive === current.streamingThinkingActive &&
            nextError === current.streamError &&
            nextRequestId === current.activeRequestId &&
            nextCounter === current.blockCounter
          ) {
            return current;
          }

          return {
            ...current,
            streamingBlocks: nextBlocks,
            streamingInProgress: nextInProgress,
            streamingThinkingActive: nextThinkingActive,
            streamError: nextError,
            activeRequestId: nextRequestId,
            blockCounter: nextCounter,
          };
        },
      );
      if (sessions === state.sessions) return state;
      return { sessions };
    });
  },

  ingestHistoryUpdated: (event) => {
    if (event.role !== "assistant") {
      return;
    }

    set((state) => {
      const sessions = nextSessionsState(state.sessions, event.sessionId, (current) => {
        if (current.activeRequestId) return current;
        if (
          current.streamingBlocks.length === 0 &&
          !current.streamingInProgress &&
          !current.streamingThinkingActive &&
          !current.streamError &&
          current.blockCounter === 0
        ) {
          return current;
        }
        return createEmptySessionState();
      });
      if (sessions === state.sessions) return state;
      return { sessions };
    });
  },
}));

const chatStreamSmoother = new ChatStreamSmoother();

const initializeChatStreamBridge = (): void => {
  if (typeof window === "undefined") return;
  const bridgeFlagStore = globalThis as typeof globalThis & {
    __kianChatStreamBridgeInitialized__?: boolean;
  };
  if (bridgeFlagStore.__kianChatStreamBridgeInitialized__) return;
  bridgeFlagStore.__kianChatStreamBridgeInitialized__ = true;

  api.chat.subscribeStream((event) => {
    chatStreamSmoother.push(event, (smoothedEvent) => {
      useChatStreamStore.getState().ingestStreamEvent(smoothedEvent);
    });
  });
  api.chat.subscribeHistoryUpdated((event) => {
    chatStreamSmoother.flushSession(event.sessionId, (smoothedEvent) => {
      useChatStreamStore.getState().ingestStreamEvent(smoothedEvent);
    });
    useChatStreamStore.getState().ingestHistoryUpdated(event);
  });
};

initializeChatStreamBridge();
