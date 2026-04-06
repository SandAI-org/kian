import { promises as fs } from "node:fs";
import path from "node:path";
import { renderMarkdownMermaidToAscii } from "@shared/utils/markdownMermaid";
import { assertHttpOk, normalizeChatId, splitMessage } from "./transportCommon";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";
const FEISHU_MESSAGE_MAX_LENGTH = 20_000;
const FEISHU_MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
const FEISHU_EXTENDED_IMAGE_MARKDOWN_PATTERN =
  /@\[(image)(?:\|[^\]]*)?\]\(([^)\n]+)\)/gi;
const FEISHU_IMAGE_KEY_PATTERN = /^img_[A-Za-z0-9_-]+$/;
const FEISHU_CARD_FALLBACK_TEXT = "Agent 未返回文本内容。";

const IMAGE_EXTENSION_MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

interface FeishuTokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuChatListResponse {
  code?: number;
  msg?: string;
  data?: {
    items?: Array<{ chat_id?: string; name?: string }>;
    has_more?: boolean;
    page_token?: string;
  };
}

interface FeishuChatInfoResponse {
  code?: number;
  msg?: string;
  data?: {
    name?: string;
  };
}

interface FeishuUserInfoResponse {
  code?: number;
  msg?: string;
  data?: {
    user?: {
      name?: string;
      en_name?: string;
      nickname?: string;
    };
  };
}

interface FeishuChatMembersResponse {
  code?: number;
  msg?: string;
  data?: {
    items?: Array<{
      member_id_type?: string;
      member_id?: string;
      name?: string;
      tenant_key?: string;
    }>;
    page_token?: string;
    has_more?: boolean;
    member_total?: number;
  };
}

interface FeishuMessageListResponse {
  code?: number;
  msg?: string;
  data?: {
    items?: FeishuMessageItem[];
  };
}

interface FeishuImageUploadResponse {
  code?: number;
  msg?: string;
  data?: {
    image_key?: string;
  };
}

interface FeishuFileUploadResponse {
  code?: number;
  msg?: string;
  data?: {
    file_key?: string;
  };
}

interface FeishuMessageSendResponse {
  code?: number;
  msg?: string;
  data?: {
    message_id?: string;
  };
}

export interface FeishuMessageItem {
  message_id?: string;
  chat_id?: string;
  create_time?: string;
  msg_type?: string;
  body?: {
    content?: string;
  };
  sender?: {
    sender_type?: string;
    id?:
      | string
      | {
          user_id?: string;
          open_id?: string;
          union_id?: string;
        };
    sender_id?: {
      user_id?: string;
      open_id?: string;
      union_id?: string;
    };
  };
}

let feishuTenantTokenCache: {
  sourceToken: string;
  accessToken: string;
  expiresAt: number;
} | null = null;

interface FeishuMarkdownImageToken {
  kind: "markdown" | "extended";
  start: number;
  end: number;
  alt: string;
  source: string;
}

const FEISHU_UPLOAD_FILE_TYPE_BY_EXTENSION: Record<string, string> = {
  ".opus": "opus",
  ".mp4": "mp4",
  ".pdf": "pdf",
  ".doc": "doc",
  ".xls": "xls",
  ".ppt": "ppt",
};

const inferFeishuUploadFileType = (fileName: string): string => {
  const extension = path.extname(fileName).toLowerCase();
  return FEISHU_UPLOAD_FILE_TYPE_BY_EXTENSION[extension] ?? "stream";
};

const normalizeImageSource = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const withoutTitleMatch = trimmed.match(
    /^(\S+)\s+(?:"[^"]*"|'[^']*'|\([^)]*\))$/,
  );
  const target = withoutTitleMatch?.[1] ?? trimmed;
  if (target.startsWith("<") && target.endsWith(">")) {
    return target.slice(1, -1).trim();
  }
  return target.trim();
};

const inferMimeTypeByFileName = (fileName: string): string | undefined => {
  const extension = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSION_MIME_MAP[extension];
};

