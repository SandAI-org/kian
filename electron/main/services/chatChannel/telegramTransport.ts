import type { ChatAttachmentDTO, ChatScope } from "@shared/types";
import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import {
  CHANNEL_MAX_INBOUND_ATTACHMENTS,
  cleanupInboundTempDirectory,
  createInboundTempDirectory,
  downloadInboundFileToTemp,
  importInboundFilesToChatAttachments,
  normalizeMimeType,
  splitMessage,
} from "./transportCommon";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_MESSAGE_MAX_LENGTH = 3_500;

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

interface TelegramBotProfile {
  id: number | string;
  username?: string;
}

interface TelegramFileDescriptor {
  file_id?: string;
  file_name?: string;
  mime_type?: string;
}

interface TelegramPhotoSize {
  file_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

export interface TelegramMessage {
  photo?: TelegramPhotoSize[];
  document?: TelegramFileDescriptor;
  video?: TelegramFileDescriptor;
  audio?: TelegramFileDescriptor;
  voice?: TelegramFileDescriptor;
  animation?: TelegramFileDescriptor;
  video_note?: TelegramFileDescriptor;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    chat?: {
      id: number | string;
    };
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
    document?: TelegramFileDescriptor;
    video?: TelegramFileDescriptor;
    audio?: TelegramFileDescriptor;
    voice?: TelegramFileDescriptor;
    animation?: TelegramFileDescriptor;
    video_note?: TelegramFileDescriptor;
    from?: {
      is_bot?: boolean;
      id?: number | string;
    };
  };
}

interface TelegramRemoteFile {
  file_path?: string;
}

interface TelegramInboundAttachmentCandidate {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  fallbackName: string;
  fallbackExtension?: string;
}

const splitTelegramMessage = (input: string): string[] =>
  splitMessage(input, TELEGRAM_MESSAGE_MAX_LENGTH);

const parseTelegramResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Telegram API HTTP ${response.status}${body ? `: ${body}` : ""}`,
    );
  }

  const payload = (await response.json()) as TelegramApiResponse<T>;
  if (!payload.ok) {
    throw new Error(payload.description || "Telegram API 请求失败");
  }
  return payload.result;
};

export const fetchTelegramBotProfile = async (
  token: string,
): Promise<{ id: string; username: string }> => {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getMe`);
  const result = await parseTelegramResponse<TelegramBotProfile>(response);
  const id =
    typeof result.id === "number" && Number.isFinite(result.id)
      ? String(Math.trunc(result.id))
      : typeof result.id === "string"
        ? result.id.trim()
        : "";
  if (!id) {
    throw new Error("Telegram bot profile is missing id");
  }
  return {
    id,
    username: result.username?.trim() ?? "",
  };
};

export const sendTelegramMessage = async (
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
): Promise<void> => {
  for (const chunk of splitTelegramMessage(text)) {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        reply_to_message_id: replyToMessageId,
        allow_sending_without_reply: true,
      }),
    });
    await parseTelegramResponse<unknown>(response);
  }
};

export const sendTelegramTyping = async (
  token: string,
  chatId: string,
): Promise<void> => {
  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/sendChatAction`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        action: "typing",
      }),
    },
  );
  await parseTelegramResponse<unknown>(response);
};

export const sendTelegramDocument = async (
  token: string,
  chatId: string,
  filePath: string,
  replyToMessageId?: number,
): Promise<void> => {
  const normalizedPath = path.normalize(filePath);
  await fs.access(normalizedPath);
  const fileBuffer = await fs.readFile(normalizedPath);
  const formData = new FormData();
  formData.set("chat_id", chatId);
  if (replyToMessageId) {
    formData.set("reply_to_message_id", String(replyToMessageId));
    formData.set("allow_sending_without_reply", "true");
  }
  formData.set(
    "document",
    new Blob([fileBuffer]),
    path.basename(normalizedPath),
  );

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/sendDocument`,
    {
      method: "POST",
      body: formData,
    },
  );
  await parseTelegramResponse<unknown>(response);
};

