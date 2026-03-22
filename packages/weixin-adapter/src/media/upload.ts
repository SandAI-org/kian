import crypto, { createCipheriv } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getUploadUrl, sendMessage, type WeixinApiOptions } from "../api/api.js";
import {
  MessageItemType,
  MessageState,
  MessageType,
  UploadMediaType,
  type MessageItem,
  type SendMessageReq,
} from "../api/types.js";
import { DEFAULT_CDN_BASE_URL } from "../storage/account-store.js";
import { generateClientId } from "../utils/ids.js";
import { createLogger, type WeixinAdapterLogger } from "../utils/logger.js";
import { redactUrl } from "../utils/redact.js";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif",
  ".heic",
  ".heif",
]);
const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/json": ".json",
  "application/zip": ".zip",
};
const REMOTE_MEDIA_URL_PATTERN = /^https?:\/\//i;
const DATA_IMAGE_URL_PATTERN =
  /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;
const FILE_URL_PATTERN = /^file:\/\//i;
const UNSUPPORTED_REMOTE_MEDIA_URL_PATTERN = /^(?:data:|blob:)/i;
const CDN_UPLOAD_MAX_RETRIES = 3;

export type WeixinSendMediaKind = "image" | "file";

export interface UploadedWeixinMedia {
  kind: WeixinSendMediaKind;
  fileName: string;
  fileKey: string;
  downloadEncryptedQueryParam: string;
  aesKeyHex: string;
  fileSize: number;
  ciphertextSize: number;
}

export interface WeixinUploadLocalFileOptions {
  filePath: string;
  toUserId: string;
  apiOptions: WeixinApiOptions;
  cdnBaseUrl?: string;
  fileName?: string;
  kind?: WeixinSendMediaKind;
  logger?: WeixinAdapterLogger;
}

export interface WeixinSendMediaOptions {
  toUserId: string;
  contextToken?: string;
  filePath?: string;
  remoteUrl?: string;
  fileName?: string;
  text?: string;
  apiOptions: WeixinApiOptions;
  cdnBaseUrl?: string;
  logger?: WeixinAdapterLogger;
}

const normalizeFileName = (value: string | undefined, fallback: string): string => {
  const normalized =
    path
      .basename(value?.trim() || fallback)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || fallback;
  if (normalized === "." || normalized === "..") {
    return fallback;
  }
  return normalized;
};

const detectMediaKind = (fileName: string): WeixinSendMediaKind => {
  const extension = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) ? "image" : "file";
};

const getExtensionFromMimeType = (mimeType: string | null): string => {
  if (!mimeType) {
    return "";
  }
  return MIME_EXTENSION_MAP[mimeType.split(";")[0]?.trim().toLowerCase() ?? ""] ?? "";
};

const resolveRemoteFileName = (
  remoteUrl: string,
  preferredFileName: string | undefined,
  contentType: string | null,
): string => {
  if (preferredFileName?.trim()) {
    return normalizeFileName(preferredFileName, "file");
  }

  try {
    const url = new URL(remoteUrl);
    const pathnameFileName = path.basename(url.pathname);
    if (pathnameFileName && pathnameFileName !== "/") {
      const normalized = normalizeFileName(pathnameFileName, "file");
      if (path.extname(normalized)) {
        return normalized;
      }
      const extension = getExtensionFromMimeType(contentType);
      return extension ? `${normalized}${extension}` : normalized;
    }
  } catch {
    // Fall through to the generic fallback below.
  }

  const extension = getExtensionFromMimeType(contentType);
  return `file${extension}`;
};

const resolveFileUrlPath = (value: string): string => {
  return decodeURIComponent(new URL(value).pathname);
};

const aesEcbPaddedSize = (plaintextSize: number): number =>
  Math.ceil((plaintextSize + 1) / 16) * 16;

const encryptAesEcb = (plaintext: Buffer, key: Buffer): Buffer => {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
};

const buildCdnUploadUrl = (input: {
  cdnBaseUrl: string;
  uploadParam: string;
  fileKey: string;
}): string =>
  `${input.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(
    input.uploadParam,
  )}&filekey=${encodeURIComponent(input.fileKey)}`;