const inferFileNameFromSource = (source: string): string => {
  const normalized = source.replace(/[?#].*$/, "").trim();
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      const candidate = path.basename(parsed.pathname);
      return candidate || "image";
    } catch {
      return "image";
    }
  }
  if (/^data:image\//i.test(normalized)) {
    return "image";
  }
  const candidate = path.basename(normalized);
  return candidate || "image";
};

const resolveImageSourceBinary = async (
  source: string,
): Promise<{ bytes: Uint8Array; fileName: string; mimeType?: string } | null> => {
  const normalized = source.trim();
  if (!normalized) return null;

  if (/^https?:\/\//i.test(normalized)) {
    const response = await fetch(normalized);
    await assertHttpOk(response, "飞书", "图片下载");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const fileName = inferFileNameFromSource(normalized);
    const mimeType =
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
      inferMimeTypeByFileName(fileName);
    return { bytes, fileName, mimeType };
  }

  const dataUrlMatch = normalized.match(
    /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i,
  );
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1].toLowerCase();
    const base64 = dataUrlMatch[2].replace(/\s+/g, "");
    return {
      bytes: Uint8Array.from(Buffer.from(base64, "base64")),
      fileName: "image",
      mimeType,
    };
  }

  let localPath = normalized;
  if (/^file:\/\//i.test(localPath)) {
    try {
      localPath = decodeURIComponent(new URL(localPath).pathname);
    } catch {
      return null;
    }
  }
  if (!path.isAbsolute(localPath)) {
    localPath = path.resolve(process.cwd(), localPath);
  }

  try {
    const bytes = await fs.readFile(localPath);
    const fileName = path.basename(localPath) || "image";
    const mimeType = inferMimeTypeByFileName(fileName);
    return {
      bytes: new Uint8Array(bytes),
      fileName,
      mimeType,
    };
  } catch {
    return null;
  }
};

const uploadFeishuMessageImage = async (
  accessToken: string,
  source: string,
): Promise<string> => {
  const resource = await resolveImageSourceBinary(source);
  if (!resource) {
    throw new Error(`无法读取图片资源: ${source}`);
  }

  const formData = new FormData();
  formData.set("image_type", "message");
  formData.set(
    "image",
    new Blob([resource.bytes], resource.mimeType ? { type: resource.mimeType } : {}),
    resource.fileName,
  );
  const response = await fetch(`${FEISHU_API_BASE}/im/v1/images`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });
  await assertHttpOk(response, "飞书", "图片上传");
  const payload = (await response.json()) as FeishuImageUploadResponse;
  if (payload.code !== 0 || !payload.data?.image_key) {
    throw new Error(payload.msg || "飞书 图片上传失败");
  }
  return payload.data.image_key;
};

const uploadFeishuMessageFile = async (
  accessToken: string,
  filePath: string,
): Promise<string> => {
  let normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new Error("飞书 附件路径不能为空");
  }
  if (/^file:\/\//i.test(normalizedPath)) {
    try {
      normalizedPath = decodeURIComponent(new URL(normalizedPath).pathname);
    } catch {
      throw new Error(`飞书 附件路径无效: ${filePath}`);
    }
  }
  if (!path.isAbsolute(normalizedPath)) {
    normalizedPath = path.resolve(process.cwd(), normalizedPath);
  }
  normalizedPath = path.normalize(normalizedPath);
  await fs.access(normalizedPath);
  const fileBuffer = await fs.readFile(normalizedPath);
  const fileName = path.basename(normalizedPath) || "attachment";
  const formData = new FormData();
  formData.set("file_type", inferFeishuUploadFileType(fileName));
  formData.set("file_name", fileName);
  formData.set("file", new Blob([fileBuffer]), fileName);
  const response = await fetch(`${FEISHU_API_BASE}/im/v1/files`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });
  await assertHttpOk(response, "飞书", "文件上传");
  const payload = (await response.json()) as FeishuFileUploadResponse;
  if (payload.code !== 0 || !payload.data?.file_key) {
    throw new Error(payload.msg || "飞书 文件上传失败");
  }
  return payload.data.file_key;
};

