import { getUpdates, sendMessage } from "../api/api.js";
import type { WeixinApiOptions } from "../api/api.js";
import type { WeixinMessage } from "../api/types.js";
import {
  MessageItemType,
  MessageState,
  MessageType,
} from "../api/types.js";
import type {
  FileWeixinAccountStore,
  SaveWeixinAccountInput,
  WeixinAccountRecord,
} from "../storage/account-store.js";
import { createFileAccountStore } from "../storage/account-store.js";
import { buildContextTokenKey, generateClientId, normalizeAccountId } from "../utils/ids.js";
import type { WeixinAdapterLogger } from "../utils/logger.js";
import { createLogger } from "../utils/logger.js";
import type {
  WeixinQrLoginResult,
  WeixinQrLoginSession,
  StartQrLoginOptions,
  WaitForQrLoginOptions,
} from "../auth/login-qr.js";
import { startQrLogin, waitForQrLogin } from "../auth/login-qr.js";
import type { WeixinInboundMessage } from "../parser/inbound.js";
import { parseInboundMessage } from "../parser/inbound.js";
import { downloadInboundMedia } from "../media/download.js";
import {
  sendMedia as sendMediaImpl,
  uploadLocalFile as uploadLocalFileImpl,
} from "../media/upload.js";
import { transcodeVoiceIfNeeded } from "../media/transcode.js";
import { redactToken } from "../utils/redact.js";
import { TypedEventEmitter } from "./events.js";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;

export interface WeixinStatusEvent {
  type:
    | "polling-started"
    | "polling-stopped"
    | "poll-success"
    | "qr-login-confirmed";
  accountId: string;
  at: number;
  messageCount?: number;
  reason?: string;
}

export interface WeixinErrorEvent {
  accountId: string;
  error: Error;
  at: number;
}

export interface WeixinRawEvent {
  accountId: string;
  raw: WeixinMessage;
}

export interface WeixinAdapterEvents {
  message: WeixinInboundMessage;
  status: WeixinStatusEvent;
  error: WeixinErrorEvent;
  raw: WeixinRawEvent;
}

export interface CreateWeixinAdapterClientOptions {
  stateDir?: string;
  logger?: WeixinAdapterLogger;
  accountStore?: FileWeixinAccountStore;
}

export interface StartPollingOptions {
  accountId: string;
  signal?: AbortSignal;
  longPollTimeoutMs?: number;
  retryDelayMs?: number;
}

export interface SendTextOptions {
  accountId: string;
  toUserId: string;
  text: string;
  contextToken?: string;
}

export interface UploadLocalFileOptions {
  accountId: string;
  filePath: string;
  toUserId: string;
  fileName?: string;
}

export interface SendMediaOptions {
  accountId: string;
  toUserId: string;
  contextToken?: string;
  filePath?: string;
  remoteUrl?: string;
  fileName?: string;
  text?: string;
}

type PollingSession = {
  abortController: AbortController;
  promise: Promise<void>;
};

export class WeixinAdapterClient extends TypedEventEmitter<WeixinAdapterEvents> {
  readonly accountStore: FileWeixinAccountStore;

  private readonly logger: WeixinAdapterLogger;
  private readonly pollingSessions = new Map<string, PollingSession>();
  private readonly contextTokens = new Map<string, string>();

  constructor(options: CreateWeixinAdapterClientOptions = {}) {
    super();
    this.logger = options.logger ?? createLogger();
    this.accountStore =
      options.accountStore ??
      createFileAccountStore({
        logger: this.logger,
        ...(options.stateDir ? { stateDir: options.stateDir } : {}),
      });
  }

  async startQrLogin(options?: StartQrLoginOptions): Promise<WeixinQrLoginSession> {
    return startQrLogin(options);
  }

  async waitForQrLogin(options: WaitForQrLoginOptions): Promise<WeixinQrLoginResult> {
    const result = await waitForQrLogin({
      ...options,
      accountStore: options.accountStore ?? this.accountStore,
      logger: options.logger ?? this.logger,
    });

    if (result.connected && result.account) {
      this.emit("status", {
        type: "qr-login-confirmed",
        accountId: result.account.accountId,
        at: Date.now(),
      });
    }

    return result;
  }