const uploadBufferToCdn = async (input: {
  buffer: Buffer;
  uploadParam: string;
  fileKey: string;
  cdnBaseUrl: string;
  aesKey: Buffer;
  logger: WeixinAdapterLogger;
}): Promise<{ downloadParam: string }> => {
  const ciphertext = encryptAesEcb(input.buffer, input.aesKey);
  const uploadUrl = buildCdnUploadUrl({
    cdnBaseUrl: input.cdnBaseUrl,
    uploadParam: input.uploadParam,
    fileKey: input.fileKey,
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= CDN_UPLOAD_MAX_RETRIES; attempt += 1) {
    try {
      input.logger.debug(
        `uploadBufferToCdn attempt=${attempt} url=${redactUrl(uploadUrl)} bytes=${ciphertext.byteLength}`,
      );
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
        },
        body: new Uint8Array(ciphertext),
      });

      if (response.status >= 400 && response.status < 500) {
        const errorText = response.headers.get("x-error-message") || (await response.text());
        throw new Error(`CDN upload client error ${response.status}: ${errorText}`);
      }
      if (response.status !== 200) {
        const errorText = response.headers.get("x-error-message") || `status ${response.status}`;
        throw new Error(`CDN upload server error: ${errorText}`);
      }

      const downloadParam = response.headers.get("x-encrypted-param")?.trim();
      if (!downloadParam) {
        throw new Error("CDN upload response missing x-encrypted-param header");
      }
      return { downloadParam };
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes("client error")
      ) {
        throw error;
      }
      if (attempt < CDN_UPLOAD_MAX_RETRIES) {
        input.logger.warn(
          `uploadBufferToCdn retrying attempt=${attempt} error=${String(error)}`,
        );
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("CDN upload failed");
};

const buildMediaReference = (uploaded: UploadedWeixinMedia) => ({
  encrypt_query_param: uploaded.downloadEncryptedQueryParam,
  aes_key: Buffer.from(uploaded.aesKeyHex).toString("base64"),
  encrypt_type: 1,
});

const sendMessageItem = async (input: {
  toUserId: string;
  contextToken: string;
  item: MessageItem;
  apiOptions: WeixinApiOptions;
}): Promise<{ messageId: string }> => {
  const clientId = generateClientId();
  const request: SendMessageReq = {
    msg: {
      from_user_id: "",
      to_user_id: input.toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [input.item],
      context_token: input.contextToken,
    },
  };
  await sendMessage(request, input.apiOptions);
  return { messageId: clientId };
};

const uploadMediaBuffer = async (input: {
  buffer: Buffer;
  toUserId: string;
  apiOptions: WeixinApiOptions;
  cdnBaseUrl: string;
  fileName: string;
  kind: WeixinSendMediaKind;
  logger: WeixinAdapterLogger;
}): Promise<UploadedWeixinMedia> => {
  const rawSize = input.buffer.byteLength;
  const fileKey = crypto.randomBytes(16).toString("hex");
  const aesKey = crypto.randomBytes(16);
  const rawFileMd5 = crypto.createHash("md5").update(input.buffer).digest("hex");
  const ciphertextSize = aesEcbPaddedSize(rawSize);

  const uploadUrlResponse = await getUploadUrl(
    {
      filekey: fileKey,
      media_type:
        input.kind === "image" ? UploadMediaType.IMAGE : UploadMediaType.FILE,
      to_user_id: input.toUserId,
      rawsize: rawSize,
      rawfilemd5: rawFileMd5,
      filesize: ciphertextSize,
      aeskey: aesKey.toString("hex"),
      no_need_thumb: true,
    },
    input.apiOptions,
  );

  const uploadParam = uploadUrlResponse.upload_param?.trim();
  if (!uploadParam) {
    throw new Error("getUploadUrl returned no upload_param");
  }

  input.logger.debug(
    `uploadMediaBuffer kind=${input.kind} fileName=${input.fileName} rawSize=${rawSize} fileKey=${fileKey}`,
  );

  const { downloadParam } = await uploadBufferToCdn({
    buffer: input.buffer,
    uploadParam,
    fileKey,
    cdnBaseUrl: input.cdnBaseUrl,
    aesKey,
    logger: input.logger,
  });

  return {
    kind: input.kind,
    fileName: input.fileName,
    fileKey,
    downloadEncryptedQueryParam: downloadParam,
    aesKeyHex: aesKey.toString("hex"),
    fileSize: rawSize,
    ciphertextSize,
  };
};