const sendFeishuStructuredMessage = async (input: {
  accessToken: string;
  receiveId: string;
  receiveIdType: "chat_id" | "user_id";
  replyToMessageId?: string;
  msgType: string;
  content: string;
  actionName: string;
}): Promise<string | undefined> => {
  const normalizedReplyToMessageId = input.replyToMessageId?.trim() ?? "";
  const response = await fetch(
    normalizedReplyToMessageId
      ? `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(
          normalizedReplyToMessageId,
        )}/reply`
      : `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=${input.receiveIdType}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        normalizedReplyToMessageId
          ? {
              msg_type: input.msgType,
              content: input.content,
            }
          : {
              receive_id: input.receiveId,
              msg_type: input.msgType,
              content: input.content,
            },
      ),
    },
  );
  await assertHttpOk(response, "飞书", input.actionName);
  const payload = (await response.json().catch(
    () => ({}),
  )) as FeishuMessageSendResponse;
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new Error(payload.msg || `飞书 ${input.actionName}失败`);
  }
  return payload.data?.message_id?.trim() || undefined;
};

const collectFeishuMarkdownImageTokens = (
  markdown: string,
): FeishuMarkdownImageToken[] => {
  const tokens: FeishuMarkdownImageToken[] = [];
  FEISHU_MARKDOWN_IMAGE_PATTERN.lastIndex = 0;
  FEISHU_EXTENDED_IMAGE_MARKDOWN_PATTERN.lastIndex = 0;

  for (const match of markdown.matchAll(FEISHU_MARKDOWN_IMAGE_PATTERN)) {
    const source = normalizeImageSource(match[2] ?? "");
    if (!source) continue;
    const start = match.index ?? -1;
    if (start < 0) continue;
    tokens.push({
      kind: "markdown",
      start,
      end: start + match[0].length,
      alt: match[1] ?? "",
      source,
    });
  }

  for (const match of markdown.matchAll(FEISHU_EXTENDED_IMAGE_MARKDOWN_PATTERN)) {
    const source = normalizeImageSource(match[2] ?? "");
    if (!source) continue;
    const start = match.index ?? -1;
    if (start < 0) continue;
    const alt = inferFileNameFromSource(source) || "image";
    tokens.push({
      kind: "extended",
      start,
      end: start + match[0].length,
      alt,
      source,
    });
  }

  tokens.sort((left, right) => left.start - right.start);
  return tokens;
};

export const buildFeishuMarkdownCard = (markdown: string): Record<string, unknown> => {
  const content = markdown.trim() || FEISHU_CARD_FALLBACK_TEXT;
  return {
    schema: "2.0",
    config: {
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content,
        },
      ],
    },
  };
};

export const normalizeFeishuMarkdownContent = async (
  markdown: string,
  options?: {
    accessToken?: string;
  },
): Promise<string> => {
  const normalizedMarkdown = renderMarkdownMermaidToAscii(markdown.trim());
  if (!normalizedMarkdown) return FEISHU_CARD_FALLBACK_TEXT;

  const tokens = collectFeishuMarkdownImageTokens(normalizedMarkdown);
  if (tokens.length === 0) return normalizedMarkdown;

  const accessToken = options?.accessToken?.trim() ?? "";
  const imageKeyCache = new Map<string, Promise<string>>();
  const resolveImageKey = async (source: string): Promise<string> => {
    if (FEISHU_IMAGE_KEY_PATTERN.test(source)) {
      return source;
    }
    if (!accessToken) {
      return source;
    }
    const cached = imageKeyCache.get(source);
    if (cached) {
      return await cached;
    }
    const pending = uploadFeishuMessageImage(accessToken, source).catch(
      () => source,
    );
    imageKeyCache.set(source, pending);
    return await pending;
  };

  let cursor = 0;
  const segments: string[] = [];
  for (const token of tokens) {
    if (token.start < cursor) continue;
    segments.push(normalizedMarkdown.slice(cursor, token.start));
    const resolvedImageKey = await resolveImageKey(token.source);
    segments.push(`![${token.alt}](${resolvedImageKey})`);
    cursor = token.end;
  }
  segments.push(normalizedMarkdown.slice(cursor));
  return segments.join("");
};

export const clearFeishuTenantTokenCache = (): void => {
  feishuTenantTokenCache = null;
};

export const parseFeishuBotToken = (
  token: string,
): { appId: string; appSecret: string } | null => {
  const separatorIndex = token.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= token.length - 1) {
    return null;
  }
  const appId = token.slice(0, separatorIndex).trim();
  const appSecret = token.slice(separatorIndex + 1).trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
};

export const resolveFeishuAccessToken = async (token: string): Promise<string> => {
  const parsed = parseFeishuBotToken(token);
  if (!parsed) {
    return token;
  }

  if (
    feishuTenantTokenCache &&
    feishuTenantTokenCache.sourceToken === token &&
    feishuTenantTokenCache.expiresAt > Date.now() + 10_000
  ) {
    return feishuTenantTokenCache.accessToken;
  }

  const response = await fetch(
    `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_id: parsed.appId,
        app_secret: parsed.appSecret,
      }),
    },
  );
  await assertHttpOk(response, "飞书", "Tenant Token 获取");
  const payload = (await response.json()) as FeishuTokenResponse;
  if (payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(payload.msg || "飞书 Tenant Token 获取失败");
  }
  const expireSeconds =
    typeof payload.expire === "number" && payload.expire > 0
      ? payload.expire
      : 7_200;
  feishuTenantTokenCache = {
    sourceToken: token,
    accessToken: payload.tenant_access_token,
    expiresAt: Date.now() + expireSeconds * 1_000,
  };
  return feishuTenantTokenCache.accessToken;
};

