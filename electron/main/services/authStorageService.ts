import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { shell } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { logger } from "./logger";
import { GLOBAL_CONFIG_DIR } from "./workspacePaths";

/**
 * Shared persistent credential storage for LLM providers.
 *
 * API keys keep flowing from settings.json through runtime overrides; this
 * storage additionally holds OAuth subscription credentials (Claude Pro/Max,
 * ChatGPT Codex) in ~/.kian/auth.json with pi's file locking and automatic
 * token refresh.
 */
const AUTH_STORAGE_PATH = path.join(GLOBAL_CONFIG_DIR, "auth.json");

let sharedAuthStorage: AuthStorage | null = null;
let authGeneration = 0;

export const getSharedAuthStorage = (): AuthStorage => {
  if (!sharedAuthStorage) {
    sharedAuthStorage = AuthStorage.create(AUTH_STORAGE_PATH);
  }
  return sharedAuthStorage;
};

/**
 * Monotonic counter bumped on OAuth login/logout. Included in the agent
 * session model-config signature so live sessions rebuild after credential
 * identity changes (token refreshes intentionally do not bump it).
 */
export const getAuthGeneration = (): number => authGeneration;

export const OAUTH_SUBSCRIPTION_PROVIDERS = [
  "anthropic",
  "openai-codex",
] as const;

export const isOAuthSubscriptionProvider = (provider: string): boolean =>
  (OAUTH_SUBSCRIPTION_PROVIDERS as readonly string[]).includes(provider);

export const hasOAuthCredential = (provider: string): boolean =>
  getSharedAuthStorage().get(provider)?.type === "oauth";

interface PendingOAuthLogin {
  loginId: string;
  provider: string;
  authUrl?: string;
  submitCode: (code: string) => void;
  abort: () => void;
  completion: Promise<void>;
  timeout: NodeJS.Timeout;
}

const pendingLogins = new Map<string, PendingOAuthLogin>();
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const AUTH_URL_WAIT_MS = 15 * 1000;

const removePendingLogin = (loginId: string): void => {
  const entry = pendingLogins.get(loginId);
  if (!entry) return;
  clearTimeout(entry.timeout);
  pendingLogins.delete(loginId);
};

/**
 * Kick off an interactive OAuth login. Resolves once the provider produced an
 * authorization URL (already opened in the system browser) so the renderer can
 * show it alongside a manual-code fallback. The flow itself keeps running until
 * waitOAuthLogin settles.
 */
export const startOAuthLogin = async (
  provider: string,
): Promise<{ loginId: string; authUrl?: string }> => {
  if (!isOAuthSubscriptionProvider(provider)) {
    throw new Error(`Provider does not support subscription login: ${provider}`);
  }
  for (const pending of [...pendingLogins.values()]) {
    if (pending.provider === provider) {
      pending.abort();
      removePendingLogin(pending.loginId);
    }
  }

  const loginId = randomUUID();
  const controller = new AbortController();

  let resolveAuthUrl!: (url: string | undefined) => void;
  const authUrlPromise = new Promise<string | undefined>((resolve) => {
    resolveAuthUrl = resolve;
  });

  let resolveManualCode!: (code: string) => void;
  let rejectManualCode!: (error: Error) => void;
  const manualCodePromise = new Promise<string>((resolve, reject) => {
    resolveManualCode = resolve;
    rejectManualCode = reject;
  });
  // The manual-code promise races against the provider's local callback
  // server and usually loses; swallow its eventual abort rejection.
  manualCodePromise.catch(() => {});

  let rejectAborted!: (error: Error) => void;
  const abortedPromise = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });
  abortedPromise.catch(() => {});

  const completion = getSharedAuthStorage()
    .login(provider, {
      onAuth: (info) => {
        resolveAuthUrl(info.url);
        void shell.openExternal(info.url).catch((error) => {
          logger.warn("OAuth login: failed to open browser", {
            provider,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
      onDeviceCode: (info) => {
        resolveAuthUrl(info.verificationUri);
      },
      onPrompt: () => manualCodePromise,
      onManualCodeInput: () => manualCodePromise,
      onSelect: async (prompt) => prompt.options[0]?.id,
      onProgress: (message) => {
        logger.info("OAuth login progress", { provider, message });
      },
      signal: controller.signal,
    })
    .then(() => {
      authGeneration += 1;
      logger.info("OAuth login completed", { provider });
    });
  completion.catch((error) => {
    logger.warn("OAuth login failed", {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const abort = (): void => {
    rejectAborted(new Error("登录已取消"));
    rejectManualCode(new Error("登录已取消"));
    resolveAuthUrl(undefined);
    controller.abort();
  };

  const entry: PendingOAuthLogin = {
    loginId,
    provider,
    submitCode: resolveManualCode,
    abort,
    completion: Promise.race([completion, abortedPromise]),
    timeout: setTimeout(() => {
      abort();
      removePendingLogin(loginId);
    }, LOGIN_TIMEOUT_MS),
  };
  entry.completion.catch(() => {});
  pendingLogins.set(loginId, entry);

  // Surface immediate failures (e.g. network errors before the auth URL
  // exists) directly from start instead of leaving the renderer waiting.
  const authUrl = await Promise.race([
    authUrlPromise,
    completion.then(() => undefined),
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), AUTH_URL_WAIT_MS).unref?.(),
    ),
  ]).catch((error) => {
    removePendingLogin(loginId);
    throw error;
  });

  entry.authUrl = authUrl;
  return { loginId, authUrl };
};

/** Await a login started via startOAuthLogin. Returns its provider id. */
export const waitOAuthLogin = async (loginId: string): Promise<string> => {
  const entry = pendingLogins.get(loginId);
  if (!entry) {
    throw new Error("登录会话不存在或已过期");
  }
  try {
    await entry.completion;
  } finally {
    removePendingLogin(loginId);
  }
  return entry.provider;
};

export const submitOAuthLoginCode = (loginId: string, code: string): void => {
  const entry = pendingLogins.get(loginId);
  if (!entry) {
    throw new Error("登录会话不存在或已过期");
  }
  entry.submitCode(code.trim());
};

export const cancelOAuthLogin = (loginId: string): void => {
  const entry = pendingLogins.get(loginId);
  if (!entry) return;
  entry.abort();
  removePendingLogin(loginId);
};

export const oauthLogout = (provider: string): void => {
  getSharedAuthStorage().logout(provider);
  authGeneration += 1;
  logger.info("OAuth logout", { provider });
};
