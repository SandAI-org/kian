import type { ChatAttachmentDTO, ChatScope } from "@shared/types";
import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import {
  CHANNEL_MAX_INBOUND_ATTACHMENTS,
  assertHttpOk,
  cleanupInboundTempDirectory,
  createInboundTempDirectory,
  downloadInboundFileToTemp,
  importInboundFilesToChatAttachments,
  normalizeChatId,
  normalizeExtension,
  normalizeMimeType,
  splitMessage,
} from "./transportCommon";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_MESSAGE_MAX_LENGTH = 1_900;

export interface DiscordAttachmentItem {
  id?: string;
  filename?: string;
  content_type?: string;
  url?: string;
  proxy_url?: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  attachments?: DiscordAttachmentItem[];
  author?: {
    id?: string;
    bot?: boolean;
  };
}

interface DiscordBotProfile {
  id?: string;
}

interface DiscordChannelInfo {
  name?: string;
  recipients?: Array<{
    username?: string;
    global_name?: string;
  }>;
}

export const fetchDiscordBotProfile = async (
  token: string,
): Promise<{ id: string }> => {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: {
      authorization: `Bot ${token}`,
    },
  });
  await assertHttpOk(response, "Discord", "Bot 资料读取");
  const payload = (await response.json()) as DiscordBotProfile;
  const id = payload.id?.trim() ?? "";
  if (!id) {
    throw new Error("Discord bot profile is missing id");
  }
  return { id };
};