export const sendFeishuBotMessage = async (
  token: string,
  receiveId: string,
  text: string,
  receiveIdType: "chat_id" | "user_id" = "chat_id",
  replyToMessageId?: string,
): Promise<string | undefined> => {
  const accessToken = await resolveFeishuAccessToken(token);
  const markdownContent = await normalizeFeishuMarkdownContent(text, {
    accessToken,
  });
  let lastMessageId: string | undefined;
  for (const chunk of splitMessage(markdownContent, FEISHU_MESSAGE_MAX_LENGTH)) {
    const card = buildFeishuMarkdownCard(chunk);
    lastMessageId = await sendFeishuStructuredMessage({
      accessToken,
      receiveId,
      receiveIdType,
      replyToMessageId,
      msgType: "interactive",
      content: JSON.stringify(card),
      actionName: "Bot 消息发送",
    });
  }
  return lastMessageId;
};

export const sendFeishuBotCard = async (input: {
  token: string;
  receiveId: string;
  card: Record<string, unknown>;
  receiveIdType?: "chat_id" | "user_id";
  replyToMessageId?: string;
}): Promise<string | undefined> => {
  const accessToken = await resolveFeishuAccessToken(input.token);
  return await sendFeishuStructuredMessage({
    accessToken,
    receiveId: input.receiveId,
    receiveIdType: input.receiveIdType ?? "chat_id",
    replyToMessageId: input.replyToMessageId,
    msgType: "interactive",
    content: JSON.stringify(input.card),
    actionName: "Bot 消息发送",
  });
};

export const updateFeishuBotCard = async (
  token: string,
  messageId: string,
  card: Record<string, unknown>,
): Promise<void> => {
  const normalizedMessageId = messageId.trim();
  if (!normalizedMessageId) {
    throw new Error("飞书 消息 ID 不能为空");
  }

  const accessToken = await resolveFeishuAccessToken(token);
  const response = await fetch(
    `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(normalizedMessageId)}`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        content: JSON.stringify(card),
      }),
    },
  );
  await assertHttpOk(response, "飞书", "Bot 卡片更新");
  const payload = (await response.json().catch(
    () => ({}),
  )) as FeishuMessageSendResponse;
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new Error(payload.msg || "飞书 Bot 卡片更新失败");
  }
};

