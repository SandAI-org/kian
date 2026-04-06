import type { WeixinInboundMessage } from "@kian/weixin-adapter";
import * as Lark from "@larksuiteoapi/node-sdk";
import type {
  ChatAttachmentDTO,
  ChatCapabilityMode,
  ChatMessageMetadata,
  ChatModuleType,
  ChatScope,
  ChatStreamEvent,
} from "@shared/types";
import { randomUUID } from "node:crypto";
import {
  editDiscordBotMessage as editDiscordBotMessageImpl,
  fetchDiscordBotProfile as fetchDiscordBotProfileImpl,
  fetchDiscordChannelDisplayName as fetchDiscordChannelDisplayNameImpl,
  fetchDiscordMessages as fetchDiscordMessagesImpl,
  loadDiscordInboundAttachments as loadDiscordInboundAttachmentsImpl,
  resolveDiscordChannelGuildId as resolveDiscordChannelGuildIdImpl,
  sendDiscordBotDocument as sendDiscordBotDocumentImpl,
  sendDiscordBotMessage as sendDiscordBotMessageImpl,
  setDiscordMessageReaction as setDiscordMessageReactionImpl,
} from "./chatChannel/discordTransport";
import {
  buildFeishuMarkdownCard,
  clearFeishuTenantTokenCache,
  fetchFeishuChatDisplayName as fetchFeishuChatDisplayNameImpl,
  fetchFeishuChatIds as fetchFeishuChatIdsImpl,
  fetchFeishuMessages as fetchFeishuMessagesImpl,
  fetchFeishuUserDisplayName as fetchFeishuUserDisplayNameImpl,
  parseFeishuBotToken as parseFeishuBotTokenImpl,
  resolveFeishuAccessToken as resolveFeishuAccessTokenImpl,
  sendFeishuBotCard as sendFeishuBotCardImpl,
  sendFeishuBotCardByCardId as sendFeishuBotCardByCardIdImpl,
  sendFeishuBotDocument as sendFeishuBotDocumentImpl,
  sendFeishuBotMessage as sendFeishuBotMessageImpl,
  setFeishuMessageReaction as setFeishuMessageReactionImpl,
  updateFeishuBotCard as updateFeishuBotCardImpl,
  createFeishuStreamingCard as createFeishuStreamingCardImpl,
  updateFeishuStreamingCardText as updateFeishuStreamingCardTextImpl,
  stopFeishuCardStreaming as stopFeishuCardStreamingImpl,
} from "./chatChannel/feishuTransport";
import { createEditableChannelReplyStreamer } from "./chatChannel/channelLiveMessageStreamer";
import {
  createFeishuWsHeartbeatState,
  getFeishuWsHealthStatus,
  markFeishuWsHeartbeatEvent,
  markFeishuWsHeartbeatPing,
  markFeishuWsHeartbeatPong,
  type FeishuWsHeartbeatState,
} from "./chatChannel/feishuWsHeartbeat";
import {
  buildTelegramAssistantTimelineFromStreamEvents as buildTelegramAssistantTimelineFromStreamEventsImpl,
  buildTelegramToolCallsFromStreamEvents as buildTelegramToolCallsFromStreamEventsImpl,
  createTelegramAssistantProgressiveStreamer as createTelegramAssistantProgressiveStreamerImpl,
  extractTelegramFileAttachments as extractTelegramFileAttachmentsImpl,
  formatTelegramAssistantBody as formatTelegramAssistantBodyImpl,
  formatTelegramToolCallMessage as formatTelegramToolCallMessageImpl,
  normalizeTelegramToolCalls as normalizeTelegramToolCallsImpl,
  stripTelegramFileMarkdown as stripTelegramFileMarkdownImpl,
} from "./chatChannel/telegramMirror";
import {
  editTelegramMessage as editTelegramMessageImpl,
  fetchTelegramBotProfile as fetchTelegramBotProfileImpl,
  fetchTelegramUpdates as fetchTelegramUpdatesImpl,
  loadTelegramInboundAttachments as loadTelegramInboundAttachmentsImpl,
  sendTelegramDocument as sendTelegramDocumentImpl,
  sendTelegramMessage as sendTelegramMessageImpl,
  sendTelegramTyping as sendTelegramTypingImpl,
  setTelegramMessageReaction as setTelegramMessageReactionImpl,
} from "./chatChannel/telegramTransport";
import {
  cleanupInboundTempDirectory,
  createInboundTempDirectory,
  downloadInboundFileToTemp,
  importInboundFilesToChatAttachments,
  normalizeMimeType,
  readRecordString,
} from "./chatChannel/transportCommon";
import { chatChannelOwnerDiscoveryService } from "./chatChannelOwnerDiscoveryService";
import { weixinChannelService } from "./chatChannel/weixinChannelService";
import { chatService } from "./chatService";
import { logger } from "./logger";
import { repositoryService } from "./repositoryService";
import { settingsService } from "./settingsService";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";
const TELEGRAM_POLL_TIMEOUT_SECONDS = 20;
const TELEGRAM_POLL_RETRY_DELAY_MS = 3_000;
const DISCORD_POLL_INTERVAL_MS = 3_000;
const FEISHU_POLL_INTERVAL_MS = 3_000;
const FEISHU_CHAT_DISCOVERY_INTERVAL_MS = 60_000;
const FEISHU_EVENT_CACHE_TTL_MS = 10 * 60_000;
const FEISHU_WS_HEALTHCHECK_INTERVAL_MS = 30_000;
const FEISHU_WS_PONG_TIMEOUT_MS = 3 * 60_000;
const FEISHU_WS_HEARTBEAT_SILENCE_TIMEOUT_MS = 6 * 60_000;
const FEISHU_LOG_PREVIEW_MAX_LENGTH = 120;
const TELEGRAM_TYPING_INTERVAL_MS = 4_000;
const TELEGRAM_REPLY_REACTION_EMOJI = "👀";
const DISCORD_REPLY_REACTION_EMOJI = "✨";
const FEISHU_REPLY_REACTION_EMOJI_TYPE = "Get";
const TELEGRAM_UNAUTHORIZED_USER_MESSAGE =
  "你不是我的主人，我要等我的主人回来。";
const WEIXIN_SUPPORTED_INPUT_MESSAGE =
  "当前微信渠道 MVP 仅支持文本消息。";
const WEIXIN_HELP_MESSAGE =
  "已连接到 Kian Agent。当前微信渠道 MVP 支持扫码登录、长轮询和文本消息收发。";
const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg";
const DISCORD_GATEWAY_RECONNECT_DELAY_MS = 5_000;
const DISCORD_GATEWAY_INTENTS = 1 << 0;
const CHANNEL_SUPPORTED_INPUT_MESSAGE =
  "目前支持文本和图片、音频、视频、文档消息。";
const CHANNEL_HELP_MESSAGE =
  "已连接到 Kian Agent。直接发送文本、图片、音频、视频或文档即可对话。";
const MAIN_AGENT_SCOPE_ID = "main-agent";
const DIGITAL_AVATAR_BATCH_LIMIT = 10;
const DIGITAL_AVATAR_IDLE_FLUSH_MS = 60_000;

const MAIN_CHAT_SCOPE: ChatScope = { type: "main" };

const toProjectScope = (projectId: string): ChatScope => ({
  type: "project",
  projectId,
});

const toChatScopeFromProjectId = (projectId: string): ChatScope =>
  projectId.trim() === MAIN_AGENT_SCOPE_ID
    ? MAIN_CHAT_SCOPE
    : toProjectScope(projectId);

const getSessionReplyContextKey = (
  scope: ChatScope,
  sessionId: string,
): string =>
  `${scope.type === "main" ? MAIN_AGENT_SCOPE_ID : scope.projectId}:${sessionId}`;

