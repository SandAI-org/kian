import {
  createWeixinAdapterClient,
  type WeixinAdapterClient,
  type WeixinInboundMessage,
  type WeixinQrLoginSession,
} from "@kian/weixin-adapter";
import type {
  ChatScope,
  WeixinChatChannelAccountDTO,
  WeixinChatChannelQrSessionDTO,
  WeixinChatChannelStatus,
  WeixinQrLoginResultDTO,
} from "@shared/types";
import { logger } from "../logger";
import { settingsService } from "../settingsService";

interface WeixinRuntimeContext {
  scope: ChatScope;
  projectId: string;
  activeAccountId: string;
  polling: boolean;
}

interface WeixinChannelHooks {
  onMessage?: (message: WeixinInboundMessage) => Promise<void> | void;
}

let hooks: WeixinChannelHooks = {};
let client: WeixinAdapterClient | null = null;
let clientUnsubscribers: Array<() => void> = [];
let runtimeContext: WeixinRuntimeContext | null = null;
let refreshSignature = "";
let qrSession: WeixinChatChannelQrSessionDTO | null = null;
let lastError: string | null = null;

const normalizeOptionalString = (value: string | null | undefined): string =>
  value?.trim() ?? "";

const isWeixinQrLandingUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      /^https?:$/i.test(url.protocol) &&
      url.hostname === "liteapp.weixin.qq.com" &&
      url.pathname.startsWith("/q/")
    );
  } catch {
    return false;
  }
};

const normalizeQrCodeImageSrc = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (isWeixinQrLandingUrl(trimmed)) {
    return "";
  }
  if (/^(?:data:image\/|blob:|https?:\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  return `data:image/png;base64,${trimmed.replace(/\s+/g, "")}`;
};

const normalizeQrCodeValue = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return isWeixinQrLandingUrl(trimmed) ? trimmed : "";
};

const toAccountDTO = (account: {
  accountId: string;
  rawAccountId: string;
  userId?: string;
  savedAt: string;
}): WeixinChatChannelAccountDTO => ({
  accountId: account.accountId,
  rawAccountId: account.rawAccountId,
  userId: account.userId,
  savedAt: account.savedAt,
});

const toQrSessionDTO = (
  session: WeixinQrLoginSession,
): WeixinChatChannelQrSessionDTO => ({
  sessionKey: session.sessionKey,
  qrCodeUrl: normalizeOptionalString(session.qrCodeUrl),
  qrCodeImageSrc: normalizeQrCodeImageSrc(session.qrCodeUrl),
  qrCodeValue: normalizeQrCodeValue(session.qrCodeUrl),
  startedAt: new Date(session.startedAt).toISOString(),
  expiresAt: new Date(session.expiresAt).toISOString(),
});

const resolveActiveAccountId = (
  accountId: string | null,
  accounts: WeixinChatChannelAccountDTO[],
): string | null => {
  const normalizedAccountId = normalizeOptionalString(accountId);
  if (
    normalizedAccountId &&
    accounts.some((item) => item.accountId === normalizedAccountId)
  ) {
    return normalizedAccountId;
  }
  if (!normalizedAccountId && accounts.length === 1) {
    return accounts[0].accountId;
  }
  return null;
};

const detachClient = async (): Promise<void> => {
  clientUnsubscribers.forEach((unsubscribe) => unsubscribe());
  clientUnsubscribers = [];
  if (client) {
    await client.stopAllPolling().catch((error) => {
      logger.warn("Failed to stop Weixin polling while resetting client", {
        error,
      });
    });
  }
  client = null;
  runtimeContext = null;
  refreshSignature = "";
};

const bindClient = (nextClient: WeixinAdapterClient): void => {
  clientUnsubscribers = [
    nextClient.on("message", (message) => {
      lastError = null;
      Promise.resolve(hooks.onMessage?.(message)).catch((error) => {
        logger.error("Weixin inbound message handler failed", {
          accountId: message.accountId,
          fromUserId: message.fromUserId,
          error,
        });
      });
    }),
    nextClient.on("status", (event) => {
      if (
        runtimeContext &&
        runtimeContext.activeAccountId === event.accountId &&
        (event.type === "polling-started" ||
          event.type === "poll-success" ||
          event.type === "polling-stopped")
      ) {
        runtimeContext = {
          ...runtimeContext,
          polling: event.type !== "polling-stopped",
        };
      }
      if (event.type === "qr-login-confirmed") {
        qrSession = null;
        lastError = null;
      }
    }),
    nextClient.on("error", (event) => {
      lastError = event.error.message;
      logger.error("Weixin polling failed", {
        accountId: event.accountId,
        error: event.error,
      });
    }),
  ];
};

const ensureClient = async (): Promise<WeixinAdapterClient> => {
  if (client) {
    return client;
  }

  await detachClient();

  const nextClient = createWeixinAdapterClient();
  bindClient(nextClient);
  client = nextClient;
  return nextClient;
};

const getStatusSnapshot = async (): Promise<{
  enabled: boolean;
  accountId: string;
  activeAccountId: string | null;
  availableAccounts: WeixinChatChannelAccountDTO[];
  polling: boolean;
}> => {
  const config = await settingsService.getWeixinChatChannelRuntime();
  const currentClient = await ensureClient();
  const availableAccounts = (await currentClient.listAccounts()).map(toAccountDTO);
  const activeAccountId = resolveActiveAccountId(
    config.accountId,
    availableAccounts,
  );

  return {
    enabled: config.enabled,
    accountId: config.accountId ?? "",
    activeAccountId,
    availableAccounts,
    polling:
      Boolean(runtimeContext) &&
      runtimeContext?.activeAccountId === activeAccountId
        ? runtimeContext.polling
        : false,
  };
};