// ── CardKit Streaming API ──────────────────────────────────────────

const FEISHU_STREAMING_ELEMENT_ID = "streaming_md";

interface FeishuCardKitResponse {
  code?: number;
  msg?: string;
  data?: {
    card_id?: string;
  };
}

export const buildFeishuStreamingCard = (
  initialContent?: string,
): Record<string, unknown> => ({
  schema: "2.0",
  config: {
    update_multi: true,
    streaming_mode: true,
    streaming_config: {
      print_frequency_ms: { default: 50 },
      print_step: { default: 2 },
      print_strategy: "fast",
    },
  },
  body: {
    elements: [
      {
        tag: "markdown",
        element_id: FEISHU_STREAMING_ELEMENT_ID,
        content: initialContent?.trim() || FEISHU_CARD_FALLBACK_TEXT,
      },
    ],
  },
});

export const createFeishuStreamingCard = async (
  token: string,
  initialContent?: string,
): Promise<string> => {
  const accessToken = await resolveFeishuAccessToken(token);
  const card = buildFeishuStreamingCard(initialContent);
  const response = await fetch(`${FEISHU_API_BASE}/cardkit/v1/cards`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      type: "card_json",
      data: JSON.stringify(card),
    }),
  });
  await assertHttpOk(response, "飞书", "CardKit 创建卡片");
  const payload = (await response.json()) as FeishuCardKitResponse;
  if (payload.code !== 0 || !payload.data?.card_id) {
    throw new Error(payload.msg || "飞书 CardKit 创建卡片失败");
  }
  return payload.data.card_id;
};

export const sendFeishuBotCardByCardId = async (input: {
  token: string;
  receiveId: string;
  cardId: string;
  receiveIdType?: "chat_id" | "user_id";
  replyToMessageId?: string;
}): Promise<string | undefined> => {
  const accessToken = await resolveFeishuAccessToken(input.token);
  return await sendFeishuStructuredMessage({
    accessToken,
    receiveId: input.receiveId,
    receiveIdType: input.receiveIdType ?? "chat_id",
    replyToMessageId: input.replyToMessageId,
    msgType: "interactive",
    content: JSON.stringify({
      type: "card_id",
      data: { card_id: input.cardId },
    }),
    actionName: "Bot 卡片消息发送",
  });
};