export const sendDiscordBotMessage = async (
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: string,
): Promise<void> => {
  for (const chunk of splitMessage(text, DISCORD_MESSAGE_MAX_LENGTH)) {
    const payload: {
      content: string;
      message_reference?: {
        message_id: string;
        channel_id: string;
        fail_if_not_exists: boolean;
      };
      allowed_mentions?: {
        replied_user: boolean;
      };
    } = {
      content: chunk,
    };
    if (replyToMessageId?.trim()) {
      payload.message_reference = {
        message_id: replyToMessageId.trim(),
        channel_id: chatId,
        fail_if_not_exists: false,
      };
      payload.allowed_mentions = {
        replied_user: false,
      };
    }
    const response = await fetch(
      `${DISCORD_API_BASE}/channels/${encodeURIComponent(chatId)}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bot ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    await assertHttpOk(response, "Discord", "Bot 消息发送");
  }
};

export const sendDiscordBotDocument = async (
  token: string,
  chatId: string,
  filePath: string,
  replyToMessageId?: string,
): Promise<void> => {
  const normalizedPath = path.normalize(filePath);
  await fs.access(normalizedPath);
  const fileBuffer = await fs.readFile(normalizedPath);
  const formData = new FormData();
  formData.set(
    "files[0]",
    new Blob([fileBuffer]),
    path.basename(normalizedPath),
  );
  const payload: {
    content: string;
    message_reference?: {
      message_id: string;
      channel_id: string;
      fail_if_not_exists: boolean;
    };
    allowed_mentions?: {
      replied_user: boolean;
    };
  } = {
    content: "",
  };
  if (replyToMessageId?.trim()) {
    payload.message_reference = {
      message_id: replyToMessageId.trim(),
      channel_id: chatId,
      fail_if_not_exists: false,
    };
    payload.allowed_mentions = {
      replied_user: false,
    };
  }
  formData.set("payload_json", JSON.stringify(payload));
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${encodeURIComponent(chatId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
      },
      body: formData,
    },
  );
  await assertHttpOk(response, "Discord", "Bot 附件发送");
};

export const setDiscordMessageReaction = async (
  token: string,
  chatId: string,
  messageId: string,
  emoji: string,
): Promise<void> => {
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(
      messageId,
    )}/reactions/${encodeURIComponent(emoji)}/@me`,
    {
      method: "PUT",
      headers: {
        authorization: `Bot ${token}`,
      },
    },
  );
  await assertHttpOk(response, "Discord", "消息反应设置");
};

export const fetchDiscordMessages = async (input: {
  token: string;
  chatId: string;
  afterMessageId?: string;
}): Promise<DiscordMessage[]> => {
  const query = new URLSearchParams({
    limit: "50",
  });
  if (input.afterMessageId?.trim()) {
    query.set("after", input.afterMessageId.trim());
  }
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${encodeURIComponent(
      input.chatId,
    )}/messages?${query.toString()}`,
    {
      headers: {
        authorization: `Bot ${input.token}`,
      },
    },
  );
  await assertHttpOk(response, "Discord", "Bot 消息拉取");
  const payload = (await response.json()) as DiscordMessage[];
  if (!Array.isArray(payload)) return [];
  return payload;
};

export const loadDiscordInboundAttachments = async (input: {
  token: string;
  scope: ChatScope;
  chatId: string;
  message: DiscordMessage;
}): Promise<ChatAttachmentDTO[]> => {
  const candidates = (input.message.attachments ?? [])
    .filter((item) => item && (item.url?.trim() || item.proxy_url?.trim()))
    .slice(0, CHANNEL_MAX_INBOUND_ATTACHMENTS);
  if (candidates.length === 0) return [];
  const tempDir = await createInboundTempDirectory("kian-discord-inbound");
  try {
    const downloadedFiles: Array<{
      sourcePath: string;
      name: string;
      mimeType?: string;
      size: number;
    }> = [];
    for (const [index, item] of candidates.entries()) {
      const resourceUrl = item.url?.trim() || item.proxy_url?.trim();
      if (!resourceUrl) continue;
      const fallbackName = `discord-attachment-${index + 1}`;
      const mimeType = normalizeMimeType(item.content_type);
      const fallbackExtension =
        normalizeExtension(path.extname(item.filename ?? "")) ?? undefined;

      let downloaded:
        | {
            sourcePath: string;
            name: string;
            mimeType?: string;
            size: number;
          }
        | null = null;
      try {
        downloaded = await downloadInboundFileToTemp({
          provider: "Discord",
          action: "消息附件下载",
          url: resourceUrl,
          tempDir,
          preferredFileName: item.filename,
          fallbackFileName: fallbackName,
          fallbackExtension,
          mimeType,
          headers: {
            authorization: `Bot ${input.token}`,
          },
        });
      } catch (error) {
        logger.warn("Discord attachment download via bot token failed", {
          chatId: input.chatId,
          attachmentId: item.id,
          error,
        });
      }

      if (!downloaded) {
        try {
          downloaded = await downloadInboundFileToTemp({
            provider: "Discord",
            action: "消息附件下载",
            url: resourceUrl,
            tempDir,
            preferredFileName: item.filename,
            fallbackFileName: fallbackName,
            fallbackExtension,
            mimeType,
          });
        } catch (error) {
          logger.warn("Failed to download discord inbound attachment", {
            chatId: input.chatId,
            attachmentId: item.id,
            error,
          });
        }
      }

      if (downloaded) {
        downloadedFiles.push(downloaded);
      }
    }
    if (downloadedFiles.length === 0) return [];
    return await importInboundFilesToChatAttachments({
      provider: "Discord",
      scope: input.scope,
      chatId: input.chatId,
      files: downloadedFiles,
    });
  } finally {
    await cleanupInboundTempDirectory(tempDir);
  }
};

export const resolveDiscordChannelGuildId = async (input: {
  token: string;
  channelId: string;
  cache: Map<string, string | null>;
}): Promise<string | null> => {
  if (input.cache.has(input.channelId)) {
    return input.cache.get(input.channelId) ?? null;
  }
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${encodeURIComponent(input.channelId)}`,
    {
      headers: {
        authorization: `Bot ${input.token}`,
      },
    },
  );
  await assertHttpOk(response, "Discord", "频道详情获取");
  const payload = (await response.json()) as { guild_id?: unknown };
  const guildId = normalizeChatId(
    typeof payload.guild_id === "string" ? payload.guild_id : undefined,
  );
  input.cache.set(input.channelId, guildId);
  return guildId;
};

export const fetchDiscordChannelDisplayName = async (input: {
  token: string;
  channelId: string;
  cache: Map<string, string | null>;
}): Promise<string> => {
  if (input.cache.has(input.channelId)) {
    return input.cache.get(input.channelId) ?? "";
  }
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${encodeURIComponent(input.channelId)}`,
    {
      headers: {
        authorization: `Bot ${input.token}`,
      },
    },
  );
  await assertHttpOk(response, "Discord", "频道详情获取");
  const payload = (await response.json()) as DiscordChannelInfo;
  const explicitName = payload.name?.trim() ?? "";
  const recipientName = Array.isArray(payload.recipients)
    ? payload.recipients
        .map((recipient) => {
          const globalName = recipient.global_name?.trim() ?? "";
          const username = recipient.username?.trim() ?? "";
          return globalName || username;
        })
        .filter((name) => name.length > 0)
        .join(", ")
    : "";
  const displayName = explicitName || recipientName;
  input.cache.set(input.channelId, displayName || null);
  return displayName;
};