const downloadRemoteFile = async (input: {
  remoteUrl: string;
  fileName?: string;
}): Promise<{ filePath: string; fileName: string; cleanup: () => Promise<void> }> => {
  if (UNSUPPORTED_REMOTE_MEDIA_URL_PATTERN.test(input.remoteUrl)) {
    throw new Error("Remote data/blob URLs are not supported");
  }

  const response = await fetch(input.remoteUrl);
  if (!response.ok) {
    throw new Error(
      `Remote media download failed: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName = resolveRemoteFileName(
    input.remoteUrl,
    input.fileName,
    response.headers.get("content-type"),
  );
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kian-weixin-media-"));
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, buffer);

  return {
    filePath,
    fileName,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
};

export async function uploadLocalFile(
  options: WeixinUploadLocalFileOptions,
): Promise<UploadedWeixinMedia> {
  const logger = options.logger ?? createLogger();
  const normalizedFilePath = path.normalize(options.filePath);
  const fileBuffer = await fs.readFile(normalizedFilePath);
  const fileName = normalizeFileName(
    options.fileName,
    path.basename(normalizedFilePath) || "file",
  );
  const kind = options.kind ?? detectMediaKind(fileName);

  return uploadMediaBuffer({
    buffer: fileBuffer,
    toUserId: options.toUserId,
    apiOptions: options.apiOptions,
    cdnBaseUrl: options.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL,
    fileName,
    kind,
    logger,
  });
}

export async function sendMedia(
  options: WeixinSendMediaOptions,
): Promise<{ messageId: string }> {
  const logger = options.logger ?? createLogger();
  const contextToken = options.contextToken?.trim();
  if (!contextToken) {
    throw new Error("contextToken is required");
  }

  let uploaded: UploadedWeixinMedia;
  let cleanup: (() => Promise<void>) | undefined;

  try {
    if (options.filePath?.trim()) {
      uploaded = await uploadLocalFile({
        filePath: options.filePath.trim(),
        toUserId: options.toUserId,
        apiOptions: options.apiOptions,
        logger,
        ...(options.cdnBaseUrl ? { cdnBaseUrl: options.cdnBaseUrl } : {}),
        ...(options.fileName ? { fileName: options.fileName } : {}),
      });
    } else if (options.remoteUrl?.trim()) {
      const remoteUrl = options.remoteUrl.trim();
      const dataImageMatch = remoteUrl.match(DATA_IMAGE_URL_PATTERN);
      if (dataImageMatch) {
        const mimeType = dataImageMatch[1];
        const base64Data = dataImageMatch[2];
        if (!mimeType || !base64Data) {
          throw new Error("data:image URL is invalid");
        }
        const base64 = base64Data.replace(/\s+/g, "");
        const extension = getExtensionFromMimeType(mimeType) || ".png";
        uploaded = await uploadMediaBuffer({
          buffer: Buffer.from(base64, "base64"),
          toUserId: options.toUserId,
          apiOptions: options.apiOptions,
          cdnBaseUrl: options.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL,
          fileName: normalizeFileName(
            options.fileName,
            `image${extension}`,
          ),
          kind: "image",
          logger,
        });
      } else if (FILE_URL_PATTERN.test(remoteUrl)) {
        uploaded = await uploadLocalFile({
          filePath: resolveFileUrlPath(remoteUrl),
          toUserId: options.toUserId,
          apiOptions: options.apiOptions,
          logger,
          ...(options.cdnBaseUrl ? { cdnBaseUrl: options.cdnBaseUrl } : {}),
          ...(options.fileName ? { fileName: options.fileName } : {}),
        });
      } else {
        if (!REMOTE_MEDIA_URL_PATTERN.test(remoteUrl)) {
          throw new Error("remoteUrl must be an http(s), file://, or data:image URL");
        }
        const downloaded = await downloadRemoteFile({
          remoteUrl,
          ...(options.fileName ? { fileName: options.fileName } : {}),
        });
        cleanup = downloaded.cleanup;
        uploaded = await uploadLocalFile({
          filePath: downloaded.filePath,
          toUserId: options.toUserId,
          apiOptions: options.apiOptions,
          logger,
          ...(options.cdnBaseUrl ? { cdnBaseUrl: options.cdnBaseUrl } : {}),
          fileName: downloaded.fileName,
        });
      }
    } else {
      throw new Error("filePath or remoteUrl is required");
    }

    let lastResult: { messageId: string } | null = null;
    const text = options.text?.trim();
    if (text) {
      lastResult = await sendMessageItem({
        toUserId: options.toUserId,
        contextToken,
        item: {
          type: MessageItemType.TEXT,
          text_item: { text },
        },
        apiOptions: options.apiOptions,
      });
    }

    const mediaItem: MessageItem =
      uploaded.kind === "image"
        ? {
            type: MessageItemType.IMAGE,
            image_item: {
              media: buildMediaReference(uploaded),
              mid_size: uploaded.ciphertextSize,
            },
          }
        : {
            type: MessageItemType.FILE,
            file_item: {
              media: buildMediaReference(uploaded),
              file_name: uploaded.fileName,
              len: String(uploaded.fileSize),
            },
          };

    lastResult = await sendMessageItem({
      toUserId: options.toUserId,
      contextToken,
      item: mediaItem,
      apiOptions: options.apiOptions,
    });
    return lastResult;
  } finally {
    if (cleanup) {
      await cleanup().catch((error) => {
        logger.warn(`cleanup remote media temp file failed: ${String(error)}`);
      });
    }
  }
}