export const updateFeishuStreamingCardText = async (
  token: string,
  cardId: string,
  content: string,
  sequence: number,
): Promise<void> => {
  const accessToken = await resolveFeishuAccessToken(token);
  const response = await fetch(
    `${FEISHU_API_BASE}/cardkit/v1/cards/${encodeURIComponent(cardId)}/elements/${FEISHU_STREAMING_ELEMENT_ID}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        element: JSON.stringify({
          tag: "markdown",
          content: content.trim() || FEISHU_CARD_FALLBACK_TEXT,
        }),
        sequence,
        uuid: `stream-${cardId}-${sequence}`,
      }),
    },
  );
  await assertHttpOk(response, "飞书", "CardKit 流式更新文本");
  const payload = (await response.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
  };
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new Error(payload.msg || "飞书 CardKit 流式更新文本失败");
  }
};

export const stopFeishuCardStreaming = async (
  token: string,
  cardId: string,
  sequence: number,
): Promise<void> => {
  const accessToken = await resolveFeishuAccessToken(token);
  const response = await fetch(
    `${FEISHU_API_BASE}/cardkit/v1/cards/${encodeURIComponent(cardId)}/settings`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        settings: JSON.stringify({
          config: { streaming_mode: false },
        }),
        sequence,
      }),
    },
  );
  await assertHttpOk(response, "飞书", "CardKit 停止流式");
  const payload = (await response.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
  };
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new Error(payload.msg || "飞书 CardKit 停止流式失败");
  }
};

export const sendFeishuBotDocument = async (
  token: string,
  receiveId: string,
  filePath: string,
  receiveIdType: "chat_id" | "user_id" = "chat_id",
  replyToMessageId?: string,
): Promise<void> => {
  const accessToken = await resolveFeishuAccessToken(token);
  const fileKey = await uploadFeishuMessageFile(accessToken, filePath);
  await sendFeishuStructuredMessage({
    accessToken,
    receiveId,
    receiveIdType,
    replyToMessageId,
    msgType: "file",
    content: JSON.stringify({
      file_key: fileKey,
    }),
    actionName: "Bot 附件发送",
  });
};

export const setFeishuMessageReaction = async (
  token: string,
  messageId: string,
  emojiType: string,
): Promise<void> => {
  const normalizedMessageId = messageId.trim();
  const normalizedEmojiType = emojiType.trim();
  if (!normalizedMessageId || !normalizedEmojiType) return;
  const accessToken = await resolveFeishuAccessToken(token);
  const emojiCandidates = Array.from(
    new Set([normalizedEmojiType, normalizedEmojiType.toUpperCase()]),
  );
  let lastError: Error | null = null;
  for (const candidate of emojiCandidates) {
    const response = await fetch(
      `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(normalizedMessageId)}/reactions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reaction_type: {
            emoji_type: candidate,
          },
        }),
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      lastError = new Error(
        `飞书 消息反应设置 HTTP ${response.status}${body ? `: ${body}` : ""}`,
      );
      continue;
    }
    const payload = (await response.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
    };
    if (typeof payload.code === "number" && payload.code !== 0) {
      lastError = new Error(payload.msg || "飞书 消息反应设置失败");
      continue;
    }
    return;
  }
  throw lastError ?? new Error("飞书 消息反应设置失败");
};

export const fetchFeishuMessages = async (input: {
  token: string;
  chatId: string;
  startTimeMs?: number;
}): Promise<FeishuMessageItem[]> => {
  const accessToken = await resolveFeishuAccessToken(input.token);
  const query = new URLSearchParams({
    container_id_type: "chat",
    container_id: input.chatId,
    sort_type: "ByCreateTimeAsc",
    page_size: "50",
  });
  if (
    typeof input.startTimeMs === "number" &&
    Number.isFinite(input.startTimeMs)
  ) {
    query.set(
      "start_time",
      String(Math.max(0, Math.trunc(input.startTimeMs / 1_000))),
    );
  }
  const response = await fetch(`${FEISHU_API_BASE}/im/v1/messages?${query.toString()}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  await assertHttpOk(response, "飞书", "Bot 消息拉取");
  const payload = (await response.json()) as FeishuMessageListResponse;
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new Error(payload.msg || "飞书 Bot 消息拉取失败");
  }
  const items = payload.data?.items;
  if (!Array.isArray(items)) return [];
  return items;
};

export const fetchFeishuChatIds = async (token: string): Promise<string[]> => {
  const accessToken = await resolveFeishuAccessToken(token);
  const chatIds = new Set<string>();
  let pageToken = "";

  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({
      page_size: "50",
    });
    if (pageToken) {
      query.set("page_token", pageToken);
    }
    const response = await fetch(`${FEISHU_API_BASE}/im/v1/chats?${query}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });
    await assertHttpOk(response, "飞书", "会话列表拉取");
    const payload = (await response.json()) as FeishuChatListResponse;
    if (typeof payload.code === "number" && payload.code !== 0) {
      throw new Error(payload.msg || "飞书会话列表拉取失败");
    }

    const items = payload.data?.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        const chatId = normalizeChatId(item?.chat_id);
        if (chatId) {
          chatIds.add(chatId);
        }
      }
    }

    const hasMore = payload.data?.has_more === true;
    const nextPageToken =
      typeof payload.data?.page_token === "string"
        ? payload.data.page_token.trim()
        : "";
    if (!hasMore || !nextPageToken) {
      break;
    }
    pageToken = nextPageToken;
  }

  return Array.from(chatIds);
};