interface TelegramChat {
  id: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramFileDescriptor {
  file_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramPhotoSize {
  file_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface TelegramMessage {
  message_id?: number;
  chat?: TelegramChat;
  text?: string;
  caption?: string;
  entities?: Array<{
    type?: string;
    offset?: number;
    length?: number;
    user?: {
      id?: number | string;
    };
  }>;
  caption_entities?: Array<{
    type?: string;
    offset?: number;
    length?: number;
    user?: {
      id?: number | string;
    };
  }>;
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
    username?: string;
    first_name?: string;
  };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramRuntime {
  token: string;
  projectId: string;
  scope: ChatScope;
  ownerUserIds: Set<string>;
  botUserId: string;
  botUsername: string;
  offset: number;
}

interface BotRuntime {
  provider: "discord" | "feishu";
  token: string;
  projectId: string;
  scope: ChatScope;
  ownerUserIds: Set<string>;
  activeChatIds: Set<string>;
}

interface DiscordRuntime extends BotRuntime {
  provider: "discord";
  botUserId: string;
  allowedServerIds: Set<string>;
  allowedChannelIds: Set<string>;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  attachments?: DiscordAttachmentItem[];
  mentions?: Array<{ id?: string }>;
  author?: {
    id?: string;
    bot?: boolean;
    username?: string;
    global_name?: string;
  };
}

interface DiscordAttachmentItem {
  id?: string;
  filename?: string;
  content_type?: string;
  url?: string;
  proxy_url?: string;
  size?: number;
}

interface DiscordGatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

interface FeishuMessageItem {
  message_id?: string;
  chat_id?: string;
  chat_type?: string;
  create_time?: string;
  msg_type?: string;
  body?: {
    content?: string;
  };
  mentions?: Array<{
    key?: string;
    id?: string;
    name?: string;
  }>;
  sender?: {
    sender_type?: string;
    id?: string | FeishuSenderId;
    sender_id?: FeishuSenderId;
  };
}

interface FeishuSenderId {
  user_id?: string;
  open_id?: string;
  union_id?: string;
}

type FeishuUserIdType = "open_id" | "user_id" | "union_id";

type FeishuMessageReceiveEvent = Parameters<
  NonNullable<Lark.EventHandles["im.message.receive_v1"]>
>[0];

type FeishuResourceType = "image" | "file" | "audio" | "media";

interface FeishuInboundAttachmentCandidate {
  messageId: string;
  resourceType: FeishuResourceType;
  resourceKey: string;
  fileName?: string;
  mimeType?: string;
  fallbackName: string;
  fallbackExtension?: string;
}

type ChannelChatType = "direct" | "group";

interface ChannelBatchItem {
  text: string;
  senderId: string;
  senderName: string;
  createdAt: string;
  mentioned: boolean;
}

interface ChannelBatchState {
  provider: SessionReplyContext["provider"];
  runtimeScope: ChatScope;
  runtimeSessionId: string;
  digitalAvatarSessionId: string;
  chatId: string;
  replyText: (text: string) => Promise<void>;
  sendLiveMessage?: (text: string) => Promise<string | number | undefined>;
  updateLiveMessage?: (
    messageId: string | number,
    text: string,
  ) => Promise<void>;
  onStreamingDone?: () => Promise<void>;
  replyDocument?: (filePath: string) => Promise<void>;
  sendAttachmentsFirst?: boolean;
  flushTimer: NodeJS.Timeout | null;
  items: ChannelBatchItem[];
}

interface TelegramToolCallSummary {
  toolUseId?: string;
  toolName: string;
  toolInput?: string;
  output?: string;
}

interface TelegramAssistantTimelineAssistantBlock {
  type: "assistant";
  message: string;
}

interface TelegramAssistantTimelineToolBlock {
  type: "tool";
  tool: TelegramToolCallSummary;
}

type TelegramAssistantTimelineBlock =
  | TelegramAssistantTimelineAssistantBlock
  | TelegramAssistantTimelineToolBlock;

interface TelegramAssistantProgressiveStreamer {
  pushEvent: (event: ChatStreamEvent) => void;
  finalize: (input: {
    fallbackAssistantMessage: string;
    toolActions?: string[];
    isError?: boolean;
  }) => Promise<void>;
}

interface SessionReplyContext {
  provider: "telegram" | "discord" | "feishu" | "weixin";
  chatId: string;
  accountId?: string;
}

let runtime: TelegramRuntime | null = null;
let running = false;
let polling = false;
let bootstrapped = false;
let pollTimer: NodeJS.Timeout | null = null;
let pollAbortController: AbortController | null = null;
let discordRuntime: DiscordRuntime | null = null;
let feishuRuntime: BotRuntime | null = null;
let discordPolling = false;
let discordPollTimer: NodeJS.Timeout | null = null;
let discordGatewaySocket: WebSocket | null = null;
let discordGatewayHeartbeatTimer: NodeJS.Timeout | null = null;
let discordGatewayReconnectTimer: NodeJS.Timeout | null = null;
let discordGatewayToken = "";
let discordGatewayLastSequence: number | null = null;
let feishuPolling = false;
let feishuPollTimer: NodeJS.Timeout | null = null;
let feishuWsClient: Lark.WSClient | null = null;
let feishuWsHealthTimer: NodeJS.Timeout | null = null;
let feishuWsHeartbeatState: FeishuWsHeartbeatState | null = null;
let discordLastMessageIdByChat = new Map<string, string>();
let discordGuildIdByChannel = new Map<string, string | null>();
let discordChannelDisplayNameByChannel = new Map<string, string | null>();
let feishuLastMessageTsByChat = new Map<string, number>();
let feishuLastChatSyncAt = 0;
let feishuEventCache = new Map<string, number>();
let feishuChatDisplayNameByChat = new Map<string, string | null>();
let feishuUserDisplayNameByUser = new Map<string, string | null>();
let sessionReplyContextByKey = new Map<string, SessionReplyContext>();
let channelBatchStateByKey = new Map<string, ChannelBatchState>();
let mainAgentSessionPromise: Promise<string> | null = null;
let runtimeSignature = "";

const stopTelegramPolling = (): void => {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (pollAbortController) {
    pollAbortController.abort();
    pollAbortController = null;
  }
};

const stopDiscordPolling = (): void => {
  if (!discordPollTimer) return;
  clearTimeout(discordPollTimer);
  discordPollTimer = null;
};

const clearDiscordGatewayHeartbeat = (): void => {
  if (!discordGatewayHeartbeatTimer) return;
  clearInterval(discordGatewayHeartbeatTimer);
  discordGatewayHeartbeatTimer = null;
};

const clearDiscordGatewayReconnect = (): void => {
  if (!discordGatewayReconnectTimer) return;
  clearTimeout(discordGatewayReconnectTimer);
  discordGatewayReconnectTimer = null;
};

const sendDiscordGatewayPayload = (
  socket: WebSocket,
  payload: DiscordGatewayPayload,
): void => {
  socket.send(JSON.stringify(payload));
};

const stopDiscordGatewayConnection = (): void => {
  clearDiscordGatewayHeartbeat();
  clearDiscordGatewayReconnect();
  discordGatewayLastSequence = null;
  discordGatewayToken = "";
  const socket = discordGatewaySocket;
  discordGatewaySocket = null;
  if (!socket) return;
  try {
    socket.close(1000, "shutdown");
  } catch {
    // ignore close errors
  }
};

const scheduleDiscordGatewayReconnect = (
  token: string,
  delayMs = DISCORD_GATEWAY_RECONNECT_DELAY_MS,
): void => {
  clearDiscordGatewayReconnect();
  discordGatewayReconnectTimer = setTimeout(
    () => {
      discordGatewayReconnectTimer = null;
      if (!discordRuntime) return;
      if (discordRuntime.token !== token) return;
      if (discordGatewayToken !== token) return;
      startDiscordGatewayConnection(token);
    },
    Math.max(0, delayMs),
  );
};

const startDiscordGatewayConnection = (token: string): void => {
  const normalizedToken = token.trim();
  if (!normalizedToken) return;
  if (
    discordGatewayToken === normalizedToken &&
    discordGatewaySocket &&
    (discordGatewaySocket.readyState === WebSocket.CONNECTING ||
      discordGatewaySocket.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  stopDiscordGatewayConnection();
  discordGatewayToken = normalizedToken;
  clearDiscordGatewayReconnect();
  const socket = new WebSocket(`${DISCORD_GATEWAY_URL}/?v=10&encoding=json`);
  discordGatewaySocket = socket;

  socket.addEventListener("message", (event) => {
    const data =
      typeof event.data === "string"
        ? event.data
        : typeof (event.data as { toString?: () => string })?.toString ===
            "function"
          ? (event.data as { toString: () => string }).toString()
          : "";
    if (!data) return;

    let payload: DiscordGatewayPayload;
    try {
      payload = JSON.parse(data) as DiscordGatewayPayload;
    } catch {
      return;
    }

    if (typeof payload.s === "number" && Number.isFinite(payload.s)) {
      discordGatewayLastSequence = payload.s;
    }

    if (payload.op === 10) {
      const heartbeatInterval = Number(
        (payload.d as { heartbeat_interval?: unknown } | undefined)
          ?.heartbeat_interval,
      );
      if (Number.isFinite(heartbeatInterval) && heartbeatInterval > 0) {
        clearDiscordGatewayHeartbeat();
        discordGatewayHeartbeatTimer = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          sendDiscordGatewayPayload(socket, {
            op: 1,
            d: discordGatewayLastSequence,
          });
        }, heartbeatInterval);
        sendDiscordGatewayPayload(socket, {
          op: 1,
          d: discordGatewayLastSequence,
        });
      }

      sendDiscordGatewayPayload(socket, {
        op: 2,
        d: {
          token: normalizedToken,
          intents: DISCORD_GATEWAY_INTENTS,
          properties: {
            os: process.platform,
            browser: "kian",
            device: "kian",
          },
          presence: {
            status: "online",
            afk: false,
            since: null,
            activities: [],
          },
        },
      });
      return;
    }

    if (payload.op === 7 || payload.op === 9) {
      try {
        socket.close(4000, "reconnect");
      } catch {
        // ignore close errors
      }
    }
  });

  socket.addEventListener("open", () => {
    logger.info("Discord gateway connected");
  });

  socket.addEventListener("error", (event) => {
    logger.warn("Discord gateway error", { event });
  });

  socket.addEventListener("close", (event) => {
    clearDiscordGatewayHeartbeat();
    if (discordGatewaySocket === socket) {
      discordGatewaySocket = null;
    }
    const shouldReconnect =
      Boolean(discordRuntime) &&
      discordRuntime?.token === normalizedToken &&
      discordGatewayToken === normalizedToken;
    if (!shouldReconnect) return;
    logger.warn("Discord gateway closed, scheduling reconnect", {
      code: event.code,
      reason: event.reason,
    });
    scheduleDiscordGatewayReconnect(normalizedToken);
  });
};

const stopFeishuPollTimer = (): void => {
  if (feishuPollTimer) {
    clearTimeout(feishuPollTimer);
    feishuPollTimer = null;
  }
};

const recordFeishuWsPing = (): void => {
  if (!feishuWsHeartbeatState) return;
  markFeishuWsHeartbeatPing(feishuWsHeartbeatState);
};

const recordFeishuWsPong = (): void => {
  if (!feishuWsHeartbeatState) return;
  markFeishuWsHeartbeatPong(feishuWsHeartbeatState);
};

const recordFeishuWsEvent = (): void => {
  if (!feishuWsHeartbeatState) return;
  markFeishuWsHeartbeatEvent(feishuWsHeartbeatState);
};

const stopFeishuWebSocket = (
  options?: {
    clearEventCache?: boolean;
  },
): void => {
  const clearEventCache = options?.clearEventCache ?? true;
  if (feishuWsHealthTimer) {
    clearInterval(feishuWsHealthTimer);
    feishuWsHealthTimer = null;
  }
  feishuWsHeartbeatState = null;
  if (feishuWsClient) {
    logger.info("Stopping Feishu websocket client");
    try {
      feishuWsClient.close({ force: true });
    } catch (error) {
      logger.warn("Failed to close Feishu websocket client", { error });
    }
    feishuWsClient = null;
  }
  if (clearEventCache) {
    feishuEventCache.clear();
  }
};

const stopFeishuPolling = (): void => {
  stopFeishuPollTimer();
  stopFeishuWebSocket();
};

const startFeishuWsHealthCheck = (state: BotRuntime): void => {
  if (feishuWsHealthTimer) {
    clearInterval(feishuWsHealthTimer);
  }
  feishuWsHealthTimer = setInterval(() => {
    if (feishuRuntime !== state) return;
    const wsClient = feishuWsClient;
    if (!wsClient) return;
    const heartbeatState = feishuWsHeartbeatState;
    if (!heartbeatState) return;
    const healthStatus = getFeishuWsHealthStatus(
      heartbeatState,
      Date.now(),
      {
        pongTimeoutMs: FEISHU_WS_PONG_TIMEOUT_MS,
        silenceTimeoutMs: FEISHU_WS_HEARTBEAT_SILENCE_TIMEOUT_MS,
      },
    );
    if (healthStatus.healthy) return;
    logger.warn("Feishu websocket heartbeat appears stale, restarting", {
      projectId: state.projectId,
      reason: healthStatus.reason,
      silenceMs: healthStatus.silenceMs,
      pendingPongMs:
        "pendingPongMs" in healthStatus
          ? healthStatus.pendingPongMs
          : undefined,
      lastSignalKind: healthStatus.lastSignalKind,
      lastPingAt: healthStatus.lastPingAt,
      lastPongAt: healthStatus.lastPongAt,
      lastEventAt: healthStatus.lastEventAt,
      lastUnackedPingAt: healthStatus.lastUnackedPingAt,
      reconnectInfo: wsClient.getReconnectInfo(),
    });
    startFeishuWebSocket(state, { reason: "stale_heartbeat" });
  }, FEISHU_WS_HEALTHCHECK_INTERVAL_MS);
};

const pruneFeishuEventCache = (now: number): void => {
  if (feishuEventCache.size === 0) return;
  for (const [eventKey, eventTime] of feishuEventCache) {
    if (now - eventTime > FEISHU_EVENT_CACHE_TTL_MS) {
      feishuEventCache.delete(eventKey);
    }
  }
};

const markFeishuEventSeen = (eventKey: string): boolean => {
  if (!eventKey) return true;
  const now = Date.now();
  pruneFeishuEventCache(now);
  const existingTime = feishuEventCache.get(eventKey);
  if (
    typeof existingTime === "number" &&
    now - existingTime <= FEISHU_EVENT_CACHE_TTL_MS
  ) {
    return false;
  }
  feishuEventCache.set(eventKey, now);
  return true;
};

const buildFeishuInboundEventKey = (
  data: FeishuMessageReceiveEvent,
): string => {
  const eventId = data.event_id?.trim();
  if (eventId) return `event:${eventId}`;
  const uuid = data.uuid?.trim();
  if (uuid) return `uuid:${uuid}`;
  const messageId = data.message?.message_id?.trim();
  if (messageId) return `message:${messageId}`;
  return "";
};

const toFeishuLogPreview = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.length <= FEISHU_LOG_PREVIEW_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, FEISHU_LOG_PREVIEW_MAX_LENGTH)}...`;
};

const toFeishuSdkLogText = (args: unknown[]): string =>
  args
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();

const recordFeishuSdkHeartbeat = (args: unknown[]): void => {
  const logText = toFeishuSdkLogText(args);
  if (!logText.includes("[ws]")) return;
  if (logText.includes("receive pong")) {
    recordFeishuWsPong();
    return;
  }
  if (logText.includes("ping success")) {
    recordFeishuWsPing();
  }
};

const feishuSdkLogger = {
  fatal: (...args: unknown[]) => logger.error("Feishu SDK fatal", args),
  error: (...args: unknown[]) => logger.error("Feishu SDK error", args),
  warn: (...args: unknown[]) => {
    recordFeishuSdkHeartbeat(args);
    logger.warn("Feishu SDK warn", args);
  },
  info: (...args: unknown[]) => {
    recordFeishuSdkHeartbeat(args);
    logger.info("Feishu SDK info", args);
  },
  debug: (...args: unknown[]) => {
    recordFeishuSdkHeartbeat(args);
    logger.info("Feishu SDK debug", args);
  },
  trace: (...args: unknown[]) => {
    recordFeishuSdkHeartbeat(args);
    const logText = toFeishuSdkLogText(args);
    if (
      logText.includes("ping success") ||
      logText.includes("receive pong")
    ) {
      return;
    }
    logger.info("Feishu SDK trace", args);
  },
};

const mapFeishuReceiveEventToMessage = (
  data: FeishuMessageReceiveEvent,
): FeishuMessageItem | null => {
  const payload = data.message;
  if (!payload) return null;
  const payloadRecord = payload as Record<string, unknown>;
  const messageId = normalizeChatId(payload.message_id);
  const chatId = normalizeChatId(payload.chat_id);
  const msgType = payload.message_type?.trim();
  const chatType =
    typeof payloadRecord.chat_type === "string"
      ? payloadRecord.chat_type.trim()
      : undefined;
  const mentions = Array.isArray(payloadRecord.mentions)
    ? payloadRecord.mentions
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const mention = item as Record<string, unknown>;
          return {
            key:
              typeof mention.key === "string" ? mention.key.trim() : undefined,
            id: normalizeChatId(
              typeof mention.id === "string" || typeof mention.id === "number"
                ? mention.id
                : undefined,
            ) ?? undefined,
            name:
              typeof mention.name === "string"
                ? mention.name.trim()
                : undefined,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : undefined;
  if (!messageId || !chatId || !msgType) return null;
  return {
    message_id: messageId,
    chat_id: chatId,
    chat_type: chatType,
    create_time: payload.create_time,
    msg_type: msgType,
    body: {
      content: typeof payload.content === "string" ? payload.content : "",
    },
    mentions,
    sender: {
      sender_type: data.sender?.sender_type,
      id: data.sender?.sender_id,
      sender_id: data.sender?.sender_id,
    },
  };
};

const startFeishuWebSocket = (
  state: BotRuntime,
  options?: { reason?: string },
): void => {
  const parsedToken = parseFeishuBotToken(state.token);
  if (!parsedToken) {
    logger.error("Failed to start Feishu websocket: invalid app credentials");
    return;
  }
  logger.info("Starting Feishu websocket listener", {
    projectId: state.projectId,
    appIdPreview: `${parsedToken.appId.slice(0, 6)}***`,
    note: "Will log inbound events and callback dispatch status",
    reason: options?.reason ?? "runtime_refresh",
  });
  stopFeishuPollTimer();
  stopFeishuWebSocket({ clearEventCache: false });
  const wsClient = new Lark.WSClient({
    appId: parsedToken.appId,
    appSecret: parsedToken.appSecret,
    autoReconnect: true,
    loggerLevel: Lark.LoggerLevel.trace,
    logger: feishuSdkLogger,
  });
  feishuWsClient = wsClient;
  feishuWsHeartbeatState = createFeishuWsHeartbeatState();
  startFeishuWsHealthCheck(state);

  const eventDispatcher = new Lark.EventDispatcher({
    loggerLevel: Lark.LoggerLevel.info,
    logger: feishuSdkLogger,
  }).register({
    "im.message.receive_v1": async (data: FeishuMessageReceiveEvent) => {
      recordFeishuWsEvent();
      const inboundMeta = {
        type: data.type,
        eventType: data.event_type,
        eventId: data.event_id,
        uuid: data.uuid,
        messageId: data.message?.message_id,
        chatId: data.message?.chat_id,
        messageType: data.message?.message_type,
        senderType: data.sender?.sender_type,
        contentPreview: toFeishuLogPreview(data.message?.content),
      };
      logger.info("Feishu inbound event received", inboundMeta);
      if (feishuRuntime !== state) return;
      const eventKey = buildFeishuInboundEventKey(data);
      if (!markFeishuEventSeen(eventKey)) {
        logger.info("Feishu inbound event skipped as duplicate", {
          eventKey,
          eventId: data.event_id,
          messageId: data.message?.message_id,
        });
        return;
      }
      const message = mapFeishuReceiveEventToMessage(data);
      if (!message) {
        logger.warn("Feishu inbound event ignored: invalid message payload", {
          eventId: data.event_id,
          messageId: data.message?.message_id,
          chatId: data.message?.chat_id,
          messageType: data.message?.message_type,
        });
        return;
      }
      logger.info("Feishu inbound event accepted", {
        eventKey,
        messageId: message.message_id,
        chatId: message.chat_id,
        messageType: message.msg_type,
      });
      // Websocket callbacks should return quickly to avoid timeout retries.
      void processFeishuMessage(
        message,
        state,
        message.chat_id ?? data.message?.chat_id ?? "",
      )
        .then(() => {
          logger.info("Feishu inbound event processed", {
            eventKey,
            messageId: message.message_id,
            chatId: message.chat_id,
          });
        })
        .catch((error) => {
          logger.error("Feishu websocket message process failed", {
            chatId: message.chat_id,
            messageId: message.message_id,
            error,
          });
        });
    },
  });

  wsClient
    .start({ eventDispatcher })
    .then(() => {
      logger.info("Feishu websocket start requested");
    })
    .catch((error) => {
      logger.error("Failed to start Feishu websocket client", error);
    });
};

const buildRuntimeSignature = (input: {
  token: string;
  projectId: string;
  scopeType?: "main" | "project";
  userIds: string[];
  serverIds?: string[];
  channelIds?: string[];
  enabled: boolean;
}): string =>
  JSON.stringify({
    enabled: input.enabled,
    token: input.token,
    projectId: input.projectId,
    scopeType: input.scopeType,
    userIds: [...input.userIds].sort(),
    serverIds: [...(input.serverIds ?? [])].sort(),
    channelIds: [...(input.channelIds ?? [])].sort(),
  });

const normalizeChatId = (value: number | string | undefined): string | null => {
  if (typeof value === "number" && Number.isFinite(value))
    return String(Math.trunc(value));
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  return null;
};

const fetchTelegramBotProfile = async (
  token: string,
): Promise<{ id: string; username: string }> => {
  return await fetchTelegramBotProfileImpl(token);
};

const fetchDiscordBotProfile = async (
  token: string,
): Promise<{ id: string }> => {
  return await fetchDiscordBotProfileImpl(token);
};

const toChannelChatType = (value: string | undefined): ChannelChatType =>
  value === "private" || value === "p2p" || value === "direct"
    ? "direct"
    : "group";

const trimDisplayName = (value: string | undefined): string => value?.trim() ?? "";

const pickDisplayNameDistinctFromId = (
  value: string | undefined,
  idValue: string,
): string => {
  const trimmed = trimDisplayName(value);
  return trimmed && trimmed !== idValue.trim() ? trimmed : "";
};

const resolveTelegramChatDisplayName = (
  chat: TelegramChat | undefined,
): string => {
  if (!chat) return "";
  const title = trimDisplayName(chat.title);
  if (title) return title;
  const username = trimDisplayName(chat.username);
  if (username) return username;
  return [trimDisplayName(chat.first_name), trimDisplayName(chat.last_name)]
    .filter((part) => part.length > 0)
    .join(" ");
};

const getChannelRuntimeKey = (input: {
  provider: SessionReplyContext["provider"];
  chatType: ChannelChatType;
  chatId: string;
  capabilityMode: ChatCapabilityMode;
}): string =>
  [
    input.provider,
    input.chatType,
    input.chatId.trim(),
    input.capabilityMode,
  ].join(":");

const getChannelBatchKey = (
  provider: SessionReplyContext["provider"],
  chatId: string,
): string => `${provider}:${chatId.trim()}`;

const getDigitalAvatarConversationId = (input: {
  chatType: ChannelChatType;
  chatId: string;
  senderId: string;
}): string =>
  input.chatType === "direct" ? input.senderId.trim() : input.chatId.trim();

const buildDigitalAvatarSessionMetadataJson = (input: {
  provider: SessionReplyContext["provider"];
  chatType: ChannelChatType;
  chatId: string;
  senderId: string;
}): string =>
  JSON.stringify({
    kind: "digital_avatar_session",
    provider: input.provider,
    chatType: input.chatType,
    conversationId: getDigitalAvatarConversationId(input),
  });

const resolveDigitalAvatarSessionTitle = (input: {
  chatType: ChannelChatType;
  chatId: string;
  senderId: string;
  senderName: string;
  chatName?: string;
}): string =>
  input.chatType === "direct"
    ? pickDisplayNameDistinctFromId(input.senderName, input.senderId)
    : pickDisplayNameDistinctFromId(input.chatName, input.chatId);

const shouldReplaceDigitalAvatarSessionTitle = (input: {
  currentTitle: string;
  nextTitle: string;
  chatType: ChannelChatType;
  chatId: string;
  senderId: string;
}): boolean => {
  const currentTitle = input.currentTitle.trim();
  const nextTitle = input.nextTitle.trim();
  if (!nextTitle || currentTitle === nextTitle) {
    return false;
  }
  if (!currentTitle) {
    return true;
  }
  return currentTitle === getDigitalAvatarConversationId(input);
};

const getOrCreateDigitalAvatarSessionForConversation = async (input: {
  provider: SessionReplyContext["provider"];
  chatType: ChannelChatType;
  chatId: string;
  senderId: string;
  senderName: string;
  chatName?: string;
}): Promise<string> => {
  const nextTitle = resolveDigitalAvatarSessionTitle(input);
  const session = await repositoryService.getOrCreateDigitalAvatarSession(
    MAIN_CHAT_SCOPE,
    {
      metadataJson: buildDigitalAvatarSessionMetadataJson(input),
      title: nextTitle,
    },
  );
  if (
    shouldReplaceDigitalAvatarSessionTitle({
      currentTitle: session.title,
      nextTitle,
      chatType: input.chatType,
      chatId: input.chatId,
      senderId: input.senderId,
    })
  ) {
    await repositoryService.updateChatSessionTitle({
      scope: MAIN_CHAT_SCOPE,
      sessionId: session.id,
      title: nextTitle,
    });
  }
  return session.id;
};

const buildChannelEventMetadataJson = (input: {
  provider: SessionReplyContext["provider"];
  chatType: ChannelChatType;
  senderId?: string;
  senderName?: string;
  isOwner: boolean;
  mentioned?: boolean;
  batchedCount?: number;
  capabilityMode: ChatCapabilityMode;
}): string =>
  JSON.stringify({
    kind: "channel_event",
    provider: input.provider,
    chatType: input.chatType,
    senderId: input.senderId,
    senderName: input.senderName,
    isOwner: input.isOwner,
    mentioned: input.mentioned,
    batchedCount: input.batchedCount,
    capabilityMode: input.capabilityMode,
  } satisfies ChatMessageMetadata);

const buildChannelBatchPrompt = (items: ChannelBatchItem[]): string => {
  const lines = [
    "For the newly received list of messages, please reply collectively in accordance with your identity settings.",
  ];
  for (const item of items) {
    lines.push(`[${item.senderName || item.senderId}] ${item.text || "（仅上传了附件）"}`);
  }
  return lines.join("\n");
};

const mirrorChannelInboundMessage = async (input: {
  sessionId: string;
  text: string;
  provider: SessionReplyContext["provider"];
  chatType: ChannelChatType;
  senderId: string;
  senderName: string;
  isOwner: boolean;
  mentioned?: boolean;
  capabilityMode: ChatCapabilityMode;
}): Promise<void> => {
  await repositoryService.appendMessage({
    scope: MAIN_CHAT_SCOPE,
    sessionId: input.sessionId,
    role: "user",
    content: input.text,
    metadataJson: buildChannelEventMetadataJson({
      provider: input.provider,
      chatType: input.chatType,
      senderId: input.senderId,
      senderName: input.senderName,
      isOwner: input.isOwner,
      mentioned: input.mentioned,
      capabilityMode: input.capabilityMode,
    }),
  });
};

const mirrorChannelAssistantMessage = async (input: {
  sessionId: string;
  text: string;
  provider: SessionReplyContext["provider"];
  chatType: ChannelChatType;
  capabilityMode: ChatCapabilityMode;
  batchedCount?: number;
}): Promise<void> => {
  await repositoryService.appendMessage({
    scope: MAIN_CHAT_SCOPE,
    sessionId: input.sessionId,
    role: "assistant",
    content: input.text,
    metadataJson: buildChannelEventMetadataJson({
      provider: input.provider,
      chatType: input.chatType,
      isOwner: false,
      capabilityMode: input.capabilityMode,
      batchedCount: input.batchedCount,
    }),
  });
};

const sendTelegramMessage = async (
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
): Promise<number | undefined> => {
  return await sendTelegramMessageImpl(token, chatId, text, replyToMessageId);
};

const editTelegramMessage = async (
  token: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<void> => {
  await editTelegramMessageImpl(token, chatId, messageId, text);
};

const sendTelegramTyping = async (
  token: string,
  chatId: string,
): Promise<void> => {
  await sendTelegramTypingImpl(token, chatId);
};

const sendTelegramDocument = async (
  token: string,
  chatId: string,
  filePath: string,
  replyToMessageId?: number,
): Promise<void> => {
  await sendTelegramDocumentImpl(token, chatId, filePath, replyToMessageId);
};

const loadTelegramInboundAttachments = async (input: {
  token: string;
  scope: ChatScope;
  chatId: string;
  message: TelegramMessage;
}): Promise<ChatAttachmentDTO[]> => {
  return await loadTelegramInboundAttachmentsImpl(input);
};

const sendDiscordBotMessage = async (
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: string,
): Promise<string | undefined> => {
  return await sendDiscordBotMessageImpl(token, chatId, text, replyToMessageId);
};

const editDiscordBotMessage = async (
  token: string,
  chatId: string,
  messageId: string,
  text: string,
): Promise<void> => {
  await editDiscordBotMessageImpl(token, chatId, messageId, text);
};

const sendDiscordBotDocument = async (
  token: string,
  chatId: string,
  filePath: string,
  replyToMessageId?: string,
): Promise<void> => {
  await sendDiscordBotDocumentImpl(token, chatId, filePath, replyToMessageId);
};

const setDiscordMessageReaction = async (
  token: string,
  chatId: string,
  messageId: string,
  emoji = DISCORD_REPLY_REACTION_EMOJI,
): Promise<void> => {
  await setDiscordMessageReactionImpl(token, chatId, messageId, emoji);
};

const setFeishuMessageReaction = async (
  token: string,
  messageId: string,
  emojiType = FEISHU_REPLY_REACTION_EMOJI_TYPE,
): Promise<void> => {
  await setFeishuMessageReactionImpl(token, messageId, emojiType);
};

const fetchDiscordMessages = async (input: {
  token: string;
  chatId: string;
  afterMessageId?: string;
}): Promise<DiscordMessage[]> => {
  return await fetchDiscordMessagesImpl(input);
};

const loadDiscordInboundAttachments = async (input: {
  token: string;
  scope: ChatScope;
  chatId: string;
  message: DiscordMessage;
}): Promise<ChatAttachmentDTO[]> => {
  return await loadDiscordInboundAttachmentsImpl(input);
};

const fetchDiscordChannelDisplayName = async (
  token: string,
  channelId: string,
): Promise<string> => {
  return await fetchDiscordChannelDisplayNameImpl({
    token,
    channelId,
    cache: discordChannelDisplayNameByChannel,
  });
};

const resolveDiscordChannelGuildId = async (
  token: string,
  channelId: string,
): Promise<string | null> => {
  return await resolveDiscordChannelGuildIdImpl({
    token,
    channelId,
    cache: discordGuildIdByChannel,
  });
};

const parseFeishuBotToken = (
  token: string,
): { appId: string; appSecret: string } | null => {
  return parseFeishuBotTokenImpl(token);
};

const resolveFeishuAccessToken = async (token: string): Promise<string> => {
  return await resolveFeishuAccessTokenImpl(token);
};

const sendFeishuBotMessage = async (
  token: string,
  receiveId: string,
  text: string,
  receiveIdType: "chat_id" | "user_id" = "chat_id",
  replyToMessageId?: string,
): Promise<string | undefined> => {
  return await sendFeishuBotMessageImpl(
    token,
    receiveId,
    text,
    receiveIdType,
    replyToMessageId,
  );
};

const sendFeishuBotCard = async (input: {
  token: string;
  receiveId: string;
  card: Record<string, unknown>;
  receiveIdType?: "chat_id" | "user_id";
  replyToMessageId?: string;
}): Promise<string | undefined> => {
  return await sendFeishuBotCardImpl(input);
};

const updateFeishuBotCard = async (
  token: string,
  messageId: string,
  card: Record<string, unknown>,
): Promise<void> => {
  await updateFeishuBotCardImpl(token, messageId, card);
};

const createFeishuStreamingCard = async (
  token: string,
  initialContent?: string,
): Promise<string> => {
  return await createFeishuStreamingCardImpl(token, initialContent);
};

const sendFeishuBotCardByCardId = async (input: {
  token: string;
  receiveId: string;
  cardId: string;
  receiveIdType?: "chat_id" | "user_id";
  replyToMessageId?: string;
}): Promise<string | undefined> => {
  return await sendFeishuBotCardByCardIdImpl(input);
};

const updateFeishuStreamingCardText = async (
  token: string,
  cardId: string,
  content: string,
  sequence: number,
): Promise<void> => {
  await updateFeishuStreamingCardTextImpl(token, cardId, content, sequence);
};

const stopFeishuCardStreaming = async (
  token: string,
  cardId: string,
  sequence: number,
): Promise<void> => {
  await stopFeishuCardStreamingImpl(token, cardId, sequence);
};

const sendFeishuBotDocument = async (
  token: string,
  receiveId: string,
  filePath: string,
  receiveIdType: "chat_id" | "user_id" = "chat_id",
  replyToMessageId?: string,
): Promise<void> => {
  await sendFeishuBotDocumentImpl(
    token,
    receiveId,
    filePath,
    receiveIdType,
    replyToMessageId,
  );
};

const fetchFeishuMessages = async (input: {
  token: string;
  chatId: string;
  startTimeMs?: number;
}): Promise<FeishuMessageItem[]> => {
  return await fetchFeishuMessagesImpl(input);
};

const fetchFeishuChatIds = async (token: string): Promise<string[]> => {
  return await fetchFeishuChatIdsImpl(token);
};

const fetchFeishuChatDisplayName = async (
  token: string,
  chatId: string,
): Promise<string> => {
  return await fetchFeishuChatDisplayNameImpl({
    token,
    chatId,
    cache: feishuChatDisplayNameByChat,
  });
};

const fetchFeishuUserDisplayName = async (input: {
  token: string;
  userId: string;
  chatId?: string;
  userIdType?: FeishuUserIdType;
}): Promise<string> => {
  return await fetchFeishuUserDisplayNameImpl({
    ...input,
    cache: feishuUserDisplayNameByUser,
  });
};

const syncFeishuActiveChats = async (
  state: BotRuntime,
  options?: { force?: boolean },
): Promise<void> => {
  const force = options?.force === true;
  const now = Date.now();
  if (
    !force &&
    state.activeChatIds.size > 0 &&
    now - feishuLastChatSyncAt < FEISHU_CHAT_DISCOVERY_INTERVAL_MS
  ) {
    return;
  }

  let discoveredChatIds: string[];
  try {
    discoveredChatIds = await fetchFeishuChatIds(state.token);
  } catch (error) {
    logger.warn("Failed to sync Feishu active chats", {
      projectId: state.projectId,
      error,
    });
    return;
  }

  feishuLastChatSyncAt = now;
  const nextSet = new Set(discoveredChatIds);

  for (const existingChatId of state.activeChatIds) {
    if (nextSet.has(existingChatId)) continue;
    feishuLastMessageTsByChat.delete(existingChatId);
  }

  state.activeChatIds = nextSet;
};

const setTelegramMessageReaction = async (
  token: string,
  chatId: string,
  messageId: number,
  emoji = TELEGRAM_REPLY_REACTION_EMOJI,
): Promise<void> => {
  await setTelegramMessageReactionImpl(token, chatId, messageId, emoji);
};

const extractTelegramFileAttachments = (
  content: string,
  scope: ChatScope,
  options?: {
    includeRemoteImages?: boolean;
  },
): string[] => {
  return extractTelegramFileAttachmentsImpl(content, scope, options);
};

const stripTelegramFileMarkdown = (content: string): string => {
  return stripTelegramFileMarkdownImpl(content);
};

const buildTelegramToolCallsFromStreamEvents = (
  streamEvents: ChatStreamEvent[],
  toolActions: string[] = [],
): TelegramToolCallSummary[] => {
  return buildTelegramToolCallsFromStreamEventsImpl(streamEvents, toolActions);
};

const normalizeTelegramToolCalls = (
  toolCalls: TelegramToolCallSummary[] | undefined,
): TelegramToolCallSummary[] => {
  return normalizeTelegramToolCallsImpl(toolCalls);
};

const formatTelegramToolCallMessage = (
  toolCall: TelegramToolCallSummary,
): string => {
  return formatTelegramToolCallMessageImpl(toolCall);
};

const formatTelegramAssistantBody = (input: {
  message: string;
  hasAttachments: boolean;
  isError: boolean;
  toolCalls?: TelegramToolCallSummary[];
}): string => {
  return formatTelegramAssistantBodyImpl(input);
};

const buildTelegramAssistantTimelineFromStreamEvents = (input: {
  streamEvents: ChatStreamEvent[];
  fallbackAssistantMessage: string;
  toolActions?: string[];
}): TelegramAssistantTimelineBlock[] => {
  return buildTelegramAssistantTimelineFromStreamEventsImpl(input);
};

const createTelegramAssistantProgressiveStreamer = (input: {
  sendToolRunningMessage?: (tool: TelegramToolCallSummary) => Promise<void>;
  sendToolDoneMessage?: (tool: TelegramToolCallSummary) => Promise<void>;
  sendAssistantMessage: (message: string, isError: boolean) => Promise<void>;
}): TelegramAssistantProgressiveStreamer => {
  return createTelegramAssistantProgressiveStreamerImpl(input);
};

const rememberSessionReplyContext = (input: {
  scope: ChatScope;
  sessionId: string;
  provider: SessionReplyContext["provider"];
  chatId: string;
  accountId?: string;
}): void => {
  sessionReplyContextByKey.set(
    getSessionReplyContextKey(input.scope, input.sessionId),
    {
      provider: input.provider,
      chatId: input.chatId,
      accountId: input.accountId,
    },
  );
};

const resolveMainAgentLatestSessionId = async (input: {
  provider: SessionReplyContext["provider"];
  chatId: string;
  accountId?: string;
}): Promise<string> => {
  const existingPromise = mainAgentSessionPromise;
  const sessionPromise =
    existingPromise ??
    (async () => {
      const sessions = await repositoryService.listChatSessions(MAIN_CHAT_SCOPE);
      const latestSession = sessions[0];
      if (latestSession) {
        return latestSession.id;
      }

      const session = await repositoryService.createChatSession({
        scope: MAIN_CHAT_SCOPE,
        module: "main",
        title: "",
      });
      return session.id;
    })();

  if (!existingPromise) {
    mainAgentSessionPromise = sessionPromise;
  }

  try {
    const sessionId = await sessionPromise;
    rememberSessionReplyContext({
      scope: MAIN_CHAT_SCOPE,
      sessionId,
      provider: input.provider,
      chatId: input.chatId,
      accountId: input.accountId,
    });
    return sessionId;
  } finally {
    if (mainAgentSessionPromise === sessionPromise) {
      mainAgentSessionPromise = null;
    }
  }
};

const resolveChannelSessions = async (input: {
  provider: SessionReplyContext["provider"];
  chatId: string;
  chatType: ChannelChatType;
  capabilityMode: ChatCapabilityMode;
  accountId?: string;
}): Promise<{
  runtimeSessionId: string;
}> => {
  const metadataJson = JSON.stringify({
    provider: input.provider,
    chatId: input.chatId,
    chatType: input.chatType,
    capabilityMode: input.capabilityMode,
    runtimeKey: getChannelRuntimeKey({
      provider: input.provider,
      chatType: input.chatType,
      chatId: input.chatId,
      capabilityMode: input.capabilityMode,
    }),
  });
  const runtimeSession = await repositoryService.getOrCreateChannelRuntimeSession({
    scope: MAIN_CHAT_SCOPE,
    module: "main",
    metadataJson,
  });
  rememberSessionReplyContext({
    scope: MAIN_CHAT_SCOPE,
    sessionId: runtimeSession.id,
    provider: input.provider,
    chatId: input.chatId,
    accountId: input.accountId,
  });
  return {
    runtimeSessionId: runtimeSession.id,
  };
};

const clearChannelBatchTimer = (state: ChannelBatchState): void => {
  if (!state.flushTimer) return;
  clearTimeout(state.flushTimer);
  state.flushTimer = null;
};

const flushChannelBatchState = async (batchKey: string): Promise<void> => {
  const state = channelBatchStateByKey.get(batchKey);
  if (!state || state.items.length === 0) {
    return;
  }
  clearChannelBatchTimer(state);
  const items = state.items.splice(0, state.items.length);
  channelBatchStateByKey.delete(batchKey);
  const batchedCount = items.length;
  const prompt = buildChannelBatchPrompt(items);
  logger.info("Channel batch flush started", {
    batchKey,
    provider: state.provider,
    chatId: state.chatId,
    batchedCount,
    runtimeSessionId: state.runtimeSessionId,
  });
  try {
    const progressiveStreamer = createDirectChannelReplyStreamer({
      provider: state.provider,
      projectId: MAIN_AGENT_SCOPE_ID,
      chatId: state.chatId,
      sendText: state.replyText,
      sendLiveMessage: state.sendLiveMessage,
      updateLiveMessage: state.updateLiveMessage,
      onStreamingDone: state.onStreamingDone,
      sendDocument: state.replyDocument,
      sendAttachmentsFirst: state.sendAttachmentsFirst,
    });
    const requestId = randomUUID();
    let result: { assistantMessage: string; toolActions?: string[] };
    try {
      result = await chatService.send(
        {
          scope: state.runtimeScope,
          module: "main",
          sessionId: state.runtimeSessionId,
          requestId,
          message: prompt,
          capabilityMode: "chat_only",
        },
        (streamEvent) => {
          progressiveStreamer.pushEvent(streamEvent);
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await progressiveStreamer.finalize({
        fallbackAssistantMessage: `处理失败：${errorMessage}`,
        isError: true,
      });
      throw error;
    }
    await progressiveStreamer.finalize({
      fallbackAssistantMessage: result.assistantMessage,
      toolActions: result.toolActions,
    });
    await mirrorChannelAssistantMessage({
      sessionId: state.digitalAvatarSessionId,
      text: result.assistantMessage,
      provider: state.provider,
      chatType: "group",
      capabilityMode: "chat_only",
      batchedCount,
    });
    logger.info("Channel batch flush completed", {
      batchKey,
      provider: state.provider,
      chatId: state.chatId,
      batchedCount,
      assistantMessageLength: result.assistantMessage.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Channel batch flush failed", {
      batchKey,
      error: errorMessage,
    });
    await state.replyText(`处理失败：${errorMessage}`);
    await mirrorChannelAssistantMessage({
      sessionId: state.digitalAvatarSessionId,
      text: `处理失败：${errorMessage}`,
      provider: state.provider,
      chatType: "group",
      capabilityMode: "chat_only",
      batchedCount,
    });
  }
};

const scheduleChannelBatchFlush = (batchKey: string, state: ChannelBatchState): void => {
  if (state.flushTimer) {
    return;
  }
  state.flushTimer = setTimeout(() => {
    void flushChannelBatchState(batchKey);
  }, DIGITAL_AVATAR_IDLE_FLUSH_MS);
};

const sendChannelRuntimeTurn = async (input: {
  provider: SessionReplyContext["provider"];
  runtimeSessionId: string;
  chatId: string;
  text: string;
  attachments?: ChatAttachmentDTO[];
  capabilityMode: ChatCapabilityMode;
  replyText: (text: string) => Promise<void>;
  sendLiveMessage?: (text: string) => Promise<string | number | undefined>;
  updateLiveMessage?: (
    messageId: string | number,
    text: string,
  ) => Promise<void>;
  onStreamingDone?: () => Promise<void>;
  replyDocument?: (filePath: string) => Promise<void>;
  sendAttachmentsFirst?: boolean;
  digitalAvatarSessionId?: string;
  chatType: ChannelChatType;
  batchedCount?: number;
}): Promise<void> => {
  logger.info("Channel runtime turn started", {
    provider: input.provider,
    chatId: input.chatId,
    sessionId: input.runtimeSessionId,
    chatType: input.chatType,
    capabilityMode: input.capabilityMode,
    attachmentCount: input.attachments?.length ?? 0,
    textLength: input.text.trim().length,
    mirroredToDigitalAvatar: Boolean(input.digitalAvatarSessionId),
  });
  const progressiveStreamer = createDirectChannelReplyStreamer({
    provider: input.provider,
    projectId: MAIN_AGENT_SCOPE_ID,
    chatId: input.chatId,
    sendText: input.replyText,
    sendLiveMessage: input.sendLiveMessage,
    updateLiveMessage: input.updateLiveMessage,
    onStreamingDone: input.onStreamingDone,
    sendDocument: input.replyDocument,
    sendAttachmentsFirst: input.sendAttachmentsFirst,
  });
  const requestId = randomUUID();
  let result: { assistantMessage: string; toolActions?: string[] };
  try {
    result = await chatService.send(
      {
        scope: MAIN_CHAT_SCOPE,
        module: "main",
        sessionId: input.runtimeSessionId,
        requestId,
        message: input.text,
        attachments: input.attachments?.length ? input.attachments : undefined,
        capabilityMode: input.capabilityMode,
      },
      (streamEvent) => {
        progressiveStreamer.pushEvent(streamEvent);
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await progressiveStreamer.finalize({
      fallbackAssistantMessage: `处理失败：${errorMessage}`,
      isError: true,
    });
    throw error;
  }
  await progressiveStreamer.finalize({
    fallbackAssistantMessage: result.assistantMessage,
    toolActions: result.toolActions,
  });
  if (input.digitalAvatarSessionId) {
    await mirrorChannelAssistantMessage({
      sessionId: input.digitalAvatarSessionId,
      text: result.assistantMessage,
      provider: input.provider,
      chatType: input.chatType,
      capabilityMode: input.capabilityMode,
      batchedCount: input.batchedCount,
    });
  }
  logger.info("Channel runtime turn completed", {
    provider: input.provider,
    chatId: input.chatId,
    sessionId: input.runtimeSessionId,
    assistantMessageLength: result.assistantMessage.length,
    mirroredToDigitalAvatar: Boolean(input.digitalAvatarSessionId),
  });
};

const createDirectChannelReplyStreamer = (input: {
  provider: SessionReplyContext["provider"];
  projectId: string;
  chatId: string;
  sendText: (text: string) => Promise<void>;
  sendLiveMessage?: (text: string) => Promise<string | number | undefined>;
  updateLiveMessage?: (
    messageId: string | number,
    text: string,
  ) => Promise<void>;
  onStreamingDone?: () => Promise<void>;
  sendDocument?: (filePath: string) => Promise<void>;
  sendAttachmentsFirst?: boolean;
}): TelegramAssistantProgressiveStreamer => {
  const sendAttachmentsFirst = input.sendAttachmentsFirst ?? false;

  if (input.sendLiveMessage && input.updateLiveMessage) {
    return createEditableChannelReplyStreamer({
      projectId: input.projectId,
      sendLiveMessage: input.sendLiveMessage,
      updateLiveMessage: input.updateLiveMessage,
      sendText: input.sendText,
      sendDocument: input.sendDocument,
      sendAttachmentsFirst,
      onStreamingDone: input.onStreamingDone,
      liveMessageMaxLength:
        input.provider === "discord"
          ? 1_900
          : input.provider === "telegram"
            ? 3_500
            : 20_000,
    });
  }

  return createTelegramAssistantProgressiveStreamer({
    sendToolRunningMessage: undefined,
    sendToolDoneMessage: undefined,
    sendAssistantMessage: async (message, isError) => {
      const fileAttachments = extractTelegramFileAttachments(
        message,
        toChatScopeFromProjectId(input.projectId),
        {
          includeRemoteImages: input.provider === "weixin",
        },
      );
      const assistantText = stripTelegramFileMarkdown(message);
      const messageText = formatTelegramAssistantBody({
        message: assistantText,
        hasAttachments: fileAttachments.length > 0,
        isError,
      });
      if (messageText || fileAttachments.length === 0) {
        if (!sendAttachmentsFirst) {
          await input.sendText(messageText || "已生成附件，请查收。");
        }
      }

      if (fileAttachments.length === 0) {
        if (sendAttachmentsFirst && messageText) {
          await input.sendText(messageText);
        }
        return;
      }

      if (!input.sendDocument) {
        await input.sendText(
          ["附件路径:", ...fileAttachments.map((item) => `- ${item}`)].join(
            "\n",
          ),
        );
        if (sendAttachmentsFirst && messageText) {
          await input.sendText(messageText);
        }
        return;
      }

      let sentAttachmentCount = 0;
      for (const attachmentPath of fileAttachments) {
        try {
          await input.sendDocument(attachmentPath);
          sentAttachmentCount += 1;
        } catch (error) {
          logger.warn("Failed to send direct channel attachment", {
            provider: input.provider,
            chatId: input.chatId,
            attachmentPath,
            error,
          });
        }
      }

      if (
        !assistantText &&
        fileAttachments.length > 0 &&
        sentAttachmentCount === 0
      ) {
        await input.sendText("附件发送失败，请检查文件路径或权限。");
        return;
      }

      if (sendAttachmentsFirst && messageText) {
        await input.sendText(messageText);
      }
    },
  });
};

const createTypingIndicator = (token: string, chatId: string): (() => void) => {
  let stopped = false;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await sendTelegramTyping(token, chatId);
    } catch (error) {
      logger.warn("Failed to send telegram typing action", { chatId, error });
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, TELEGRAM_TYPING_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
};

const getOutboundChatIds = (state: TelegramRuntime): string[] => {
  return Array.from(state.ownerUserIds)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const buildAgentMirrorHeader = (
  input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
  },
  from: string,
): string => `🧳 项目: ${input.projectId}\n${from}的消息\n----------\n`;

const formatAgentUserMirrorMessage = (input: {
  projectId: string;
  module: ChatModuleType;
  sessionId: string;
  message: string;
  attachments?: ChatAttachmentDTO[];
}): string => {
  const lines: string[] = [buildAgentMirrorHeader(input, `🧒 来自用户`)];
  const message = input.message.trim() || "（仅上传了附件）";
  lines.push(message);
  const attachmentNames = (input.attachments ?? [])
    .map((item) => item.name.trim())
    .filter((item) => item.length > 0);
  if (attachmentNames.length > 0) {
    lines.push("附件:");
    lines.push(...attachmentNames.map((name) => `- ${name}`));
  }
  return lines.join("\n");
};

const formatAgentAssistantMirrorMessage = (input: {
  projectId: string;
  module: ChatModuleType;
  sessionId: string;
  message: string;
  hasAttachments: boolean;
  isError: boolean;
  toolCalls?: TelegramToolCallSummary[];
}): string => {
  const lines: string[] = [buildAgentMirrorHeader(input, `🤖 来自助手`)];
  lines.push(formatTelegramAssistantBody(input));
  return lines.join("\n");
};

const formatAgentAssistantToolMirrorMessage = (
  input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
  },
  toolCall: TelegramToolCallSummary,
): string => {
  const lines: string[] = [buildAgentMirrorHeader(input, `🤖 来自助手`)];
  lines.push(formatTelegramToolCallMessage(toolCall));
  return lines.join("\n");
};

const resolveMirrorToolCalls = (input: {
  streamEvents?: ChatStreamEvent[];
  toolActions?: string[];
  toolCalls?: TelegramToolCallSummary[];
}): TelegramToolCallSummary[] => {
  const streamEvents = input.streamEvents ?? [];
  if (streamEvents.length > 0) {
    return buildTelegramToolCallsFromStreamEvents(
      streamEvents,
      input.toolActions,
    );
  }
  if (input.toolCalls && input.toolCalls.length > 0) {
    return normalizeTelegramToolCalls(input.toolCalls);
  }
  return buildTelegramToolCallsFromStreamEvents([], input.toolActions ?? []);
};

const buildAssistantMirrorPayload = (input: {
  projectId: string;
  module: ChatModuleType;
  sessionId: string;
  message: string;
  isError: boolean;
  streamEvents?: ChatStreamEvent[];
  toolActions?: string[];
  toolCalls?: TelegramToolCallSummary[];
}): {
  messageText: string;
  assistantText: string;
  attachments: string[];
} => {
  const attachments = extractTelegramFileAttachments(
    input.message,
    toChatScopeFromProjectId(input.projectId),
  );
  const assistantText = stripTelegramFileMarkdown(input.message);
  const toolCalls = resolveMirrorToolCalls(input);
  const messageText = formatAgentAssistantMirrorMessage({
    ...input,
    message: assistantText,
    hasAttachments: attachments.length > 0,
    toolCalls,
  });
  return {
    messageText,
    assistantText,
    attachments,
  };
};

const broadcastDiscordMessage = async (
  state: DiscordRuntime,
  text: string,
): Promise<void> => {
  const payload = text.trim();
  if (!payload) return;
  const chatIds = Array.from(state.activeChatIds);
  for (const chatId of chatIds) {
    await sendDiscordBotMessage(state.token, chatId, payload);
  }
};

const broadcastDiscordAssistantMessage = async (
  state: DiscordRuntime,
  input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
    message: string;
    isError: boolean;
    streamEvents?: ChatStreamEvent[];
    toolActions?: string[];
    toolCalls?: TelegramToolCallSummary[];
  },
): Promise<void> => {
  const payload = buildAssistantMirrorPayload(input);
  const chatIds = Array.from(state.activeChatIds);
  for (const chatId of chatIds) {
    if (payload.messageText || payload.attachments.length === 0) {
      await sendDiscordBotMessage(state.token, chatId, payload.messageText);
    }
    let sentAttachmentCount = 0;
    for (const attachmentPath of payload.attachments) {
      try {
        await sendDiscordBotDocument(state.token, chatId, attachmentPath);
        sentAttachmentCount += 1;
      } catch (error) {
        logger.warn("Failed to mirror Discord attachment", {
          chatId,
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
      const attachmentErrorMessage = formatAgentAssistantMirrorMessage({
        ...input,
        message: "附件发送失败，请检查文件路径或权限。",
        hasAttachments: false,
        toolCalls: undefined,
        isError: false,
      });
      await sendDiscordBotMessage(state.token, chatId, attachmentErrorMessage);
    }
  }
};

const broadcastFeishuMessage = async (
  state: BotRuntime,
  text: string,
): Promise<void> => {
  const payload = text.trim();
  if (!payload) return;
  await syncFeishuActiveChats(state);
  const chatIds = Array.from(state.activeChatIds);
  for (const chatId of chatIds) {
    await sendFeishuBotMessage(state.token, chatId, payload, "chat_id");
  }
};

const broadcastFeishuAssistantMessage = async (
  state: BotRuntime,
  input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
    message: string;
    isError: boolean;
    streamEvents?: ChatStreamEvent[];
    toolActions?: string[];
    toolCalls?: TelegramToolCallSummary[];
  },
): Promise<void> => {
  const payload = buildAssistantMirrorPayload(input);
  await syncFeishuActiveChats(state);
  const chatIds = Array.from(state.activeChatIds);
  for (const chatId of chatIds) {
    let sentAttachmentCount = 0;
    for (const attachmentPath of payload.attachments) {
      try {
        await sendFeishuBotDocument(state.token, chatId, attachmentPath, "chat_id");
        sentAttachmentCount += 1;
      } catch (error) {
        logger.warn("Failed to mirror Feishu attachment", {
          chatId,
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
      const attachmentErrorMessage = formatAgentAssistantMirrorMessage({
        ...input,
        message: "附件发送失败，请检查文件路径或权限。",
        hasAttachments: false,
        toolCalls: undefined,
        isError: false,
      });
      await sendFeishuBotMessage(state.token, chatId, attachmentErrorMessage, "chat_id");
      continue;
    }
    if (payload.messageText || payload.attachments.length === 0) {
      await sendFeishuBotMessage(state.token, chatId, payload.messageText, "chat_id");
    }
  }
};

const broadcastTelegramAssistantToolMessage = async (
  state: TelegramRuntime,
  input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
  },
  toolCall: TelegramToolCallSummary,
): Promise<void> => {
  const chatIds = getOutboundChatIds(state);
  if (chatIds.length === 0) return;
  const messageText = formatAgentAssistantToolMirrorMessage(input, toolCall);
  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(state.token, chatId, messageText);
    } catch (error) {
      logger.warn("Failed to mirror assistant tool message to telegram chat", {
        chatId,
        error,
      });
    }
  }
};

const broadcastTelegramAssistantBlockMessage = async (
  state: TelegramRuntime,
  input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
    message: string;
    isError: boolean;
  },
): Promise<void> => {
  const chatIds = getOutboundChatIds(state);
  if (chatIds.length === 0) return;

  const attachments = extractTelegramFileAttachments(
    input.message,
    toChatScopeFromProjectId(input.projectId),
  );
  const assistantText = stripTelegramFileMarkdown(input.message);
  const messageText = formatAgentAssistantMirrorMessage({
    ...input,
    message: assistantText,
    hasAttachments: attachments.length > 0,
    toolCalls: undefined,
  });

  for (const chatId of chatIds) {
    try {
      if (messageText || attachments.length === 0) {
        await sendTelegramMessage(state.token, chatId, messageText);
      }
      let sentAttachmentCount = 0;
      for (const attachmentPath of attachments) {
        try {
          await sendTelegramDocument(state.token, chatId, attachmentPath);
          sentAttachmentCount += 1;
        } catch (error) {
          logger.warn("Failed to mirror telegram attachment", {
            chatId,
            attachmentPath,
            error,
          });
        }
      }
      if (
        !assistantText &&
        attachments.length > 0 &&
        sentAttachmentCount === 0
      ) {
        const attachmentErrorMessage = formatAgentAssistantMirrorMessage({
          ...input,
          message: "附件发送失败，请检查文件路径或权限。",
          hasAttachments: false,
          isError: false,
          toolCalls: undefined,
        });
        await sendTelegramMessage(state.token, chatId, attachmentErrorMessage);
      }
    } catch (error) {
      logger.warn("Failed to mirror assistant block message to telegram chat", {
        chatId,
        error,
      });
    }
  }
};

const broadcastTelegramMessage = async (
  state: TelegramRuntime,
  text: string,
): Promise<void> => {
  const payload = text.trim();
  if (!payload) return;
  const chatIds = getOutboundChatIds(state);
  if (chatIds.length === 0) return;

  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(state.token, chatId, payload);
    } catch (error) {
      logger.warn("Failed to mirror message to telegram chat", {
        chatId,
        error,
      });
    }
  }
};

const broadcastTelegramAssistantMessage = async (
  state: TelegramRuntime,
  input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
    message: string;
    isError: boolean;
    streamEvents?: ChatStreamEvent[];
    toolActions?: string[];
    toolCalls?: TelegramToolCallSummary[];
  },
): Promise<void> => {
  const chatIds = getOutboundChatIds(state);
  if (chatIds.length === 0) return;

  const streamEvents = input.streamEvents ?? [];
  const normalizedToolCalls = normalizeTelegramToolCalls(input.toolCalls);
  const timelineBlocks =
    streamEvents.length > 0
      ? buildTelegramAssistantTimelineFromStreamEvents({
          streamEvents,
          fallbackAssistantMessage: input.message,
          toolActions: input.toolActions,
        })
      : [
          ...normalizedToolCalls.map(
            (tool): TelegramAssistantTimelineBlock => ({
              type: "tool",
              tool,
            }),
          ),
          {
            type: "assistant" as const,
            message: input.message,
          },
        ];
  if (timelineBlocks.length === 0) {
    timelineBlocks.push({
      type: "assistant",
      message: input.message,
    });
  }
  const hasMultipleTimelineBlocks = timelineBlocks.length > 1;

  for (const chatId of chatIds) {
    try {
      for (const block of timelineBlocks) {
        if (block.type === "tool") {
          const toolMessage = formatAgentAssistantToolMirrorMessage(
            input,
            block.tool,
          );
          await sendTelegramMessage(state.token, chatId, toolMessage);
          continue;
        }

        const attachments = extractTelegramFileAttachments(
          block.message,
          toChatScopeFromProjectId(input.projectId),
        );
        const assistantText = stripTelegramFileMarkdown(block.message);
        const messageText = formatAgentAssistantMirrorMessage({
          ...input,
          message: assistantText,
          hasAttachments: attachments.length > 0,
          isError: !hasMultipleTimelineBlocks && Boolean(input.isError),
          toolCalls: undefined,
        });
        if (messageText || attachments.length === 0) {
          await sendTelegramMessage(state.token, chatId, messageText);
        }
        let sentAttachmentCount = 0;
        for (const attachmentPath of attachments) {
          try {
            await sendTelegramDocument(state.token, chatId, attachmentPath);
            sentAttachmentCount += 1;
          } catch (error) {
            logger.warn("Failed to mirror telegram attachment", {
              chatId,
              attachmentPath,
              error,
            });
          }
        }
        if (
          !assistantText &&
          attachments.length > 0 &&
          sentAttachmentCount === 0
        ) {
          const attachmentErrorMessage = formatAgentAssistantMirrorMessage({
            ...input,
            message: "附件发送失败，请检查文件路径或权限。",
            hasAttachments: false,
            isError: false,
          });
          await sendTelegramMessage(
            state.token,
            chatId,
            attachmentErrorMessage,
          );
        }
      }
    } catch (error) {
      logger.warn("Failed to mirror assistant message to telegram chat", {
        chatId,
        error,
      });
    }
  }
};

const fetchTelegramUpdates = async (
  token: string,
  offset: number,
  timeoutSeconds: number,
  limit = 20,
): Promise<TelegramUpdate[]> => {
  const controller = new AbortController();
  pollAbortController = controller;

  const hardTimeout = setTimeout(
    () => {
      controller.abort();
    },
    Math.max(5_000, (timeoutSeconds + 10) * 1_000),
  );

  try {
    return await fetchTelegramUpdatesImpl({
      token,
      offset,
      timeoutSeconds,
      limit,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(hardTimeout);
    if (pollAbortController === controller) {
      pollAbortController = null;
    }
  }
};

const schedulePoll = (delayMs: number): void => {
  if (!running) return;
  stopTelegramPolling();
  pollTimer = setTimeout(
    () => {
      void pollTelegram();
    },
    Math.max(0, delayMs),
  );
};

const extractTelegramEntityText = (
  source: string,
  entity: { offset?: number; length?: number },
): string => {
  if (!source) return "";
  const offset = Number(entity.offset ?? -1);
  const length = Number(entity.length ?? -1);
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length <= 0) {
    return "";
  }
  return source.slice(offset, offset + length).trim();
};

const isTelegramBotMentioned = (
  message: TelegramMessage,
  state: TelegramRuntime,
): boolean => {
  const candidates: Array<{
    text: string;
    entities?: TelegramMessage["entities"];
  }> = [
    {
      text: typeof message.text === "string" ? message.text : "",
      entities: message.entities,
    },
    {
      text: typeof message.caption === "string" ? message.caption : "",
      entities: message.caption_entities,
    },
  ];
  for (const candidate of candidates) {
    for (const entity of candidate.entities ?? []) {
      if (entity.type === "text_mention") {
        const entityUserId = normalizeChatId(entity.user?.id);
        if (entityUserId && entityUserId === state.botUserId) {
          return true;
        }
      }
      if (entity.type === "mention") {
        const entityText = extractTelegramEntityText(candidate.text, entity);
        if (
          entityText &&
          state.botUsername &&
          entityText.toLowerCase() === `@${state.botUsername.toLowerCase()}`
        ) {
          return true;
        }
      }
    }
  }
  return false;
};

const processTelegramUpdate = async (
  update: TelegramUpdate,
  state: TelegramRuntime,
): Promise<void> => {
  const message = update.message;
  if (!message) return;
  if (message.from?.is_bot) return;

  const chatId = normalizeChatId(message.chat?.id);
  if (!chatId) return;
  const replyToMessageId = message.message_id;
  let reactedToUserMessage = false;

  const ensureReaction = async (): Promise<void> => {
    if (reactedToUserMessage || typeof replyToMessageId !== "number") return;
    reactedToUserMessage = true;
    try {
      await setTelegramMessageReaction(state.token, chatId, replyToMessageId);
    } catch (error) {
      logger.warn("Failed to set telegram message reaction", {
        chatId,
        messageId: replyToMessageId,
        error,
      });
    }
  };

  const replyText = async (text: string): Promise<void> => {
    await ensureReaction();
    await sendTelegramMessage(state.token, chatId, text, replyToMessageId);
  };

  const sendLiveMessage = async (
    text: string,
  ): Promise<string | number | undefined> => {
    await ensureReaction();
    return await sendTelegramMessage(state.token, chatId, text, replyToMessageId);
  };

  const updateLiveMessage = async (
    messageId: string | number,
    text: string,
  ): Promise<void> => {
    if (typeof messageId !== "number") return;
    await editTelegramMessage(state.token, chatId, messageId, text);
  };

  const replyDocument = async (filePath: string): Promise<void> => {
    await ensureReaction();
    await sendTelegramDocument(state.token, chatId, filePath, replyToMessageId);
  };

  const fromUserId = normalizeChatId(message.from?.id);
  if (!fromUserId) return;
  const chatType = toChannelChatType(message.chat?.type);
  const isOwner = state.ownerUserIds.has(fromUserId);
  const capabilityMode: ChatCapabilityMode = isOwner ? "full" : "chat_only";
  const mentioned = chatType === "direct" ? true : isTelegramBotMentioned(message, state);
  const chatName = resolveTelegramChatDisplayName(message.chat);
  const senderName =
    message.from?.first_name?.trim() ||
    message.from?.username?.trim() ||
    fromUserId;
  chatChannelOwnerDiscoveryService.record({
    provider: "telegram",
    userId: fromUserId,
    displayName: senderName,
  });

  const attachments = await loadTelegramInboundAttachments({
    token: state.token,
    scope: MAIN_CHAT_SCOPE,
    chatId,
    message,
  });
  const text =
    typeof message.text === "string"
      ? message.text.trim()
      : typeof message.caption === "string"
        ? message.caption.trim()
        : "";

  logger.info("Telegram inbound message received", {
    chatId,
    fromUserId,
    senderName,
    chatType,
    isOwner,
    mentioned,
    capabilityMode,
    textLength: text.length,
    attachmentCount: attachments.length,
  });

  if (!text && attachments.length === 0) {
    await replyText(CHANNEL_SUPPORTED_INPUT_MESSAGE);
    return;
  }

  let digitalAvatarSessionId: string | undefined;
  if (!isOwner) {
    digitalAvatarSessionId = await getOrCreateDigitalAvatarSessionForConversation({
      provider: "telegram",
      chatType,
      chatId,
      senderId: fromUserId,
      senderName,
      chatName,
    });
    await mirrorChannelInboundMessage({
      sessionId: digitalAvatarSessionId,
      text: text || "（仅上传了附件）",
      provider: "telegram",
      chatType,
      senderId: fromUserId,
      senderName,
      isOwner: false,
      mentioned,
      capabilityMode,
    });
  }

  if ((text === "/start" || text === "/help") && attachments.length === 0) {
    await replyText(CHANNEL_HELP_MESSAGE);
    return;
  }

  try {
    const stopTyping = createTypingIndicator(state.token, chatId);
    try {
      if (isOwner) {
        const mainSessionId = await resolveMainAgentLatestSessionId({
          provider: "telegram",
          chatId,
        });
        logger.info("Telegram owner message routed to main session", {
          chatId,
          fromUserId,
          sessionId: mainSessionId,
        });
        await sendChannelRuntimeTurn({
          provider: "telegram",
          runtimeSessionId: mainSessionId,
          chatId,
          text,
          attachments,
          capabilityMode,
          replyText,
          sendLiveMessage,
          updateLiveMessage,
          replyDocument,
          chatType,
        });
        return;
      }

      const { runtimeSessionId } = await resolveChannelSessions({
        provider: "telegram",
        chatId,
        chatType,
        capabilityMode,
      });
      if (!isOwner && chatType === "group" && !mentioned) {
        if (!digitalAvatarSessionId) {
          return;
        }
        const batchKey = getChannelBatchKey("telegram", chatId);
        const existing = channelBatchStateByKey.get(batchKey);
        const batchState =
          existing ??
          {
            provider: "telegram",
            runtimeScope: MAIN_CHAT_SCOPE,
            runtimeSessionId,
            digitalAvatarSessionId,
            chatId,
            replyText,
            sendLiveMessage,
            updateLiveMessage,
            replyDocument,
            flushTimer: null,
            items: [],
          } satisfies ChannelBatchState;
        batchState.runtimeSessionId = runtimeSessionId;
        batchState.digitalAvatarSessionId = digitalAvatarSessionId;
        batchState.replyText = replyText;
        batchState.sendLiveMessage = sendLiveMessage;
        batchState.updateLiveMessage = updateLiveMessage;
        batchState.replyDocument = replyDocument;
        batchState.items.push({
          text: text || "（仅上传了附件）",
          senderId: fromUserId,
          senderName,
          createdAt: new Date().toISOString(),
          mentioned,
        });
        channelBatchStateByKey.set(batchKey, batchState);
        logger.info("Telegram non-owner group message queued for batch reply", {
          chatId,
          fromUserId,
          runtimeSessionId,
          batchSize: batchState.items.length,
          mentioned,
        });
        if (batchState.items.length > DIGITAL_AVATAR_BATCH_LIMIT) {
          await flushChannelBatchState(batchKey);
          return;
        }
        scheduleChannelBatchFlush(batchKey, batchState);
        return;
      }

      await sendChannelRuntimeTurn({
        provider: "telegram",
        runtimeSessionId,
        chatId,
        text,
        attachments,
        capabilityMode,
        replyText,
        sendLiveMessage,
        updateLiveMessage,
        replyDocument,
        digitalAvatarSessionId,
        chatType,
      });
    } finally {
      stopTyping();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Telegram message process failed", {
      chatId,
      error: errorMessage,
    });
    try {
      await replyText(`处理失败：${errorMessage}`);
    } catch (notifyError) {
      logger.error("Telegram error notification failed", notifyError);
    }
  }
};

const bootstrapOffset = async (): Promise<void> => {
  if (!runtime || runtime.offset > 0 || bootstrapped) {
    bootstrapped = true;
    return;
  }

  const updates = await fetchTelegramUpdates(runtime.token, 0, 0, 100);
  if (updates.length > 0) {
    const nextOffset = updates.reduce(
      (max, item) => Math.max(max, item.update_id + 1),
      runtime.offset,
    );
    runtime.offset = nextOffset;
    await settingsService.setTelegramLastUpdateId(nextOffset);
  }
  bootstrapped = true;
};

const pollTelegram = async (): Promise<void> => {
  if (!running || !runtime || polling) return;
  polling = true;

  try {
    if (!bootstrapped) {
      await bootstrapOffset();
    }
    if (!running || !runtime) return;

    const updates = await fetchTelegramUpdates(
      runtime.token,
      runtime.offset,
      TELEGRAM_POLL_TIMEOUT_SECONDS,
    );
    if (!running || !runtime) return;

    if (updates.length > 0) {
      let nextOffset = runtime.offset;
      for (const update of updates) {
        nextOffset = Math.max(nextOffset, update.update_id + 1);
        await processTelegramUpdate(update, runtime);
      }

      if (nextOffset !== runtime.offset) {
        runtime.offset = nextOffset;
        await settingsService.setTelegramLastUpdateId(nextOffset);
      }
    }

    schedulePoll(0);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (running) {
        schedulePoll(200);
      }
      return;
    }

    logger.error("Telegram polling failed", error);
    schedulePoll(TELEGRAM_POLL_RETRY_DELAY_MS);
  } finally {
    polling = false;
  }
};

const scheduleDiscordPoll = (delayMs: number): void => {
  if (!discordRuntime) return;
  stopDiscordPolling();
  discordPollTimer = setTimeout(
    () => {
      void pollDiscord();
    },
    Math.max(0, delayMs),
  );
};

const scheduleFeishuPoll = (delayMs: number): void => {
  if (!feishuRuntime) return;
  stopFeishuPollTimer();
  feishuPollTimer = setTimeout(
    () => {
      void pollFeishu();
    },
    Math.max(0, delayMs),
  );
};

const parseSnowflake = (value: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const parseFeishuCreateTimeMs = (value: string | undefined): number => {
  if (!value) return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  if (numeric > 10_000_000_000) {
    return Math.trunc(numeric);
  }
  return Math.trunc(numeric * 1_000);
};

const parseFeishuBodyContentObject = (
  item: FeishuMessageItem,
): Record<string, unknown> | undefined => {
  const rawContent = item.body?.content?.trim();
  if (!rawContent) return undefined;
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const resolveFeishuSenderRef = (
  item: FeishuMessageItem,
): { userId: string; userIdType?: FeishuUserIdType } => {
  const sender = item.sender;
  if (!sender) return { userId: "" };
  const senderFromIdObject =
    typeof sender.id === "object" && sender.id ? sender.id : undefined;
  const candidates: Array<{ value?: string; userIdType?: FeishuUserIdType }> = [
    { value: typeof sender.id === "string" ? sender.id : undefined },
    { value: senderFromIdObject?.open_id, userIdType: "open_id" },
    { value: senderFromIdObject?.user_id, userIdType: "user_id" },
    { value: senderFromIdObject?.union_id, userIdType: "union_id" },
    { value: sender.sender_id?.open_id, userIdType: "open_id" },
    { value: sender.sender_id?.user_id, userIdType: "user_id" },
    { value: sender.sender_id?.union_id, userIdType: "union_id" },
  ];
  for (const candidate of candidates) {
    const normalized = normalizeChatId(candidate.value);
    if (normalized) {
      return {
        userId: normalized,
        ...(candidate.userIdType ? { userIdType: candidate.userIdType } : {}),
      };
    }
  }
  return { userId: "" };
};

const parseFeishuTextContent = (item: FeishuMessageItem): string => {
  if (item.msg_type !== "text") return "";
  const rawContent = item.body?.content?.trim();
  if (!rawContent) return "";
  const parsed = parseFeishuBodyContentObject(item);
  if (parsed) {
    return readRecordString(parsed, "text") ?? "";
  }
  return rawContent;
};

const isFeishuMessageMentioned = (item: FeishuMessageItem): boolean => {
  if ((item.mentions?.length ?? 0) > 0) {
    return true;
  }
  const rawContent = item.body?.content?.trim() ?? "";
  return /@_user_\d+\b/.test(rawContent);
};

const extractFeishuInboundAttachmentCandidate = (
  message: FeishuMessageItem,
): FeishuInboundAttachmentCandidate | null => {
  const messageId = message.message_id?.trim();
  const msgType = message.msg_type?.trim().toLowerCase();
  if (!messageId || !msgType || msgType === "text") return null;
  const payload = parseFeishuBodyContentObject(message);
  if (!payload) return null;

  const fileName = readRecordString(payload, "file_name");
  const mimeType = normalizeMimeType(
    readRecordString(payload, "mime_type") ??
      readRecordString(payload, "content_type"),
  );

  if (msgType === "image") {
    const imageKey =
      readRecordString(payload, "image_key") ??
      readRecordString(payload, "file_key");
    if (!imageKey) return null;
    return {
      messageId,
      resourceType: "image",
      resourceKey: imageKey,
      fileName,
      mimeType: mimeType ?? "image/jpeg",
      fallbackName: `feishu-image-${messageId}`,
      fallbackExtension: ".jpg",
    };
  }

  if (msgType === "file") {
    const fileKey = readRecordString(payload, "file_key");
    if (!fileKey) return null;
    return {
      messageId,
      resourceType: "file",
      resourceKey: fileKey,
      fileName,
      mimeType,
      fallbackName: `feishu-file-${messageId}`,
    };
  }

  if (msgType === "audio") {
    const audioKey =
      readRecordString(payload, "file_key") ??
      readRecordString(payload, "audio_key");
    if (!audioKey) return null;
    return {
      messageId,
      resourceType: "audio",
      resourceKey: audioKey,
      fileName,
      mimeType: mimeType ?? "audio/mpeg",
      fallbackName: `feishu-audio-${messageId}`,
      fallbackExtension: ".mp3",
    };
  }

  if (msgType === "media" || msgType === "video") {
    const mediaKey =
      readRecordString(payload, "file_key") ??
      readRecordString(payload, "media_key");
    if (!mediaKey) return null;
    return {
      messageId,
      resourceType: "media",
      resourceKey: mediaKey,
      fileName,
      mimeType: mimeType ?? "video/mp4",
      fallbackName: `feishu-video-${messageId}`,
      fallbackExtension: ".mp4",
    };
  }

  return null;
};

const loadFeishuInboundAttachments = async (input: {
  token: string;
  scope: ChatScope;
  chatId: string;
  message: FeishuMessageItem;
}): Promise<ChatAttachmentDTO[]> => {
  const candidate = extractFeishuInboundAttachmentCandidate(input.message);
  if (!candidate) return [];
  const accessToken = await resolveFeishuAccessToken(input.token);
  const resourceUrl = `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(
    candidate.messageId,
  )}/resources/${encodeURIComponent(candidate.resourceKey)}?${new URLSearchParams(
    {
      type: candidate.resourceType,
    },
  ).toString()}`;
  const tempDir = await createInboundTempDirectory("kian-feishu-inbound");
  try {
    const downloaded = await downloadInboundFileToTemp({
      provider: "飞书",
      action: "消息附件下载",
      url: resourceUrl,
      tempDir,
      preferredFileName: candidate.fileName,
      fallbackFileName: candidate.fallbackName,
      fallbackExtension: candidate.fallbackExtension,
      mimeType: candidate.mimeType,
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });
    return await importInboundFilesToChatAttachments({
      provider: "飞书",
      scope: input.scope,
      chatId: input.chatId,
      files: [downloaded],
    });
  } catch (error) {
    logger.warn("Failed to download feishu inbound attachment", {
      chatId: input.chatId,
      messageId: input.message.message_id,
      error,
    });
    return [];
  } finally {
    await cleanupInboundTempDirectory(tempDir);
  }
};

const processBotIncomingMessage = async (input: {
  provider: "Discord" | "飞书";
  state: BotRuntime;
  chatId: string;
  fromUserId: string;
  senderName: string;
  chatName?: string;
  chatType: ChannelChatType;
  mentioned: boolean;
  text: string;
  attachments?: ChatAttachmentDTO[];
  sendAttachmentsFirst?: boolean;
  replyText: (text: string) => Promise<void>;
  sendLiveMessage?: (text: string) => Promise<string | number | undefined>;
  updateLiveMessage?: (
    messageId: string | number,
    text: string,
  ) => Promise<void>;
  onStreamingDone?: () => Promise<void>;
  replyDocument?: (filePath: string) => Promise<void>;
}): Promise<void> => {
  const sendAttachmentsFirst = input.sendAttachmentsFirst ?? false;
  input.state.activeChatIds.add(input.chatId);

  const text = input.text.trim();
  const attachments = input.attachments ?? [];
  const provider =
    input.provider === "Discord"
      ? "discord"
      : input.provider === "飞书"
        ? "feishu"
        : "telegram";
  const isOwner = input.state.ownerUserIds.has(input.fromUserId);
  const capabilityMode: ChatCapabilityMode = isOwner ? "full" : "chat_only";
  chatChannelOwnerDiscoveryService.record({
    provider,
    userId: input.fromUserId,
    displayName: input.senderName,
  });
  logger.info("Channel bot inbound message received", {
    provider,
    chatId: input.chatId,
    fromUserId: input.fromUserId,
    senderName: input.senderName,
    chatType: input.chatType,
    isOwner,
    mentioned: input.mentioned,
    capabilityMode,
    textLength: text.length,
    attachmentCount: attachments.length,
  });
  if (!text && attachments.length === 0) {
    await input.replyText(CHANNEL_SUPPORTED_INPUT_MESSAGE);
    return;
  }

  let digitalAvatarSessionId: string | undefined;
  if (!isOwner) {
    digitalAvatarSessionId = await getOrCreateDigitalAvatarSessionForConversation({
      provider,
      chatType: input.chatType,
      chatId: input.chatId,
      senderId: input.fromUserId,
      senderName: input.senderName,
      chatName: input.chatName,
    });
    await mirrorChannelInboundMessage({
      sessionId: digitalAvatarSessionId,
      text: text || "（仅上传了附件）",
      provider,
      chatType: input.chatType,
      senderId: input.fromUserId,
      senderName: input.senderName,
      isOwner: false,
      mentioned: input.mentioned,
      capabilityMode,
    });
  }

  if ((text === "/start" || text === "/help") && attachments.length === 0) {
    await input.replyText(CHANNEL_HELP_MESSAGE);
    return;
  }

  try {
    if (isOwner) {
      const mainSessionId = await resolveMainAgentLatestSessionId({
        provider,
        chatId: input.chatId,
      });
      logger.info("Owner channel message routed to main session", {
        provider,
        chatId: input.chatId,
        fromUserId: input.fromUserId,
        sessionId: mainSessionId,
      });
      await sendChannelRuntimeTurn({
        provider,
        runtimeSessionId: mainSessionId,
        chatId: input.chatId,
        text,
        attachments,
        capabilityMode,
        replyText: input.replyText,
        sendLiveMessage: input.sendLiveMessage,
        updateLiveMessage: input.updateLiveMessage,
        onStreamingDone: input.onStreamingDone,
        replyDocument: input.replyDocument,
        sendAttachmentsFirst,
        chatType: input.chatType,
      });
      return;
    }

    const { runtimeSessionId } = await resolveChannelSessions({
      provider,
      chatId: input.chatId,
      chatType: input.chatType,
      capabilityMode,
    });
    if (!isOwner && input.chatType === "group" && !input.mentioned) {
      if (!digitalAvatarSessionId) {
        return;
      }
      const batchKey = getChannelBatchKey(provider, input.chatId);
      const existing = channelBatchStateByKey.get(batchKey);
      const state =
        existing ??
        {
          provider,
          runtimeScope: MAIN_CHAT_SCOPE,
          runtimeSessionId,
          digitalAvatarSessionId,
          chatId: input.chatId,
          replyText: input.replyText,
          sendLiveMessage: input.sendLiveMessage,
          updateLiveMessage: input.updateLiveMessage,
          onStreamingDone: input.onStreamingDone,
          replyDocument: input.replyDocument,
          sendAttachmentsFirst,
          flushTimer: null,
          items: [],
        } satisfies ChannelBatchState;
      state.runtimeSessionId = runtimeSessionId;
      state.digitalAvatarSessionId = digitalAvatarSessionId;
      state.replyText = input.replyText;
      state.sendLiveMessage = input.sendLiveMessage;
      state.updateLiveMessage = input.updateLiveMessage;
      state.onStreamingDone = input.onStreamingDone;
      state.replyDocument = input.replyDocument;
      state.sendAttachmentsFirst = sendAttachmentsFirst;
      state.items.push({
        text: text || "（仅上传了附件）",
        senderId: input.fromUserId,
        senderName: input.senderName,
        createdAt: new Date().toISOString(),
        mentioned: input.mentioned,
      });
      channelBatchStateByKey.set(batchKey, state);
      logger.info("Non-owner group message queued for batch reply", {
        provider,
        chatId: input.chatId,
        fromUserId: input.fromUserId,
        runtimeSessionId,
        batchSize: state.items.length,
        mentioned: input.mentioned,
      });
      if (state.items.length > DIGITAL_AVATAR_BATCH_LIMIT) {
        await flushChannelBatchState(batchKey);
        return;
      }
      scheduleChannelBatchFlush(batchKey, state);
      return;
    }

    await sendChannelRuntimeTurn({
      provider,
      runtimeSessionId,
      chatId: input.chatId,
      text,
      attachments,
      capabilityMode,
      replyText: input.replyText,
      sendLiveMessage: input.sendLiveMessage,
      updateLiveMessage: input.updateLiveMessage,
      onStreamingDone: input.onStreamingDone,
      replyDocument: input.replyDocument,
      sendAttachmentsFirst,
      digitalAvatarSessionId,
      chatType: input.chatType,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`${input.provider} message process failed`, {
      chatId: input.chatId,
      error: errorMessage,
    });
    try {
      await input.replyText(`处理失败：${errorMessage}`);
    } catch (notifyError) {
      logger.error(`${input.provider} error notification failed`, notifyError);
    }
  }
};

const processWeixinMessage = async (
  message: WeixinInboundMessage,
): Promise<void> => {
  const state = weixinChannelService.getRuntimeContext();
  if (!state) {
    return;
  }

  const chatId = normalizeChatId(message.fromUserId);
  if (!chatId) {
    return;
  }

  const text = message.text?.trim() ?? "";
  const replyText = async (reply: string): Promise<void> => {
    await weixinChannelService.sendText({
      accountId: message.accountId,
      toUserId: chatId,
      text: reply,
      contextToken: message.contextToken,
    });
  };
  const replyDocument = async (filePath: string): Promise<void> => {
    if (/^(?:https?:\/\/|data:image\/[a-z0-9.+-]+;base64,)/i.test(filePath)) {
      await weixinChannelService.sendMedia({
        accountId: message.accountId,
        toUserId: chatId,
        contextToken: message.contextToken,
        remoteUrl: filePath,
      });
      return;
    }
    await weixinChannelService.sendMedia({
      accountId: message.accountId,
      toUserId: chatId,
      contextToken: message.contextToken,
      filePath,
    });
  };

  if (!text) {
    await replyText(WEIXIN_SUPPORTED_INPUT_MESSAGE);
    return;
  }

  if (text === "/start" || text === "/help") {
    await replyText(WEIXIN_HELP_MESSAGE);
    return;
  }

  try {
    const sessionId = await resolveMainAgentLatestSessionId({
      provider: "weixin",
      chatId,
      accountId: message.accountId,
    });

    const progressiveStreamer = createDirectChannelReplyStreamer({
      provider: "weixin",
      projectId: MAIN_AGENT_SCOPE_ID,
      chatId,
      sendText: replyText,
      sendDocument: replyDocument,
    });

    const requestId = randomUUID();
    const result = await chatService.send(
      {
        scope: MAIN_CHAT_SCOPE,
        module: "main",
        sessionId,
        requestId,
        message: text,
      },
      (streamEvent) => {
        progressiveStreamer.pushEvent(streamEvent);
      },
    );

    await progressiveStreamer.finalize({
      fallbackAssistantMessage: result.assistantMessage,
      toolActions: result.toolActions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Weixin message process failed", {
      accountId: message.accountId,
      fromUserId: message.fromUserId,
      error,
    });
    try {
      await replyText(`处理失败：${errorMessage}`);
    } catch (notifyError) {
      logger.error("Weixin error notification failed", notifyError);
    }
  }
};

const isDiscordMessageAllowedByScope = (input: {
  runtime: DiscordRuntime;
  chatId: string;
  guildId: string | null;
}): boolean => {
  if (!input.runtime.allowedChannelIds.has(input.chatId)) {
    return false;
  }
  // DM channels have no guildId — allow if the channel ID is explicitly allowed
  if (!input.guildId) return true;
  return input.runtime.allowedServerIds.has(input.guildId);
};

const processDiscordMessage = async (
  message: DiscordMessage,
  state: DiscordRuntime,
): Promise<void> => {
  const chatId = normalizeChatId(message.channel_id);
  const messageId = message.id?.trim() || "";
  let reactedToUserMessage = false;
  const fromUserId = normalizeChatId(message.author?.id);
  if (!chatId || !fromUserId) return;
  if (message.author?.bot) return;
  let guildId = normalizeChatId(message.guild_id);
  if (!guildId) {
    try {
      guildId = await resolveDiscordChannelGuildId(state.token, chatId);
    } catch (error) {
      logger.warn("Failed to resolve Discord guild by channel", {
        chatId,
        error,
      });
      return;
    }
  }
  if (!isDiscordMessageAllowedByScope({ runtime: state, chatId, guildId })) {
    return;
  }
  const chatType: ChannelChatType = guildId ? "group" : "direct";
  const mentioned =
    chatType === "direct"
      ? true
      : (message.mentions ?? []).some(
          (mention) => normalizeChatId(mention.id) === state.botUserId,
        );
  const senderName =
    message.author?.global_name?.trim() ||
    message.author?.username?.trim() ||
    fromUserId;
  let chatName = "";
  try {
    chatName = await fetchDiscordChannelDisplayName(state.token, chatId);
  } catch (error) {
    logger.warn("Failed to resolve Discord channel display name", {
      chatId,
      error,
    });
  }
  const attachments = await loadDiscordInboundAttachments({
    token: state.token,
    scope: MAIN_CHAT_SCOPE,
    chatId,
    message,
  });
  const ensureReaction = async (): Promise<void> => {
    if (reactedToUserMessage || !messageId) return;
    reactedToUserMessage = true;
    try {
      await setDiscordMessageReaction(state.token, chatId, messageId);
    } catch (error) {
      logger.warn("Failed to set Discord message reaction", {
        chatId,
        messageId,
        error,
      });
    }
  };

  await ensureReaction();

  await processBotIncomingMessage({
    provider: "Discord",
    state,
    chatId,
    fromUserId,
    senderName,
    chatName,
    chatType,
    mentioned,
    text: message.content ?? "",
    attachments,
    replyText: async (text) => {
      await ensureReaction();
      await sendDiscordBotMessage(
        state.token,
        chatId,
        text,
        messageId || undefined,
      );
    },
    sendLiveMessage: async (text) => {
      await ensureReaction();
      return await sendDiscordBotMessage(
        state.token,
        chatId,
        text,
        messageId || undefined,
      );
    },
    updateLiveMessage: async (liveMessageId, text) => {
      if (typeof liveMessageId !== "string" || !liveMessageId.trim()) return;
      await editDiscordBotMessage(state.token, chatId, liveMessageId, text);
    },
    replyDocument: async (filePath) => {
      await ensureReaction();
      await sendDiscordBotDocument(
        state.token,
        chatId,
        filePath,
        messageId || undefined,
      );
    },
  });
};

const processFeishuMessage = async (
  message: FeishuMessageItem,
  state: BotRuntime,
  fallbackChatId: string,
): Promise<void> => {
  if (message.sender?.sender_type === "app") {
    logger.info("Feishu inbound message skipped: sender is app", {
      messageId: message.message_id,
      chatId: message.chat_id ?? fallbackChatId,
      messageType: message.msg_type,
    });
    return;
  }
  const chatId = normalizeChatId(message.chat_id ?? fallbackChatId);
  const replyToMessageId = message.message_id?.trim() || "";
  let reactedToUserMessage = false;
  const senderRef = resolveFeishuSenderRef(message);
  const fromUserId = senderRef.userId;
  if (!chatId || !fromUserId) {
    logger.warn("Feishu inbound message ignored: missing chat/user id", {
      messageId: message.message_id,
      rawChatId: message.chat_id,
      fallbackChatId,
      hasFromUserId: Boolean(fromUserId),
    });
    return;
  }
  const text = parseFeishuTextContent(message);
  const chatType = toChannelChatType(message.chat_type);
  const mentioned = chatType === "direct" ? true : isFeishuMessageMentioned(message);
  let senderName = fromUserId;
  let chatName = "";
  try {
    const resolvedSenderName = await fetchFeishuUserDisplayName({
      token: state.token,
      userId: fromUserId,
      chatId,
      userIdType: senderRef.userIdType,
    });
    if (resolvedSenderName) {
      senderName = resolvedSenderName;
    }
  } catch (error) {
    logger.warn("Failed to resolve Feishu sender display name", {
      userId: fromUserId,
      userIdType: senderRef.userIdType,
      error,
    });
  }
  if (chatType === "group") {
    try {
      chatName = await fetchFeishuChatDisplayName(state.token, chatId);
    } catch (error) {
      logger.warn("Failed to resolve Feishu chat display name", {
        chatId,
        error,
      });
    }
  }
  const attachments = await loadFeishuInboundAttachments({
    token: state.token,
    scope: MAIN_CHAT_SCOPE,
    chatId,
    message,
  });
  logger.info("Processing Feishu inbound message", {
    messageId: message.message_id,
    chatId,
    fromUserId,
    messageType: message.msg_type,
    textLength: text.length,
    attachmentCount: attachments.length,
  });
  const ensureReaction = async (): Promise<void> => {
    if (reactedToUserMessage || !replyToMessageId) return;
    reactedToUserMessage = true;
    try {
      await setFeishuMessageReaction(state.token, replyToMessageId);
    } catch (error) {
      logger.warn("Failed to set Feishu message reaction", {
        chatId,
        messageId: replyToMessageId,
        error,
      });
    }
  };

  await processBotIncomingMessage({
    provider: "飞书",
    state,
    chatId,
    fromUserId,
    senderName,
    chatName,
    chatType,
    mentioned,
    text,
    attachments,
    sendAttachmentsFirst: true,
    replyText: async (text) => {
      await ensureReaction();
      await sendFeishuBotMessage(
        state.token,
        chatId,
        text,
        "chat_id",
        replyToMessageId || undefined,
      );
    },
    ...(() => {
      let streamCardId: string | undefined;
      let streamSequence = 1;
      let useFallback = false;

      const closeCurrentStream = async (): Promise<void> => {
        if (!useFallback && streamCardId) {
          await stopFeishuCardStreaming(state.token, streamCardId, streamSequence++).catch(() => {});
        }
      };

      return {
        sendLiveMessage: async (text: string): Promise<string | undefined> => {
          // Close previous streaming card if starting a new one
          await closeCurrentStream();
          streamSequence = 1;
          streamCardId = undefined;

          await ensureReaction();
          // Try CardKit streaming first, fall back to regular card on failure
          try {
            streamCardId = await createFeishuStreamingCard(state.token, text);
            return await sendFeishuBotCardByCardId({
              token: state.token,
              receiveId: chatId,
              cardId: streamCardId,
              receiveIdType: "chat_id",
              replyToMessageId: replyToMessageId || undefined,
            });
          } catch (error) {
            logger.warn("CardKit streaming card creation failed, falling back to regular card", { error });
            useFallback = true;
            streamCardId = undefined;
            return await sendFeishuBotCard({
              token: state.token,
              receiveId: chatId,
              card: buildFeishuMarkdownCard(text),
              receiveIdType: "chat_id",
              replyToMessageId: replyToMessageId || undefined,
            });
          }
        },
        updateLiveMessage: async (messageId: string | number, text: string): Promise<void> => {
          if (useFallback) {
            if (typeof messageId !== "string" || !messageId.trim()) return;
            await updateFeishuBotCard(state.token, messageId, buildFeishuMarkdownCard(text));
            return;
          }
          if (!streamCardId) return;
          await updateFeishuStreamingCardText(state.token, streamCardId, text, streamSequence++);
        },
        onStreamingDone: async (): Promise<void> => {
          await closeCurrentStream();
        },
      };
    })(),
    replyDocument: async (filePath) => {
      await ensureReaction();
      await sendFeishuBotDocument(
        state.token,
        chatId,
        filePath,
        "chat_id",
        replyToMessageId || undefined,
      );
    },
  });
  logger.info("Finished processing Feishu inbound message", {
    messageId: message.message_id,
    chatId,
  });
};

const bootstrapDiscordOffsets = async (
  state: DiscordRuntime,
): Promise<void> => {
  discordLastMessageIdByChat.clear();
  for (const chatId of state.activeChatIds) {
    try {
      const messages = await fetchDiscordMessages({
        token: state.token,
        chatId,
      });
      const latest = messages.reduce<string | null>((current, message) => {
        const messageId = message.id?.trim();
        if (!messageId) return current;
        if (!current) return messageId;
        return parseSnowflake(messageId) > parseSnowflake(current)
          ? messageId
          : current;
      }, null);
      if (latest) {
        discordLastMessageIdByChat.set(chatId, latest);
      }
    } catch (error) {
      logger.warn("Failed to bootstrap Discord chat offset", { chatId, error });
    }
  }
};

const pollDiscord = async (): Promise<void> => {
  const state = discordRuntime;
  if (!state || discordPolling) return;
  discordPolling = true;
  try {
    for (const chatId of state.activeChatIds) {
      const afterMessageId = discordLastMessageIdByChat.get(chatId);
      const messages = await fetchDiscordMessages({
        token: state.token,
        chatId,
        afterMessageId,
      });
      const sorted = messages
        .filter((item) => item.id?.trim())
        .sort((a, b) => {
          const left = parseSnowflake(a.id);
          const right = parseSnowflake(b.id);
          if (left < right) return -1;
          if (left > right) return 1;
          return 0;
        });
      for (const message of sorted) {
        const messageId = message.id?.trim();
        if (messageId) {
          const existing = discordLastMessageIdByChat.get(chatId);
          if (
            !existing ||
            parseSnowflake(messageId) > parseSnowflake(existing)
          ) {
            discordLastMessageIdByChat.set(chatId, messageId);
          }
        }
        await processDiscordMessage(message, state);
      }
    }
    scheduleDiscordPoll(DISCORD_POLL_INTERVAL_MS);
  } catch (error) {
    logger.error("Discord polling failed", error);
    scheduleDiscordPoll(DISCORD_POLL_INTERVAL_MS * 2);
  } finally {
    discordPolling = false;
  }
};

const bootstrapFeishuOffsets = async (state: BotRuntime): Promise<void> => {
  await syncFeishuActiveChats(state, { force: true });
  feishuLastMessageTsByChat.clear();
  for (const chatId of state.activeChatIds) {
    try {
      const messages = await fetchFeishuMessages({
        token: state.token,
        chatId,
      });
      const latestTimestamp = messages.reduce((current, message) => {
        const timestamp = parseFeishuCreateTimeMs(message.create_time);
        return timestamp > current ? timestamp : current;
      }, 0);
      if (latestTimestamp > 0) {
        feishuLastMessageTsByChat.set(chatId, latestTimestamp);
      }
    } catch (error) {
      logger.warn("Failed to bootstrap Feishu chat offset", { chatId, error });
    }
  }
};

const pollFeishu = async (): Promise<void> => {
  const state = feishuRuntime;
  if (!state || feishuPolling) return;
  feishuPolling = true;
  try {
    await syncFeishuActiveChats(state);
    for (const chatId of state.activeChatIds) {
      const startTimeMs = feishuLastMessageTsByChat.get(chatId);
      const messages = await fetchFeishuMessages({
        token: state.token,
        chatId,
        startTimeMs:
          typeof startTimeMs === "number" && startTimeMs > 0
            ? startTimeMs + 1
            : undefined,
      });
      const sorted = messages.sort((a, b) => {
        const left = parseFeishuCreateTimeMs(a.create_time);
        const right = parseFeishuCreateTimeMs(b.create_time);
        return left - right;
      });
      let maxTimestamp = startTimeMs ?? 0;
      for (const message of sorted) {
        const timestamp = parseFeishuCreateTimeMs(message.create_time);
        if (timestamp > maxTimestamp) {
          maxTimestamp = timestamp;
        }
        await processFeishuMessage(message, state, chatId);
      }
      if (maxTimestamp > 0) {
        feishuLastMessageTsByChat.set(chatId, maxTimestamp);
      }
    }
    scheduleFeishuPoll(FEISHU_POLL_INTERVAL_MS);
  } catch (error) {
    logger.error("Feishu polling failed", error);
    scheduleFeishuPoll(FEISHU_POLL_INTERVAL_MS * 2);
  } finally {
    feishuPolling = false;
  }
};

const startPolling = (input: {
  token: string;
  scope: ChatScope;
  projectId: string;
  ownerUserIds: string[];
  botUserId: string;
  botUsername: string;
  lastUpdateId: number;
}): void => {
  running = true;
  polling = false;
  bootstrapped = false;
  runtime = {
    token: input.token,
    projectId: input.projectId,
    scope: input.scope,
    ownerUserIds: new Set(
      input.ownerUserIds
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
    botUserId: input.botUserId,
    botUsername: input.botUsername,
    offset: input.lastUpdateId,
  };
  schedulePoll(0);
  logger.info("Telegram chat channel started", {
    projectId: input.projectId,
    scope: input.scope,
    ownerUserIds: input.ownerUserIds,
    ownerWhitelistSize: runtime.ownerUserIds.size,
    botUserId: input.botUserId,
    botUsername: input.botUsername,
  });
};

const stopTelegramService = (): void => {
  running = false;
  polling = false;
  bootstrapped = false;
  runtime = null;
  stopTelegramPolling();
};

const stopService = (): void => {
  stopTelegramService();
  stopDiscordPolling();
  stopDiscordGatewayConnection();
  stopFeishuPolling();
  void weixinChannelService.stop();
  discordPolling = false;
  feishuPolling = false;
  discordLastMessageIdByChat = new Map<string, string>();
  discordGuildIdByChannel = new Map<string, string | null>();
  discordChannelDisplayNameByChannel = new Map<string, string | null>();
  feishuLastMessageTsByChat = new Map<string, number>();
  feishuLastChatSyncAt = 0;
  feishuChatDisplayNameByChat = new Map<string, string | null>();
  feishuUserDisplayNameByUser = new Map<string, string | null>();
  clearFeishuTenantTokenCache();
  discordRuntime = null;
  feishuRuntime = null;
  sessionReplyContextByKey = new Map<string, SessionReplyContext>();
  mainAgentSessionPromise = null;
  runtimeSignature = "";
};

weixinChannelService.configure({
  onMessage: async (message) => {
    await processWeixinMessage(message);
  },
});

export const chatChannelService = {
  createSessionAssistantReplyStreamer(input: {
    scope: ChatScope;
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
  }): TelegramAssistantProgressiveStreamer | null {
    const replyContext = sessionReplyContextByKey.get(
      getSessionReplyContextKey(input.scope, input.sessionId),
    );
    if (!replyContext) return null;

    if (replyContext.provider === "telegram") {
      const telegramState = running && runtime ? runtime : null;
      if (!telegramState) return null;
      return createDirectChannelReplyStreamer({
        provider: "telegram",
        projectId: input.projectId,
        chatId: replyContext.chatId,
        sendText: async (text) => {
          await sendTelegramMessage(telegramState.token, replyContext.chatId, text);
        },
        sendLiveMessage: async (text) => {
          return await sendTelegramMessage(
            telegramState.token,
            replyContext.chatId,
            text,
          );
        },
        updateLiveMessage: async (messageId, text) => {
          if (typeof messageId !== "number") return;
          await editTelegramMessage(
            telegramState.token,
            replyContext.chatId,
            messageId,
            text,
          );
        },
        sendDocument: async (filePath) => {
          await sendTelegramDocument(
            telegramState.token,
            replyContext.chatId,
            filePath,
          );
        },
      });
    }

    if (replyContext.provider === "discord") {
      const state = discordRuntime;
      if (!state) return null;
      return createDirectChannelReplyStreamer({
        provider: "discord",
        projectId: input.projectId,
        chatId: replyContext.chatId,
        sendText: async (text) => {
          await sendDiscordBotMessage(state.token, replyContext.chatId, text);
        },
        sendLiveMessage: async (text) => {
          return await sendDiscordBotMessage(
            state.token,
            replyContext.chatId,
            text,
          );
        },
        updateLiveMessage: async (messageId, text) => {
          if (typeof messageId !== "string" || !messageId.trim()) return;
          await editDiscordBotMessage(
            state.token,
            replyContext.chatId,
            messageId,
            text,
          );
        },
        sendDocument: async (filePath) => {
          await sendDiscordBotDocument(state.token, replyContext.chatId, filePath);
        },
      });
    }

    if (replyContext.provider === "weixin") {
      if (!replyContext.accountId) {
        return null;
      }
      return createDirectChannelReplyStreamer({
        provider: "weixin",
        projectId: input.projectId,
        chatId: replyContext.chatId,
        sendText: async (text) => {
          await weixinChannelService.sendText({
            accountId: replyContext.accountId!,
            toUserId: replyContext.chatId,
            text,
          });
        },
        sendDocument: async (filePath) => {
          if (/^(?:https?:\/\/|data:image\/[a-z0-9.+-]+;base64,)/i.test(filePath)) {
            await weixinChannelService.sendMedia({
              accountId: replyContext.accountId!,
              toUserId: replyContext.chatId,
              remoteUrl: filePath,
            });
            return;
          }
          await weixinChannelService.sendMedia({
            accountId: replyContext.accountId!,
            toUserId: replyContext.chatId,
            filePath,
          });
        },
      });
    }

    const state = feishuRuntime;
    if (!state) return null;
    const feishuStreaming = (() => {
      let streamCardId: string | undefined;
      let streamSequence = 1;
      let useFallback = false;

      const closeCurrentStream = async (): Promise<void> => {
        if (!useFallback && streamCardId) {
          await stopFeishuCardStreaming(state.token, streamCardId, streamSequence++).catch(() => {});
        }
      };

      return {
        sendLiveMessage: async (text: string): Promise<string | undefined> => {
          await closeCurrentStream();
          streamSequence = 1;
          streamCardId = undefined;

          try {
            streamCardId = await createFeishuStreamingCard(state.token, text);
            return await sendFeishuBotCardByCardId({
              token: state.token,
              receiveId: replyContext.chatId,
              cardId: streamCardId,
              receiveIdType: "chat_id",
            });
          } catch (error) {
            logger.warn("CardKit streaming card creation failed, falling back to regular card", { error });
            useFallback = true;
            streamCardId = undefined;
            return await sendFeishuBotCard({
              token: state.token,
              receiveId: replyContext.chatId,
              card: buildFeishuMarkdownCard(text),
              receiveIdType: "chat_id",
            });
          }
        },
        updateLiveMessage: async (messageId: string | number, text: string): Promise<void> => {
          if (useFallback) {
            if (typeof messageId !== "string" || !messageId.trim()) return;
            await updateFeishuBotCard(state.token, messageId, buildFeishuMarkdownCard(text));
            return;
          }
          if (!streamCardId) return;
          await updateFeishuStreamingCardText(state.token, streamCardId, text, streamSequence++);
        },
        onStreamingDone: async (): Promise<void> => {
          await closeCurrentStream();
        },
      };
    })();
    return createDirectChannelReplyStreamer({
      provider: "feishu",
      projectId: input.projectId,
      chatId: replyContext.chatId,
      sendAttachmentsFirst: true,
      sendText: async (text) => {
        await sendFeishuBotMessage(state.token, replyContext.chatId, text, "chat_id");
      },
      ...feishuStreaming,
      sendDocument: async (filePath) => {
        await sendFeishuBotDocument(
          state.token,
          replyContext.chatId,
          filePath,
          "chat_id",
        );
      },
    });
  },

  createAgentAssistantMirrorStreamer(input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
  }): TelegramAssistantProgressiveStreamer {
    const telegramState = running && runtime ? runtime : null;
    const discordState = discordRuntime;
    const feishuState = feishuRuntime;
    if (!telegramState && !discordState && !feishuState) {
      return {
        pushEvent: () => undefined,
        finalize: async () => undefined,
      };
    }

    const streamEvents: ChatStreamEvent[] = [];
    const telegramStreamer = telegramState
      ? createTelegramAssistantProgressiveStreamer({
          sendToolRunningMessage: async (tool) => {
            await broadcastTelegramAssistantToolMessage(
              telegramState,
              input,
              tool,
            );
          },
          sendToolDoneMessage: async (tool) => {
            await broadcastTelegramAssistantToolMessage(
              telegramState,
              input,
              tool,
            );
          },
          sendAssistantMessage: async (message, isError) => {
            await broadcastTelegramAssistantBlockMessage(telegramState, {
              ...input,
              message,
              isError,
            });
          },
        })
      : {
          pushEvent: () => undefined,
          finalize: async () => undefined,
        };

    return {
      pushEvent: (event) => {
        streamEvents.push(event);
        telegramStreamer.pushEvent(event);
      },
      finalize: async (finalInput) => {
        await telegramStreamer.finalize(finalInput);
        const mirrorInput = {
          ...input,
          message: finalInput.fallbackAssistantMessage,
          isError: Boolean(finalInput.isError),
          streamEvents,
          toolActions: finalInput.toolActions,
        };

        if (discordState) {
          try {
            await broadcastDiscordAssistantMessage(discordState, mirrorInput);
          } catch (error) {
            logger.warn("Failed to mirror agent assistant message to Discord", {
              sessionId: input.sessionId,
              projectId: input.projectId,
              error,
            });
          }
        }

        if (feishuState) {
          try {
            await broadcastFeishuAssistantMessage(feishuState, mirrorInput);
          } catch (error) {
            logger.warn("Failed to mirror agent assistant message to Feishu", {
              sessionId: input.sessionId,
              projectId: input.projectId,
              error,
            });
          }
        }
      },
    };
  },

  buildToolCallsFromStreamEvents(
    streamEvents: ChatStreamEvent[],
    toolActions: string[] = [],
  ): TelegramToolCallSummary[] {
    return buildTelegramToolCallsFromStreamEvents(streamEvents, toolActions);
  },

  async refresh(): Promise<void> {
    const [telegram, discord, feishu, weixin, mainSubModeEnabled] = await Promise.all([
      settingsService.getTelegramChatChannelRuntime(),
      settingsService.getDiscordChatChannelRuntime(),
      settingsService.getFeishuChatChannelRuntime(),
      settingsService.getWeixinChatChannelRuntime(),
      settingsService.getMainSubModeEnabled(),
    ]);

    const resolveProjectId = (projectId: string): string => {
      if (mainSubModeEnabled) return MAIN_AGENT_SCOPE_ID;
      return projectId.trim();
    };
    const resolveScope = (projectId: string): ChatScope =>
      mainSubModeEnabled ? MAIN_CHAT_SCOPE : toProjectScope(projectId);
    const resolvedWeixinProjectId = resolveProjectId("");

    await weixinChannelService.refresh({
      scope: resolveScope(resolvedWeixinProjectId),
      projectId: resolvedWeixinProjectId,
    });

    const token = telegram.secret?.trim() ?? "";
    const resolvedTelegramProjectId = resolveProjectId("");
    const telegramOwnerUserIds = telegram.ownerUserIds
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && /^\d+$/.test(item));
    const telegramReady =
      telegram.enabled &&
      token.length > 0 &&
      (mainSubModeEnabled || resolvedTelegramProjectId.length > 0);

    const discordToken = discord.secret?.trim() ?? "";
    const resolvedDiscordProjectId = resolveProjectId("");
    const discordOwnerUserIds = discord.ownerUserIds
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && /^\d+$/.test(item));
    const discordServerIds = discord.serverIds
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && /^\d+$/.test(item));
    const discordChannelIds = discord.channelIds
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && /^\d+$/.test(item));
    const discordReady =
      discord.enabled &&
      discordToken.length > 0 &&
      (mainSubModeEnabled || resolvedDiscordProjectId.length > 0) &&
      discordServerIds.length > 0 &&
      discordChannelIds.length > 0;

    const feishuAppId = feishu.appId?.trim() ?? "";
    const feishuAppSecret = feishu.appSecret?.trim() ?? "";
    const feishuToken =
      feishuAppId.length > 0 && feishuAppSecret.length > 0
        ? `${feishuAppId}:${feishuAppSecret}`
        : "";
    const resolvedFeishuProjectId = resolveProjectId("");
    const feishuOwnerUserIds = feishu.ownerUserIds
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const feishuReady =
      feishu.enabled &&
      feishuToken.length > 0 &&
      (mainSubModeEnabled || resolvedFeishuProjectId.length > 0);
    const feishuNotReadyReasons: string[] = [];
    if (!feishu.enabled) feishuNotReadyReasons.push("disabled");
    if (feishuToken.length === 0)
      feishuNotReadyReasons.push("missing_app_credentials");
    logger.info("Feishu runtime readiness evaluated", {
      enabled: feishu.enabled,
      configured: feishu.configured,
      hasAppId: feishuAppId.length > 0,
      hasAppSecret: feishuAppSecret.length > 0,
      resolvedProjectId: resolvedFeishuProjectId,
      ready: feishuReady,
      reasons: feishuReady ? [] : feishuNotReadyReasons,
    });

    const nextSignature = JSON.stringify({
      telegram: {
        config: buildRuntimeSignature({
          enabled: telegram.enabled,
          token,
          projectId: resolvedTelegramProjectId,
          scopeType: mainSubModeEnabled ? "main" : "project",
          userIds: telegramOwnerUserIds,
        }),
        lastUpdateId: telegram.lastUpdateId,
        ready: telegramReady,
      },
      discord: {
        config: buildRuntimeSignature({
          enabled: discord.enabled,
          token: discordToken,
          projectId: resolvedDiscordProjectId,
          scopeType: mainSubModeEnabled ? "main" : "project",
          userIds: discordOwnerUserIds,
          serverIds: discordServerIds,
          channelIds: discordChannelIds,
        }),
        ready: discordReady,
      },
      feishu: {
        config: buildRuntimeSignature({
          enabled: feishu.enabled,
          token: feishuToken,
          projectId: resolvedFeishuProjectId,
          scopeType: mainSubModeEnabled ? "main" : "project",
          userIds: feishuOwnerUserIds,
        }),
        ready: feishuReady,
      },
      weixin: {
        config: buildRuntimeSignature({
          enabled: weixin.enabled,
          token: weixin.accountId ?? "",
          projectId: resolvedWeixinProjectId,
          scopeType: mainSubModeEnabled ? "main" : "project",
          userIds: [],
        }),
      },
    });
    if (runtimeSignature === nextSignature) {
      logger.info("Chat channel refresh skipped: runtime signature unchanged", {
        feishuReady,
      });
      return;
    }

    const wasTelegramRunning = running;
    const previousDiscordRuntime = discordRuntime;
    const previousFeishuRuntime = feishuRuntime;

    stopTelegramService();
    stopDiscordPolling();
    stopDiscordGatewayConnection();
    stopFeishuPolling();
    discordPolling = false;
    feishuPolling = false;

    if (telegramReady) {
      const telegramBotProfile = await fetchTelegramBotProfile(token);
      startPolling({
        token,
        scope: resolveScope(resolvedTelegramProjectId),
        projectId: resolvedTelegramProjectId,
        ownerUserIds: telegramOwnerUserIds,
        botUserId: telegramBotProfile.id,
        botUsername: telegramBotProfile.username,
        lastUpdateId: telegram.lastUpdateId,
      });
    } else if (wasTelegramRunning) {
      logger.info("Telegram chat channel stopped");
    }

    if (discordReady) {
      discordGuildIdByChannel = new Map<string, string | null>();
      discordChannelDisplayNameByChannel = new Map<string, string | null>();
      const allowedServerIdSet = new Set(discordServerIds);
      const activeDiscordChats = new Set<string>();
      for (const channelId of discordChannelIds) {
        try {
          const guildId = await resolveDiscordChannelGuildId(
            discordToken,
            channelId,
          );
          // guildId is null for DM channels — allow them if explicitly configured
          if (guildId && !allowedServerIdSet.has(guildId)) {
            logger.warn(
              "Discord channel is outside configured server whitelist",
              {
                channelId,
                guildId,
              },
            );
            continue;
          }
          activeDiscordChats.add(channelId);
        } catch (error) {
          logger.warn("Failed to resolve Discord channel scope", {
            channelId,
            error,
          });
        }
      }
      if (activeDiscordChats.size === 0) {
        logger.warn(
          "Discord chat channel disabled because no configured channel matches server whitelist",
          {
            serverWhitelistSize: discordServerIds.length,
            channelWhitelistSize: discordChannelIds.length,
          },
        );
        if (previousDiscordRuntime) {
          logger.info("Discord chat channel stopped");
        }
        discordRuntime = null;
        discordLastMessageIdByChat = new Map<string, string>();
        discordGuildIdByChannel = new Map<string, string | null>();
        discordChannelDisplayNameByChannel = new Map<string, string | null>();
      } else {
        const discordBotProfile = await fetchDiscordBotProfile(discordToken);
        discordRuntime = {
          provider: "discord",
          token: discordToken,
          projectId: resolvedDiscordProjectId,
          scope: resolveScope(resolvedDiscordProjectId),
          ownerUserIds: new Set(discordOwnerUserIds),
          botUserId: discordBotProfile.id,
          allowedServerIds: new Set(discordServerIds),
          allowedChannelIds: new Set(discordChannelIds),
          activeChatIds: activeDiscordChats,
        };
        await bootstrapDiscordOffsets(discordRuntime);
        startDiscordGatewayConnection(discordToken);
        scheduleDiscordPoll(0);
        if (
          !previousDiscordRuntime ||
          previousDiscordRuntime.token !== discordRuntime.token ||
          previousDiscordRuntime.projectId !== discordRuntime.projectId ||
          JSON.stringify(
            Array.from(previousDiscordRuntime.ownerUserIds).sort(),
          ) !== JSON.stringify(Array.from(discordRuntime.ownerUserIds).sort()) ||
          JSON.stringify(
            Array.from(previousDiscordRuntime.allowedServerIds).sort(),
          ) !==
            JSON.stringify(
              Array.from(discordRuntime.allowedServerIds).sort(),
            ) ||
          JSON.stringify(
            Array.from(previousDiscordRuntime.allowedChannelIds).sort(),
          ) !==
            JSON.stringify(Array.from(discordRuntime.allowedChannelIds).sort())
        ) {
          logger.info("Discord chat channel started", {
            projectId: discordRuntime.projectId,
            ownerWhitelistSize: discordRuntime.ownerUserIds.size,
            serverWhitelistSize: discordRuntime.allowedServerIds.size,
            channelWhitelistSize: discordRuntime.allowedChannelIds.size,
            activeChatSize: discordRuntime.activeChatIds.size,
          });
        }
      }
    } else {
      if (previousDiscordRuntime) {
        logger.info("Discord chat channel stopped");
      }
      stopDiscordGatewayConnection();
      discordRuntime = null;
      discordLastMessageIdByChat = new Map<string, string>();
      discordGuildIdByChannel = new Map<string, string | null>();
      discordChannelDisplayNameByChannel = new Map<string, string | null>();
    }

    if (feishuReady) {
      feishuChatDisplayNameByChat = new Map<string, string | null>();
      feishuUserDisplayNameByUser = new Map<string, string | null>();
      feishuRuntime = {
        provider: "feishu",
        token: feishuToken,
        projectId: resolvedFeishuProjectId,
        scope: resolveScope(resolvedFeishuProjectId),
        ownerUserIds: new Set(feishuOwnerUserIds),
        activeChatIds: new Set(),
      };
      void syncFeishuActiveChats(feishuRuntime, { force: true }).catch(
        (error) => {
          logger.warn("Failed to sync Feishu active chats on startup", {
            projectId: feishuRuntime?.projectId,
            error,
          });
        },
      );
      startFeishuWebSocket(feishuRuntime);
      if (
        !previousFeishuRuntime ||
        previousFeishuRuntime.token !== feishuRuntime.token ||
        previousFeishuRuntime.projectId !== feishuRuntime.projectId ||
        JSON.stringify(
          Array.from(previousFeishuRuntime.ownerUserIds).sort(),
        ) !== JSON.stringify(Array.from(feishuRuntime.ownerUserIds).sort())
      ) {
        logger.info("Feishu chat channel started", {
          projectId: feishuRuntime.projectId,
          ownerWhitelistSize: feishuRuntime.ownerUserIds.size,
          activeChatSize: feishuRuntime.activeChatIds.size,
        });
      }
    } else {
      logger.warn("Feishu chat channel is not ready and will stay stopped", {
        reasons: feishuNotReadyReasons,
        enabled: feishu.enabled,
        configured: feishu.configured,
        projectId: resolvedFeishuProjectId,
      });
      if (previousFeishuRuntime) {
        logger.info("Feishu chat channel stopped");
      }
      feishuRuntime = null;
      feishuLastMessageTsByChat = new Map<string, number>();
      feishuLastChatSyncAt = 0;
      feishuChatDisplayNameByChat = new Map<string, string | null>();
      feishuUserDisplayNameByUser = new Map<string, string | null>();
      clearFeishuTenantTokenCache();
    }

    runtimeSignature = nextSignature;
  },

  stop(): void {
    stopService();
  },

  async mirrorAgentUserMessage(input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
    message: string;
    attachments?: ChatAttachmentDTO[];
  }): Promise<void> {
    const telegramState = running && runtime ? runtime : null;
    const discordState = discordRuntime;
    const feishuState = feishuRuntime;
    if (!telegramState && !discordState && !feishuState) return;

    const messageText = formatAgentUserMirrorMessage(input);
    if (telegramState) {
      try {
        await broadcastTelegramMessage(telegramState, messageText);
      } catch (error) {
        logger.warn("Failed to mirror agent user message to telegram", {
          sessionId: input.sessionId,
          projectId: input.projectId,
          error,
        });
      }
    }
    if (discordState) {
      try {
        await broadcastDiscordMessage(discordState, messageText);
      } catch (error) {
        logger.warn("Failed to mirror agent user message to Discord", {
          sessionId: input.sessionId,
          projectId: input.projectId,
          error,
        });
      }
    }
    if (feishuState) {
      try {
        await broadcastFeishuMessage(feishuState, messageText);
      } catch (error) {
        logger.warn("Failed to mirror agent user message to Feishu", {
          sessionId: input.sessionId,
          projectId: input.projectId,
          error,
        });
      }
    }
  },

  async mirrorAgentAssistantMessage(input: {
    projectId: string;
    module: ChatModuleType;
    sessionId: string;
    message: string;
    isError?: boolean;
    streamEvents?: ChatStreamEvent[];
    toolActions?: string[];
    toolCalls?: TelegramToolCallSummary[];
  }): Promise<void> {
    const telegramState = running && runtime ? runtime : null;
    const discordState = discordRuntime;
    const feishuState = feishuRuntime;
    if (!telegramState && !discordState && !feishuState) return;

    const normalizedInput = {
      ...input,
      isError: Boolean(input.isError),
    };
    if (telegramState) {
      try {
        await broadcastTelegramAssistantMessage(telegramState, normalizedInput);
      } catch (error) {
        logger.warn("Failed to mirror agent assistant message to telegram", {
          sessionId: input.sessionId,
          projectId: input.projectId,
          error,
        });
      }
    }
    if (discordState) {
      try {
        await broadcastDiscordAssistantMessage(discordState, normalizedInput);
      } catch (error) {
        logger.warn("Failed to mirror agent assistant message to Discord", {
          sessionId: input.sessionId,
          projectId: input.projectId,
          error,
        });
      }
    }
    if (feishuState) {
      try {
        await broadcastFeishuAssistantMessage(feishuState, normalizedInput);
      } catch (error) {
        logger.warn("Failed to mirror agent assistant message to Feishu", {
          sessionId: input.sessionId,
          projectId: input.projectId,
          error,
        });
      }
    }
  },
};