  async saveAccount(input: SaveWeixinAccountInput): Promise<WeixinAccountRecord> {
    return this.accountStore.saveAccount(input);
  }

  async loadAccount(accountId: string): Promise<WeixinAccountRecord | null> {
    return this.accountStore.loadAccount(accountId);
  }

  async listAccounts(): Promise<WeixinAccountRecord[]> {
    return this.accountStore.listAccounts();
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.stopPolling(accountId);
    await this.accountStore.removeAccount(accountId);
  }

  async startPolling(options: StartPollingOptions): Promise<void> {
    const accountId = normalizeAccountId(options.accountId);
    if (this.pollingSessions.has(accountId)) {
      return;
    }

    const account = await this.accountStore.loadAccount(accountId);
    if (!account) {
      throw new Error(`account ${accountId} not found`);
    }

    const abortController = new AbortController();
    const externalSignal = options.signal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        abortController.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener("abort", () => abortController.abort(externalSignal.reason), {
          once: true,
        });
      }
    }

    const promise = this.runPollingLoop(account, {
      signal: abortController.signal,
      ...(typeof options.longPollTimeoutMs === "number"
        ? { longPollTimeoutMs: options.longPollTimeoutMs }
        : {}),
      ...(typeof options.retryDelayMs === "number"
        ? { retryDelayMs: options.retryDelayMs }
        : {}),
    }).finally(() => {
      this.pollingSessions.delete(accountId);
    });

    this.pollingSessions.set(accountId, { abortController, promise });
  }

  async stopPolling(accountId: string): Promise<void> {
    const normalizedAccountId = normalizeAccountId(accountId);
    const polling = this.pollingSessions.get(normalizedAccountId);
    if (!polling) {
      return;
    }

    polling.abortController.abort();
    await polling.promise.catch(() => undefined);
  }

  async stopAllPolling(): Promise<void> {
    await Promise.all([...this.pollingSessions.keys()].map((accountId) => this.stopPolling(accountId)));
  }

  async sendText(options: SendTextOptions): Promise<{ messageId: string }> {
    const accountId = normalizeAccountId(options.accountId);
    const account = await this.accountStore.loadAccount(accountId);
    if (!account) {
      throw new Error(`account ${accountId} not found`);
    }

    const contextToken =
      options.contextToken?.trim() ||
      this.contextTokens.get(buildContextTokenKey(accountId, options.toUserId));

    if (!contextToken) {
      throw new Error(
        `contextToken is required for account ${accountId} and user ${options.toUserId}`,
      );
    }

    const clientId = generateClientId();
    await sendMessage(
      {
        msg: {
          from_user_id: "",
          to_user_id: options.toUserId,
          client_id: clientId,
          message_type: MessageType.BOT,
          message_state: MessageState.FINISH,
          context_token: contextToken,
          item_list: [
            {
              type: MessageItemType.TEXT,
              text_item: { text: options.text },
            },
          ],
        },
      },
      {
        baseUrl: account.baseUrl,
        token: account.token,
      },
    );

    this.logger.debug(
      `sent text message account=${accountId} to=${options.toUserId} token=${redactToken(contextToken)}`,
    );
    return { messageId: clientId };
  }

  async uploadLocalFile(
    options: UploadLocalFileOptions,
  ): Promise<ReturnType<typeof uploadLocalFileImpl>> {
    const accountId = normalizeAccountId(options.accountId);
    const account = await this.accountStore.loadAccount(accountId);
    if (!account) {
      throw new Error(`account ${accountId} not found`);
    }

    return uploadLocalFileImpl({
      filePath: options.filePath,
      toUserId: options.toUserId,
      apiOptions: {
        baseUrl: account.baseUrl,
        token: account.token,
      },
      cdnBaseUrl: account.cdnBaseUrl,
      logger: this.logger,
      ...(options.fileName ? { fileName: options.fileName } : {}),
    });
  }

  async sendMedia(
    options: SendMediaOptions,
  ): Promise<ReturnType<typeof sendMediaImpl>> {
    const accountId = normalizeAccountId(options.accountId);
    const account = await this.accountStore.loadAccount(accountId);
    if (!account) {
      throw new Error(`account ${accountId} not found`);
    }

    const contextToken =
      options.contextToken?.trim() ||
      this.contextTokens.get(buildContextTokenKey(accountId, options.toUserId));

    if (!contextToken) {
      throw new Error(
        `contextToken is required for account ${accountId} and user ${options.toUserId}`,
      );
    }

    return sendMediaImpl({
      toUserId: options.toUserId,
      contextToken,
      apiOptions: {
        baseUrl: account.baseUrl,
        token: account.token,
      },
      cdnBaseUrl: account.cdnBaseUrl,
      logger: this.logger,
      ...(options.filePath ? { filePath: options.filePath } : {}),
      ...(options.remoteUrl ? { remoteUrl: options.remoteUrl } : {}),
      ...(options.fileName ? { fileName: options.fileName } : {}),
      ...(options.text ? { text: options.text } : {}),
    });
  }

  async downloadInboundMedia(
    ...parameters: Parameters<typeof downloadInboundMedia>
  ): Promise<ReturnType<typeof downloadInboundMedia>> {
    return downloadInboundMedia(...parameters);
  }

  async transcodeVoiceIfNeeded(
    ...parameters: Parameters<typeof transcodeVoiceIfNeeded>
  ): Promise<ReturnType<typeof transcodeVoiceIfNeeded>> {
    return transcodeVoiceIfNeeded(...parameters);
  }

  private async runPollingLoop(
    account: WeixinAccountRecord,
    options: {
      signal: AbortSignal;
      longPollTimeoutMs?: number;
      retryDelayMs?: number;
    },
  ): Promise<void> {
    const apiOptions: WeixinApiOptions = {
      baseUrl: account.baseUrl,
      token: account.token,
      timeoutMs: options.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
    };
    let cursor = await this.accountStore.loadSyncBuffer(account.accountId);
    let nextTimeoutMs = options.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    this.emit("status", {
      type: "polling-started",
      accountId: account.accountId,
      at: Date.now(),
    });

    while (!options.signal.aborted) {
      try {
        const response = await getUpdates(
          { get_updates_buf: cursor ?? "" },
          { ...apiOptions, timeoutMs: nextTimeoutMs },
        );

        const isApiError =
          (response.ret !== undefined && response.ret !== 0) ||
          (response.errcode !== undefined && response.errcode !== 0);

        if (isApiError) {
          throw new Error(
            `getUpdates failed: ret=${response.ret ?? 0} errcode=${response.errcode ?? 0} errmsg=${response.errmsg ?? ""}`,
          );
        }

        if (typeof response.longpolling_timeout_ms === "number" && response.longpolling_timeout_ms > 0) {
          nextTimeoutMs = response.longpolling_timeout_ms;
        }

        if (typeof response.get_updates_buf === "string") {
          cursor = response.get_updates_buf;
          await this.accountStore.saveSyncBuffer(account.accountId, response.get_updates_buf);
        }

        const messages = response.msgs ?? [];
        this.emit("status", {
          type: "poll-success",
          accountId: account.accountId,
          at: Date.now(),
          messageCount: messages.length,
        });

        for (const rawMessage of messages) {
          this.emit("raw", { accountId: account.accountId, raw: rawMessage });

          const parsedMessage = parseInboundMessage(rawMessage, account.accountId);
          if (!parsedMessage) {
            continue;
          }

          if (parsedMessage.contextToken) {
            this.contextTokens.set(
              buildContextTokenKey(account.accountId, parsedMessage.fromUserId),
              parsedMessage.contextToken,
            );
          }

          this.emit("message", parsedMessage);
        }
      } catch (error) {
        if (options.signal.aborted) {
          break;
        }

        const normalizedError = error instanceof Error ? error : new Error(String(error));
        this.emit("error", {
          accountId: account.accountId,
          error: normalizedError,
          at: Date.now(),
        });
        this.logger.error(
          `polling error account=${account.accountId}: ${normalizedError.message}`,
        );
        await sleep(retryDelayMs, options.signal);
      }
    }

    this.emit("status", {
      type: "polling-stopped",
      accountId: account.accountId,
      at: Date.now(),
      reason: options.signal.aborted ? "aborted" : "completed",
    });
  }
}

export function createWeixinAdapterClient(
  options?: CreateWeixinAdapterClientOptions,
): WeixinAdapterClient {
  return new WeixinAdapterClient(options);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