export const fetchFeishuChatDisplayName = async (input: {
  token: string;
  chatId: string;
  cache: Map<string, string | null>;
}): Promise<string> => {
  if (input.cache.has(input.chatId)) {
    return input.cache.get(input.chatId) ?? "";
  }
  const accessToken = await resolveFeishuAccessToken(input.token);
  const response = await fetch(
    `${FEISHU_API_BASE}/im/v1/chats/${encodeURIComponent(input.chatId)}`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    },
  );
  await assertHttpOk(response, "飞书", "会话详情拉取");
  const payload = (await response.json()) as FeishuChatInfoResponse;
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new Error(payload.msg || "飞书会话详情拉取失败");
  }
  const displayName = payload.data?.name?.trim() ?? "";
  input.cache.set(input.chatId, displayName || null);
  return displayName;
};

export const fetchFeishuUserDisplayName = async (input: {
  token: string;
  userId: string;
  chatId?: string;
  userIdType?: "open_id" | "user_id" | "union_id";
  cache: Map<string, string | null>;
}): Promise<string> => {
  const userId = normalizeChatId(input.userId);
  if (!userId) return "";

  const cacheKey = `${input.userIdType ?? "unknown"}:${userId}`;
  if (input.cache.has(cacheKey)) {
    return input.cache.get(cacheKey) ?? "";
  }

  const accessToken = await resolveFeishuAccessToken(input.token);
  const userIdTypes = input.userIdType
    ? [input.userIdType]
    : (["open_id", "user_id", "union_id"] as const);

  const chatId = normalizeChatId(input.chatId);
  if (chatId) {
    for (const userIdType of userIdTypes) {
      let pageToken = "";
      for (let page = 0; page < 20; page += 1) {
        const query = new URLSearchParams({
          member_id_type: userIdType,
          page_size: "100",
        });
        if (pageToken) {
          query.set("page_token", pageToken);
        }
        const response = await fetch(
          `${FEISHU_API_BASE}/im/v1/chats/${encodeURIComponent(chatId)}/members?${query.toString()}`,
          {
            headers: {
              authorization: `Bearer ${accessToken}`,
            },
          },
        );
        await assertHttpOk(response, "飞书", "会话成员拉取");
        const payload = (await response.json()) as FeishuChatMembersResponse;
        if (typeof payload.code === "number" && payload.code !== 0) {
          break;
        }

        const matchedMember = payload.data?.items?.find(
          (item) => normalizeChatId(item.member_id) === userId,
        );
        const memberName = matchedMember?.name?.trim() ?? "";
        if (memberName) {
          input.cache.set(cacheKey, memberName);
          input.cache.set(`${userIdType}:${userId}`, memberName);
          return memberName;
        }

        const hasMore = payload.data?.has_more === true;
        const nextPageToken =
          typeof payload.data?.page_token === "string"
            ? payload.data.page_token.trim()
            : "";
        if (!hasMore || !nextPageToken) {
          break;
        }
        pageToken = nextPageToken;
      }
    }
  }

  for (const userIdType of userIdTypes) {
    const query = new URLSearchParams({ user_id_type: userIdType });
    const response = await fetch(
      `${FEISHU_API_BASE}/contact/v3/users/${encodeURIComponent(userId)}?${query.toString()}`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      },
    );
    await assertHttpOk(response, "飞书", "用户详情拉取");
    const payload = (await response.json()) as FeishuUserInfoResponse;
    if (typeof payload.code === "number" && payload.code !== 0) {
      continue;
    }

    const displayName =
      payload.data?.user?.name?.trim() ||
      payload.data?.user?.en_name?.trim() ||
      payload.data?.user?.nickname?.trim() ||
      "";
    if (!displayName) {
      continue;
    }

    input.cache.set(cacheKey, displayName);
    input.cache.set(`${userIdType}:${userId}`, displayName);
    return displayName;
  }

  input.cache.set(cacheKey, null);
  return "";
};
