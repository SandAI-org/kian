import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  BaseInfo,
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  SendMessageReq,
  SendTypingReq,
} from "./types.js";

export interface WeixinApiOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  routeTag?: string;
  channelVersion?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_LIGHT_API_TIMEOUT_MS = 10_000;

function resolvePackageVersion(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.resolve(currentDir, "..", "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
      version?: string;
    };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const PACKAGE_VERSION = resolvePackageVersion();

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function randomWechatUin(): string {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf-8").toString("base64");
}

export function buildBaseInfo(channelVersion = PACKAGE_VERSION): BaseInfo {
  return { channel_version: channelVersion };
}

export function buildHeaders(options: {
  token?: string;
  routeTag?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };

  if (options.token?.trim()) {
    headers.Authorization = `Bearer ${options.token.trim()}`;
  }

  if (options.routeTag?.trim()) {
    headers.SKRouteTag = options.routeTag.trim();
  }

  return headers;
}

async function postJson<TResponse>(options: {
  endpoint: string;
  body: object;
  apiOptions: WeixinApiOptions;
  defaultTimeoutMs: number;
}): Promise<TResponse> {
  const fetchImpl = options.apiOptions.fetchImpl ?? fetch;
  const body = JSON.stringify({
    ...options.body,
    base_info: buildBaseInfo(options.apiOptions.channelVersion),
  });
  const url = new URL(options.endpoint, ensureTrailingSlash(options.apiOptions.baseUrl)).toString();
  const controller = new AbortController();
  const timeoutMs = options.apiOptions.timeoutMs ?? options.defaultTimeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: buildHeaders({
        ...(options.apiOptions.token ? { token: options.apiOptions.token } : {}),
        ...(options.apiOptions.routeTag ? { routeTag: options.apiOptions.routeTag } : {}),
      }),
      body,
      signal: controller.signal,
    });
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`${options.endpoint} ${response.status}: ${rawText}`);
    }

    if (!rawText.trim()) {
      return {} as TResponse;
    }

    return JSON.parse(rawText) as TResponse;
  } finally {
    clearTimeout(timer);
  }
}

export async function getUpdates(
  request: GetUpdatesReq,
  apiOptions: WeixinApiOptions,
): Promise<GetUpdatesResp> {
  try {
    return await postJson<GetUpdatesResp>({
      endpoint: "ilink/bot/getupdates",
      body: {
        get_updates_buf: request.get_updates_buf ?? "",
      },
      apiOptions,
      defaultTimeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ret: 0,
        msgs: [],
        ...(typeof request.get_updates_buf === "string"
          ? { get_updates_buf: request.get_updates_buf }
          : {}),
      };
    }
    throw error;
  }
}

export async function sendMessage(
  request: SendMessageReq,
  apiOptions: WeixinApiOptions,
): Promise<void> {
  await postJson<Record<string, never>>({
    endpoint: "ilink/bot/sendmessage",
    body: request,
    apiOptions,
    defaultTimeoutMs: DEFAULT_API_TIMEOUT_MS,
  });
}

export async function getUploadUrl(
  request: GetUploadUrlReq,
  apiOptions: WeixinApiOptions,
): Promise<GetUploadUrlResp> {
  return postJson<GetUploadUrlResp>({
    endpoint: "ilink/bot/getuploadurl",
    body: request,
    apiOptions,
    defaultTimeoutMs: DEFAULT_API_TIMEOUT_MS,
  });
}

export async function getConfig(
  request: { ilinkUserId: string; contextToken?: string },
  apiOptions: WeixinApiOptions,
): Promise<GetConfigResp> {
  return postJson<GetConfigResp>({
    endpoint: "ilink/bot/getconfig",
    body: {
      ilink_user_id: request.ilinkUserId,
      context_token: request.contextToken,
    },
    apiOptions,
    defaultTimeoutMs: DEFAULT_LIGHT_API_TIMEOUT_MS,
  });
}

export async function sendTyping(
  request: SendTypingReq,
  apiOptions: WeixinApiOptions,
): Promise<void> {
  await postJson<Record<string, never>>({
    endpoint: "ilink/bot/sendtyping",
    body: request,
    apiOptions,
    defaultTimeoutMs: DEFAULT_LIGHT_API_TIMEOUT_MS,
  });
}