export const weixinChannelService = {
  configure(nextHooks: WeixinChannelHooks): void {
    hooks = {
      ...hooks,
      ...nextHooks,
    };
  },

  async getStatus(): Promise<WeixinChatChannelStatus> {
    const snapshot = await getStatusSnapshot();
    return {
      provider: "weixin",
      enabled: snapshot.enabled,
      configured: Boolean(snapshot.activeAccountId),
      accountId: snapshot.accountId,
      activeAccountId: snapshot.activeAccountId,
      availableAccounts: snapshot.availableAccounts,
      polling: snapshot.polling,
      qrSession,
      lastError,
    };
  },

  getRuntimeContext(): WeixinRuntimeContext | null {
    return runtimeContext;
  },

  async refresh(input: {
    scope: ChatScope;
    projectId: string;
  }): Promise<void> {
    const snapshot = await getStatusSnapshot();
    const nextSignature = JSON.stringify({
      enabled: snapshot.enabled,
      accountId: snapshot.accountId,
      activeAccountId: snapshot.activeAccountId,
      scopeType: input.scope.type,
      scopeProjectId: input.scope.type === "project" ? input.scope.projectId : "",
      projectId: input.projectId,
    });

    if (refreshSignature === nextSignature) {
      return;
    }

    refreshSignature = nextSignature;

    const currentClient = await ensureClient();
    await currentClient.stopAllPolling();

    if (!snapshot.enabled || !snapshot.activeAccountId) {
      if (runtimeContext) {
        logger.info("Weixin chat channel stopped", {
          accountId: runtimeContext.activeAccountId,
        });
      }
      runtimeContext = null;
      return;
    }

    runtimeContext = {
      scope: input.scope,
      projectId: input.projectId,
      activeAccountId: snapshot.activeAccountId,
      polling: false,
    };

    await currentClient.startPolling({
      accountId: snapshot.activeAccountId,
    });
    runtimeContext = {
      ...runtimeContext,
      polling: true,
    };
    lastError = null;
    logger.info("Weixin chat channel started", {
      accountId: snapshot.activeAccountId,
      projectId: input.projectId,
      scope: input.scope,
      stateDir: currentClient.accountStore.getStateDir(),
    });
  },

  async stop(): Promise<void> {
    refreshSignature = "";
    if (client) {
      await client.stopAllPolling();
    }
    runtimeContext = null;
  },

  async startQrLogin(input?: {
    forceRefresh?: boolean;
  }): Promise<WeixinChatChannelQrSessionDTO> {
    const currentClient = await ensureClient();
    const session = await currentClient.startQrLogin({
      forceRefresh: input?.forceRefresh,
    });
    qrSession = toQrSessionDTO(session);
    lastError = null;
    return qrSession;
  },

  async waitForQrLogin(input: {
    sessionKey: string;
    timeoutMs?: number;
  }): Promise<WeixinQrLoginResultDTO> {
    const config = await settingsService.getWeixinChatChannelRuntime();
    const currentClient = await ensureClient();
    const result = await currentClient.waitForQrLogin({
      sessionKey: input.sessionKey,
      timeoutMs: input.timeoutMs,
    });
    const isCurrentSession = qrSession?.sessionKey === input.sessionKey;
    if (isCurrentSession) {
      qrSession = null;
    }

    if (isCurrentSession && result.connected && result.account) {
      await settingsService.saveWeixinChatChannelConfig({
        enabled: config.enabled,
        accountId: result.account.accountId,
      });
    }

    return {
      connected: result.connected,
      status: result.status,
      message: result.message,
      account: result.account ? toAccountDTO(result.account) : undefined,
    };
  },

  async removeAccount(input: {
    accountId: string;
  }): Promise<void> {
    const config = await settingsService.getWeixinChatChannelRuntime();
    const currentClient = await ensureClient();
    await currentClient.removeAccount(input.accountId);
    const remainingAccounts = (await currentClient.listAccounts()).map(toAccountDTO);

    if (normalizeOptionalString(config.accountId) === normalizeOptionalString(input.accountId)) {
      await settingsService.saveWeixinChatChannelConfig({
        enabled: config.enabled,
        accountId: remainingAccounts[0]?.accountId ?? "",
      });
    }

    if (
      runtimeContext &&
      normalizeOptionalString(runtimeContext.activeAccountId) ===
        normalizeOptionalString(input.accountId)
    ) {
      runtimeContext = null;
      refreshSignature = "";
    }

    lastError = null;
  },

  async sendText(input: {
    accountId: string;
    toUserId: string;
    text: string;
    contextToken?: string;
  }): Promise<void> {
    const currentClient = await ensureClient();
    await currentClient.sendText(input);
  },

  async sendMedia(input: {
    accountId: string;
    toUserId: string;
    contextToken?: string;
    filePath?: string;
    remoteUrl?: string;
    fileName?: string;
    text?: string;
  }): Promise<void> {
    const currentClient = await ensureClient();
    await currentClient.sendMedia(input);
  },
};
