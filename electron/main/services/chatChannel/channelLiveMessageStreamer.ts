import type { ChatScope, ChatStreamEvent } from "@shared/types";
import { logger } from "../logger";
import { splitMessage } from "./transportCommon";
import {
  type TelegramAssistantProgressiveStreamer,
  extractTelegramFileAttachments,
  formatTelegramAssistantBody,
  formatTelegramToolDoneMessage,
  formatTelegramToolRunningMessage,
  stripTelegramFileMarkdown,
} from "./telegramMirror";

const STREAM_PLACEHOLDER_TEXT = "处理中...";
const STREAM_UPDATE_INTERVAL_MS = 400;

const toChatScopeFromProjectId = (projectId: string): ChatScope =>
  projectId.trim() === "main-agent"
    ? { type: "main" }
    : { type: "project", projectId };

const buildFinalReplyPayload = (input: {
  projectId: string;
  message: string;
  isError: boolean;
}): {
  attachments: string[];
  assistantText: string;
  messageText: string;
} => {
  const attachments = extractTelegramFileAttachments(
    input.message,
    toChatScopeFromProjectId(input.projectId),
  );
  const assistantText = stripTelegramFileMarkdown(input.message);
  const messageText = formatTelegramAssistantBody({
    message: assistantText,
    hasAttachments: attachments.length > 0,
    isError: input.isError,
  });
  return {
    attachments,
    assistantText,
    messageText,
  };
};

export const createEditableChannelReplyStreamer = (input: {
  projectId: string;
  sendLiveMessage: (text: string) => Promise<string | number | undefined>;
  updateLiveMessage: (
    messageId: string | number,
    text: string,
  ) => Promise<void>;
  sendText: (text: string) => Promise<void>;
  sendDocument?: (filePath: string) => Promise<void>;
  sendAttachmentsFirst?: boolean;
  liveMessageMaxLength: number;
  onStreamingDone?: () => Promise<void>;
}): TelegramAssistantProgressiveStreamer => {
  const sendAttachmentsFirst = input.sendAttachmentsFirst ?? false;
  let assistantBuffer = "";
  let liveMessageId: string | number | undefined;
  let lastCommittedText = "";
  let pendingText: string | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let sendQueue: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    sendQueue = sendQueue.then(task).catch((error) => {
      logger.warn("Failed to update channel live message", {
        error,
      });
    });
    return sendQueue;
  };

  const normalizeLiveText = (value: string): string =>
    value.trim() || STREAM_PLACEHOLDER_TEXT;

  const commitLiveText = (value: string): Promise<void> => {
    const nextText = normalizeLiveText(value);
    if (nextText === lastCommittedText) {
      return sendQueue;
    }

    // Set eagerly so subsequent pushEvent calls see the pending text
    // immediately. This ensures assistant_delta after a tool event goes
    // through scheduleTextFlush (400ms debounce) instead of commitLiveText,
    // giving the tool message time to be visible on the platform.
    lastCommittedText = nextText;

    return enqueue(async () => {
      if (liveMessageId === undefined) {
        liveMessageId = await input.sendLiveMessage(nextText);
      } else {
        await input.updateLiveMessage(liveMessageId, nextText);
      }
    });
  };

  const clearPendingFlush = (): void => {
    if (!flushTimer) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const flushPendingText = (): Promise<void> => {
    clearPendingFlush();
    if (pendingText === null) {
      return sendQueue;
    }
    const text = pendingText;
    pendingText = null;
    return commitLiveText(text);
  };

  const scheduleTextFlush = (value: string): void => {
    pendingText = value;
    if (flushTimer) {
      return;
    }
    flushTimer = setTimeout(() => {
      void flushPendingText();
    }, STREAM_UPDATE_INTERVAL_MS);
  };

  const resetLiveMessage = (): void => {
    const textToFlush = pendingText;
    clearPendingFlush();
    pendingText = null;

    // Flush pending text to the CURRENT card and then reset liveMessageId,
    // all inside the queue so the flush sees the correct liveMessageId.
    enqueue(async () => {
      if (textToFlush !== null && liveMessageId !== undefined) {
        await input.updateLiveMessage(liveMessageId, normalizeLiveText(textToFlush));
      }
      liveMessageId = undefined;
    });

    lastCommittedText = "";
    assistantBuffer = "";
  };

  const updateToolStatus = (event: ChatStreamEvent): void => {
    // If the current card already has assistant text, start a new card
    if (assistantBuffer) {
      resetLiveMessage();
    }
    const tool = {
      toolUseId: event.toolUseId,
      toolName: event.toolName ?? "工具",
      toolInput: event.toolInput,
      output: event.output,
    };
    if (event.type === "tool_output") {
      void commitLiveText(formatTelegramToolDoneMessage(tool));
      return;
    }
    void commitLiveText(formatTelegramToolRunningMessage(tool));
  };

  return {
    pushEvent: (event) => {
      if (event.type === "request_started") {
        return;
      }

      if (
        event.type === "tool_start" ||
        event.type === "tool_progress" ||
        event.type === "tool_output"
      ) {
        updateToolStatus(event);
        return;
      }

      if (event.type === "assistant_delta" && event.delta) {
        assistantBuffer += event.delta;
        if (!lastCommittedText || lastCommittedText === STREAM_PLACEHOLDER_TEXT) {
          void commitLiveText(assistantBuffer);
          return;
        }
        scheduleTextFlush(assistantBuffer);
        return;
      }

      if (event.type === "error" && event.error?.trim()) {
        void commitLiveText(`错误: ${event.error.trim()}`);
      }
    },

    finalize: async ({ fallbackAssistantMessage, isError }) => {
      await flushPendingText();
      await sendQueue;

      const payload = buildFinalReplyPayload({
        projectId: input.projectId,
        message: fallbackAssistantMessage,
        isError: Boolean(isError),
      });
      const chunks = splitMessage(
        payload.messageText,
        input.liveMessageMaxLength,
      );
      const primaryChunk = chunks[0] ?? STREAM_PLACEHOLDER_TEXT;
      const trailingChunks = chunks.slice(1);

      if (payload.messageText || payload.attachments.length === 0) {
        if (!sendAttachmentsFirst) {
          await commitLiveText(primaryChunk);
        }
      }

      if (payload.attachments.length > 0) {
        if (!input.sendDocument) {
          await input.sendText(
            ["附件路径:", ...payload.attachments.map((item) => `- ${item}`)].join(
              "\n",
            ),
          );
        } else {
          let sentAttachmentCount = 0;
          for (const attachmentPath of payload.attachments) {
            try {
              await input.sendDocument(attachmentPath);
              sentAttachmentCount += 1;
            } catch (error) {
              logger.warn("Failed to send channel live-message attachment", {
                attachmentPath,
                error,
              });
            }
          }

          if (
            !payload.assistantText &&
            payload.attachments.length > 0 &&
            sentAttachmentCount === 0
          ) {
            await commitLiveText("附件发送失败，请检查文件路径或权限。");
            return;
          }
        }

        if (sendAttachmentsFirst && payload.messageText) {
          await commitLiveText(primaryChunk);
        }
      }

      for (const chunk of trailingChunks) {
        await input.sendText(chunk);
      }

      if (input.onStreamingDone) {
        try {
          await input.onStreamingDone();
        } catch (error) {
          logger.warn("Failed to finalize channel streaming", { error });
        }
      }
    },
  };
};