const encodeUrlPathSegments = (rawPath: string): string =>
  rawPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const fetchTelegramRemoteFile = async (
  token: string,
  fileId: string,
): Promise<TelegramRemoteFile> => {
  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(
      fileId,
    )}`,
  );
  return await parseTelegramResponse<TelegramRemoteFile>(response);
};

const pickLargestTelegramPhoto = (
  photos: TelegramPhotoSize[],
): TelegramPhotoSize | null => {
  if (photos.length === 0) return null;
  return photos.reduce<TelegramPhotoSize | null>((current, item) => {
    if (!item.file_id?.trim()) return current;
    if (!current || !current.file_id?.trim()) return item;
    const itemScore =
      Number(item.file_size ?? 0) ||
      Number(item.width ?? 0) * Number(item.height ?? 0);
    const currentScore =
      Number(current.file_size ?? 0) ||
      Number(current.width ?? 0) * Number(current.height ?? 0);
    if (itemScore > currentScore) return item;
    return current;
  }, null);
};

const extractTelegramInboundAttachmentCandidates = (
  message: TelegramMessage,
): TelegramInboundAttachmentCandidate[] => {
  const results: TelegramInboundAttachmentCandidate[] = [];
  const pushCandidate = (
    file: TelegramFileDescriptor | undefined,
    input: {
      fallbackName: string;
      fallbackExtension?: string;
      fallbackMimeType?: string;
    },
  ): void => {
    const fileId = file?.file_id?.trim();
    if (!fileId) return;
    results.push({
      fileId,
      fileName: file?.file_name,
      mimeType: normalizeMimeType(file?.mime_type) ?? input.fallbackMimeType,
      fallbackName: input.fallbackName,
      fallbackExtension: input.fallbackExtension,
    });
  };

  const bestPhoto = pickLargestTelegramPhoto(message.photo ?? []);
  if (bestPhoto?.file_id?.trim()) {
    results.push({
      fileId: bestPhoto.file_id.trim(),
      fallbackName: "telegram-photo",
      fallbackExtension: ".jpg",
      mimeType: "image/jpeg",
    });
  }

  pushCandidate(message.document, {
    fallbackName: "telegram-document",
  });
  pushCandidate(message.video, {
    fallbackName: "telegram-video",
    fallbackExtension: ".mp4",
  });
  pushCandidate(message.audio, {
    fallbackName: "telegram-audio",
    fallbackExtension: ".mp3",
  });
  pushCandidate(message.voice, {
    fallbackName: "telegram-voice",
    fallbackExtension: ".ogg",
    fallbackMimeType: "audio/ogg",
  });
  pushCandidate(message.animation, {
    fallbackName: "telegram-animation",
    fallbackExtension: ".gif",
  });
  pushCandidate(message.video_note, {
    fallbackName: "telegram-video-note",
    fallbackExtension: ".mp4",
  });
  return results.slice(0, CHANNEL_MAX_INBOUND_ATTACHMENTS);
};

export const loadTelegramInboundAttachments = async (input: {
  token: string;
  scope: ChatScope;
  chatId: string;
  message: TelegramMessage;
}): Promise<ChatAttachmentDTO[]> => {
  const candidates = extractTelegramInboundAttachmentCandidates(input.message);
  if (candidates.length === 0) return [];
  const tempDir = await createInboundTempDirectory("kian-tg-inbound");
  try {
    const downloadedFiles: Array<{
      sourcePath: string;
      name: string;
      mimeType?: string;
      size: number;
    }> = [];
    for (const [index, candidate] of candidates.entries()) {
      try {
        const remoteFile = await fetchTelegramRemoteFile(input.token, candidate.fileId);
        const remotePath = remoteFile.file_path?.trim();
        if (!remotePath) {
          throw new Error("Telegram 文件路径为空");
        }
        const fallbackName = `${candidate.fallbackName}-${index + 1}`;
        const downloadUrl = `${TELEGRAM_API_BASE}/file/bot${input.token}/${encodeUrlPathSegments(
          remotePath,
        )}`;
        const downloaded = await downloadInboundFileToTemp({
          provider: "Telegram",
          action: "消息附件下载",
          url: downloadUrl,
          tempDir,
          preferredFileName:
            candidate.fileName || path.basename(remotePath) || undefined,
          fallbackFileName: fallbackName,
          fallbackExtension: candidate.fallbackExtension,
          mimeType: candidate.mimeType,
        });
        downloadedFiles.push(downloaded);
      } catch (error) {
        logger.warn("Failed to download telegram inbound attachment", {
          chatId: input.chatId,
          fileId: candidate.fileId,
          error,
        });
      }
    }
    if (downloadedFiles.length === 0) return [];
    return await importInboundFilesToChatAttachments({
      provider: "Telegram",
      scope: input.scope,
      chatId: input.chatId,
      files: downloadedFiles,
    });
  } finally {
    await cleanupInboundTempDirectory(tempDir);
  }
};

export const setTelegramMessageReaction = async (
  token: string,
  chatId: string,
  messageId: number,
  emoji: string,
): Promise<void> => {
  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/setMessageReaction`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji }],
        is_big: false,
      }),
    },
  );
  await parseTelegramResponse<unknown>(response);
};

export const fetchTelegramUpdates = async (input: {
  token: string;
  offset: number;
  timeoutSeconds: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<TelegramUpdate[]> => {
  const query = new URLSearchParams({
    timeout: String(input.timeoutSeconds),
    limit: String(input.limit ?? 20),
    allowed_updates: JSON.stringify(["message"]),
  });
  if (input.offset > 0) {
    query.set("offset", String(input.offset));
  }
  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${input.token}/getUpdates?${query.toString()}`,
    {
      signal: input.signal,
    },
  );
  return await parseTelegramResponse<TelegramUpdate[]>(response);
};
