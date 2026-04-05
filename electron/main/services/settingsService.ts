import { getModel, getModels, getProviders, type Api, type Model } from "@mariozechner/pi-ai";
import type {
  AgentModelDTO,
  AgentProviderDTO,
  BroadcastChannelDTO,
  ChatSessionKind,
  ChatScope,
  ChatThinkingLevel,
  ClaudeConfigStatus,
  DiscordChatChannelStatus,
  FeishuChatChannelStatus,
  GeneralConfigDTO,
  LinkOpenMode,
  ShortcutConfigDTO,
  McpServerDTO,
  McpTransportType,
  MediaProvider,
  ModelProviderConfigStatus,
  ProviderConfigEntry,
  TelegramChatChannelStatus,
  CustomAgentModelConfigDTO,
} from "@shared/types";
import {
  DEFAULT_APP_LANGUAGE,
  isAppLanguage,
  type AppLanguage,
} from "@shared/i18n";
import {
  DEFAULT_APP_THEME_MODE,
  isAppThemeMode,
  type AppThemeMode,
} from "@shared/theme";
import { normalizeUtcTimestamp } from "@shared/utils/dateTime";
import { normalizeShortcutConfig } from "@shared/utils/shortcuts";
import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { chatChannelOwnerDiscoveryService } from "./chatChannelOwnerDiscoveryService";
import { FAL_SUPPORTED_MODELS } from "./modelProviders/falProvider";
import { logger } from "./logger";
import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH, INTERNAL_ROOT, WORKSPACE_ROOT } from "./workspacePaths";

const SETTINGS_PATH = path.join(INTERNAL_ROOT, "settings.json");
const LEGACY_WORKSPACE_SETTINGS_PATH = path.join(WORKSPACE_ROOT, "settings.json");
const CUSTOM_API_PROVIDER = "custom-api";
const CUSTOM_API_PROVIDER_PREFIX = "custom-api__";
const LEGACY_OPENAI_COMPATIBLE_PROVIDER = "openai-compatible";

const normalizeAgentProviderId = (provider: string): string =>
  provider === LEGACY_OPENAI_COMPATIBLE_PROVIDER
    ? CUSTOM_API_PROVIDER
    : provider;

const isCustomAgentProviderId = (provider: string): boolean => {
  const normalized = normalizeAgentProviderId(provider);
  return (
    normalized === CUSTOM_API_PROVIDER ||
    normalized.startsWith(CUSTOM_API_PROVIDER_PREFIX)
  );
};

const toProviderDisplayName = (providerId: string): string =>
  providerId
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

const getDefaultCustomProviderDisplayName = (providerId: string): string =>
  providerId === CUSTOM_API_PROVIDER ? "Custom API" : "Custom Provider";

interface ProviderEntry {
  provider: string;
  displayName?: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  api?: string;
  customModels: CustomAgentModelConfigDTO[];
  enabledModels: string[];
}

interface TelegramChatChannelSettings {
  enabled: boolean;
  botToken: string;
  ownerUserIds: string[];
  lastUpdateId: number;
}

interface DiscordChatChannelSettings {
  enabled: boolean;
  botToken: string;
  ownerUserIds: string[];
  serverIds: string[];
  channelIds: string[];
}

interface BotChatChannelSettings {
  enabled: boolean;
  ownerUserIds: string[];
}

interface FeishuChatChannelSettings extends BotChatChannelSettings {
  appId: string;
  appSecret: string;
}

interface WeixinChatChannelSettings {
  enabled: boolean;
  accountId: string;
}

interface BroadcastChannelSettings {
  id: string;
  name: string;
  type: "feishu" | "wechat";
  webhook: string;
}

interface McpServerSettings {
  id: string;
  name: string;
  transport: McpTransportType;
  enabled: boolean;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface LegacyTelegramChatChannelSettings extends Partial<TelegramChatChannelSettings> {
  projectId?: string;
  userId?: string;
  userIds?: string[];
}

interface LegacyDiscordChatChannelSettings extends Partial<DiscordChatChannelSettings> {
  projectId?: string;
  userId?: string;
  userIds?: string[];
  serverId?: string;
  channelId?: string;
}

interface LegacyBotChatChannelSettings extends Partial<BotChatChannelSettings> {
  projectId?: string;
  userId?: string;
  userIds?: string[];
}

interface LegacyBroadcastChannelSettings {
  enabled?: boolean;
  feishuWebhook?: string;
}

interface SettingsFile {
  providers: ProviderEntry[];
  mediaProviders: ProviderEntry[];
  lastSelectedModel?: string;
  lastSelectedThinkingLevel?: ChatThinkingLevel;
  lastSelectedModelByScope: Record<string, string>;
  lastSelectedThinkingLevelByScope: Record<string, ChatThinkingLevel>;
  shortcuts: ShortcutConfigDTO;
  mcpServers: McpServerSettings[];
  chatChannels: {
    telegram: TelegramChatChannelSettings;
    discord: DiscordChatChannelSettings;
    feishu: FeishuChatChannelSettings;
    weixin: WeixinChatChannelSettings;
    broadcastChannels: BroadcastChannelSettings[];
  };
}

interface LegacySettingsFile {
  providers?: ProviderEntry[];
  mediaProviders?: ProviderEntry[];
  lastSelectedModel?: string;
  defaultProvider?: unknown;
  defaultModel?: unknown;
  lastSelectedThinkingLevel?: unknown;
  lastSelectedModelByScope?: unknown;
  lastSelectedThinkingLevelByScope?: unknown;
  shortcuts?: unknown;
  mcpServers?: unknown;
  chatChannels?: {
    telegram?: LegacyTelegramChatChannelSettings;
    discord?: LegacyDiscordChatChannelSettings;
    feishu?: LegacyBotChatChannelSettings & { appId?: string; appSecret?: string };
    weixin?: Partial<WeixinChatChannelSettings>;
    broadcastChannels?: unknown;
    broadcast?: LegacyBroadcastChannelSettings;
  };
}

const DEFAULT_FAL_ENABLED_MODELS = FAL_SUPPORTED_MODELS.map(
  (item) => item.modelId,
);
const DEFAULT_TELEGRAM_CHAT_CHANNEL: TelegramChatChannelSettings = {
  enabled: false,
  botToken: "",
  ownerUserIds: [],
  lastUpdateId: 0,
};
const DEFAULT_DISCORD_CHAT_CHANNEL: DiscordChatChannelSettings = {
  enabled: false,
  botToken: "",
  ownerUserIds: [],
  serverIds: [],
  channelIds: [],
};
const DEFAULT_FEISHU_CHAT_CHANNEL: FeishuChatChannelSettings = {
  enabled: false,
  ownerUserIds: [],
  appId: "",
  appSecret: "",
};
const DEFAULT_WEIXIN_CHAT_CHANNEL: WeixinChatChannelSettings = {
  enabled: false,
  accountId: "",
};
const DEFAULT_BROADCAST_CHANNELS: BroadcastChannelSettings[] = [];
const DEFAULT_GENERAL_CONFIG_FLAGS = {
  language: DEFAULT_APP_LANGUAGE,
  themeMode: DEFAULT_APP_THEME_MODE,
  linkOpenMode: "builtin" as LinkOpenMode,
  quickGuideDismissed: false,
  chatInputShortcutTipDismissed: false,
} as const;

const defaultSystemPromptCache = new Map<string, string>();
const MAIN_SCOPE_SETTINGS_KEY = "main";

const getSettingsScopeKey = (scope: ChatScope = { type: "main" }): string =>
  scope.type === "main"
    ? MAIN_SCOPE_SETTINGS_KEY
    : `project:${scope.projectId}`;

const readBundledPromptFile = async (fileName: string): Promise<string> => {
  const cachedPrompt = defaultSystemPromptCache.get(fileName);
  if (cachedPrompt !== undefined) {
    return cachedPrompt;
  }

  const promptPath = path.join(app.getAppPath(), fileName);
  const prompt = await fs.readFile(promptPath, "utf8");
  defaultSystemPromptCache.set(fileName, prompt);
  return prompt;
};

const uniqueStrings = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const values = input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return Array.from(new Set(values));
};

const uniqueTelegramUserIds = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const values = input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return Array.from(new Set(values));
};

const parseLegacyTelegramUserIds = (input: unknown): string[] => {
  if (typeof input !== "string") return [];
  const values = input
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && /^\d+$/.test(item));
  return Array.from(new Set(values));
};

const parseLegacyUserIds = (input: unknown): string[] => {
  if (typeof input !== "string") return [];
  const values = input
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set(values));
};

const uniqueDiscordSnowflakeIds = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const values = input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return Array.from(new Set(values));
};

const parseLegacyDiscordSnowflakeIds = (input: unknown): string[] => {
  if (typeof input !== "string") return [];
  const values = input
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && /^\d+$/.test(item));
  return Array.from(new Set(values));
};

const normalizeSecretValue = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeOptionalHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return normalized;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const normalizeChatThinkingLevel = (
  value: unknown,
): ChatThinkingLevel | undefined => {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return undefined;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeModelSelectionMap = (
  value: unknown,
): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).reduce<Array<[string, string]>>((acc, [key, item]) => {
      const normalizedKey = key.trim();
      if (!normalizedKey || typeof item !== "string") {
        return acc;
      }
      const normalizedValue = item.trim();
      if (!normalizedValue) {
        return acc;
      }
      acc.push([normalizedKey, normalizedValue]);
      return acc;
    }, []),
  );
};

const normalizeThinkingLevelSelectionMap = (
  value: unknown,
): Record<string, ChatThinkingLevel> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).reduce<Array<[string, ChatThinkingLevel]>>(
      (acc, [key, item]) => {
        const normalizedKey = key.trim();
        const normalizedValue = normalizeChatThinkingLevel(item);
        if (!normalizedKey || !normalizedValue) {
          return acc;
        }
        acc.push([normalizedKey, normalizedValue]);
        return acc;
      },
      [],
    ),
  );
};

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
};

const getFeishuAppCredentials = async (
  settings: SettingsFile,
): Promise<{
  appId: string | null;
  appSecret: string | null;
}> => {
  const appId = settings.chatChannels.feishu.appId || null;
  const appSecret = settings.chatChannels.feishu.appSecret || null;
  return { appId, appSecret };
};

const normalizeBroadcastChannelName = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeGeneralConfig = (
  value: unknown,
): GeneralConfigDTO => {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const workspaceRoot =
    typeof raw.workspaceRoot === "string" && raw.workspaceRoot.trim().length > 0
      ? raw.workspaceRoot
      : WORKSPACE_ROOT;
  const language = isAppLanguage(raw.language)
    ? raw.language
    : DEFAULT_GENERAL_CONFIG_FLAGS.language;
  const themeMode = isAppThemeMode(raw.themeMode)
    ? raw.themeMode
    : DEFAULT_GENERAL_CONFIG_FLAGS.themeMode;
  const linkOpenMode =
    raw.linkOpenMode === "system" ? "system" : DEFAULT_GENERAL_CONFIG_FLAGS.linkOpenMode;

  return {
    workspaceRoot,
    language,
    themeMode,
    linkOpenMode,
    mainSubModeEnabled: true,
    quickGuideDismissed: normalizeBoolean(
      raw.quickGuideDismissed,
      DEFAULT_GENERAL_CONFIG_FLAGS.quickGuideDismissed,
    ),
    chatInputShortcutTipDismissed: normalizeBoolean(
      raw.chatInputShortcutTipDismissed,
      DEFAULT_GENERAL_CONFIG_FLAGS.chatInputShortcutTipDismissed,
    ),
  };
};

const normalizeMcpServerName = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const BROADCAST_CHANNEL_TYPES = new Set(["feishu", "wechat"]);
const MCP_TRANSPORT_TYPES = new Set(["stdio", "sse", "streamable-http"]);

const normalizeBroadcastChannelType = (
  value: unknown,
): "feishu" | "wechat" => {
  if (typeof value !== "string") return "feishu";
  const normalized = value.trim().toLowerCase();
  if (BROADCAST_CHANNEL_TYPES.has(normalized)) {
    return normalized as "feishu" | "wechat";
  }
  return "feishu";
};

const normalizeMcpTransportType = (value: unknown): McpTransportType => {
  if (typeof value !== "string") return "stdio";
  const normalized = value.trim().toLowerCase();
  if (MCP_TRANSPORT_TYPES.has(normalized)) {
    return normalized as McpTransportType;
  }
  return "stdio";
};

const parsePositiveIntegerId = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizeBroadcastChannels = (
  value: unknown,
): BroadcastChannelSettings[] => {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<number>();
  let nextId = 1;
  const normalized: BroadcastChannelSettings[] = [];

  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const raw = item as Record<string, unknown>;
    let id = parsePositiveIntegerId(raw.id);
    if (id !== null && id >= nextId) {
      nextId = id + 1;
    }
    if (id === null || usedIds.has(id)) {
      while (usedIds.has(nextId)) {
        nextId += 1;
      }
      id = nextId;
      nextId += 1;
    }
    usedIds.add(id);
    normalized.push({
      id: String(id),
      name: normalizeBroadcastChannelName(raw.name),
      type: normalizeBroadcastChannelType(raw.type),
      webhook: normalizeSecretValue(raw.webhook),
    });
  });

  return normalized;
};

const normalizeStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).reduce<Array<[string, string]>>((acc, [key, item]) => {
      const normalizedKey = key.trim();
      if (!normalizedKey || typeof item !== "string") {
        return acc;
      }
      acc.push([normalizedKey, item.trim()]);
      return acc;
    }, []),
  );
};

const normalizeMcpArgs = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
};

const nowIso = (): string => new Date().toISOString();

const normalizeTimestamp = (value: unknown, fallback: string): string => {
  return normalizeUtcTimestamp(value, fallback);
};

const normalizeMcpServers = (value: unknown): McpServerSettings[] => {
  if (!Array.isArray(value)) return [];

  const usedIds = new Set<number>();
  let nextId = 1;
  return value.reduce<McpServerSettings[]>((acc, item) => {
    if (!item || typeof item !== "object") return acc;

    const raw = item as Record<string, unknown>;
    let id = parsePositiveIntegerId(raw.id);
    if (id !== null && id >= nextId) {
      nextId = id + 1;
    }
    if (id === null || usedIds.has(id)) {
      while (usedIds.has(nextId)) {
        nextId += 1;
      }
      id = nextId;
      nextId += 1;
    }
    usedIds.add(id);

    const createdAt = normalizeTimestamp(raw.createdAt, nowIso());
    const updatedAt = normalizeTimestamp(raw.updatedAt, createdAt);
    acc.push({
      id: String(id),
      name: normalizeMcpServerName(raw.name) || `MCP 服务 ${id}`,
      transport: normalizeMcpTransportType(raw.transport),
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : false,
      command: normalizeSecretValue(raw.command),
      args: normalizeMcpArgs(raw.args),
      cwd: normalizeSecretValue(raw.cwd),
      env: normalizeStringRecord(raw.env),
      url: normalizeSecretValue(raw.url),
      headers: normalizeStringRecord(raw.headers),
      createdAt,
      updatedAt,
    });
    return acc;
  }, []);
};

const toMcpServerDTO = (server: McpServerSettings): McpServerDTO => ({
  id: server.id,
  name: server.name,
  transport: server.transport,
  enabled: server.enabled,
  command: server.command,
  args: [...server.args],
  cwd: server.cwd,
  env: { ...server.env },
  url: server.url,
  headers: { ...server.headers },
  createdAt: server.createdAt,
  updatedAt: server.updatedAt,
});

const toNonNegativeInt = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : fallback;
};

const normalizeProviderEntries = (input: unknown): ProviderEntry[] => {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry) => entry && typeof entry === "object" && typeof entry.provider === "string" && entry.provider)
    .map((entry) => {
      const rawEntry = entry as Record<string, unknown>;
      const apiKey = typeof rawEntry.apiKey === "string" ? rawEntry.apiKey : "";
      const customModelsRaw = Array.isArray(rawEntry.customModels)
        ? rawEntry.customModels
        : [];
      const customModels = customModelsRaw.reduce<CustomAgentModelConfigDTO[]>(
        (acc, item) => {
          if (!item || typeof item !== "object") return acc;
          const rawItem = item as Record<string, unknown>;
          const id =
            typeof rawItem.id === "string" ? rawItem.id.trim() : "";
          if (!id) return acc;
          const inputModes: Array<"text" | "image"> = Array.isArray(rawItem.input)
            ? Array.from(
                new Set(
                  rawItem.input.filter(
                    (mode): mode is "text" | "image" =>
                      mode === "text" || mode === "image",
                  ),
                ),
              )
            : ["text"];
          acc.push({
            id,
            name:
              typeof rawItem.name === "string" && rawItem.name.trim().length > 0
                ? rawItem.name.trim()
                : undefined,
            reasoning:
              typeof rawItem.reasoning === "boolean" ? rawItem.reasoning : false,
            input: inputModes.length > 0 ? inputModes : ["text"],
            contextWindow:
              typeof rawItem.contextWindow === "number" && rawItem.contextWindow > 0
                ? Math.trunc(rawItem.contextWindow)
                : 128000,
            maxTokens:
              typeof rawItem.maxTokens === "number" && rawItem.maxTokens > 0
                ? Math.trunc(rawItem.maxTokens)
                : 16384,
          });
          return acc;
        },
        [],
      );
      const providerId = normalizeAgentProviderId(rawEntry.provider as string);
      const normalizedDisplayName =
        typeof rawEntry.displayName === "string" &&
        rawEntry.displayName.trim().length > 0
          ? rawEntry.displayName.trim()
          : typeof rawEntry.name === "string" && rawEntry.name.trim().length > 0
            ? rawEntry.name.trim()
            : undefined;
      return {
        provider: providerId,
        displayName: isCustomAgentProviderId(providerId)
          ? normalizedDisplayName ??
            getDefaultCustomProviderDisplayName(providerId)
          : undefined,
        enabled: typeof rawEntry.enabled === "boolean" ? rawEntry.enabled : Boolean(apiKey),
        apiKey,
        baseUrl: normalizeOptionalHttpUrl(rawEntry.baseUrl),
        api:
          typeof rawEntry.api === "string" && rawEntry.api.trim().length > 0
            ? rawEntry.api.trim()
            : undefined,
        customModels,
        enabledModels: uniqueStrings(rawEntry.enabledModels),
      };
    });
};

const toAgentModelDto = (
  model: Pick<
    Model<Api>,
    "id" | "name" | "reasoning" | "input" | "contextWindow" | "maxTokens"
  >,
  source: AgentModelDTO["source"],
): AgentModelDTO => ({
  id: model.id,
  name: model.name,
  reasoning: model.reasoning,
  input: model.input,
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
  source,
});

const getConfiguredModelsForProvider = (
  provider: string,
  providerEntry?: ProviderEntry,
): AgentModelDTO[] => {
  if (providerEntry?.customModels.length) {
    return providerEntry.customModels.map((model) =>
      toAgentModelDto(
        {
          id: model.id,
          name: model.name ?? model.id,
          reasoning: model.reasoning,
          input: model.input,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        },
        "custom",
      ),
    );
  }

  if (isCustomAgentProviderId(provider)) {
    return [];
  }

  try {
    const models = getModels(provider as Parameters<typeof getModels>[0]);
    return models.map((model) => toAgentModelDto(model, "builtin"));
  } catch {
    return [];
  }
};

const getConfiguredEnabledModels = (
  providerEntry?: ProviderEntry,
): string[] => {
  if (!providerEntry) return [];
  const availableIds = new Set(
    getConfiguredModelsForProvider(providerEntry.provider, providerEntry).map(
      (model) => model.id,
    ),
  );
  return providerEntry.enabledModels.filter((modelId) => availableIds.has(modelId));
};

const isCustomApiProviderEntryConfigured = (
  providerEntry: ProviderEntry | undefined,
): boolean =>
  Boolean(
    providerEntry &&
      providerEntry.baseUrl &&
      providerEntry.api &&
      providerEntry.customModels.length > 0,
  );

const isProviderEntryConfigured = (
  providerEntry: ProviderEntry | undefined,
): boolean => {
  if (!providerEntry) return false;
  if (isCustomAgentProviderId(providerEntry.provider)) {
    return isCustomApiProviderEntryConfigured(providerEntry);
  }
  return Boolean(providerEntry.apiKey);
};

const getProviderRuntimeApiKey = (
  providerEntry: ProviderEntry | undefined,
): string | null => {
  if (!providerEntry) return null;
  if (providerEntry.apiKey) {
    return providerEntry.apiKey;
  }
  if (isCustomAgentProviderId(providerEntry.provider)) {
    return isCustomApiProviderEntryConfigured(providerEntry)
      ? "kian-custom-api-no-auth"
      : null;
  }
  return null;
};

const resolveConfiguredModel = (
  provider: string,
  modelId: string,
  providerEntry?: ProviderEntry,
): Model<Api> | null => {
  if (
    isCustomAgentProviderId(provider) ||
    providerEntry?.customModels.length
  ) {
    const resolvedBaseUrl = providerEntry?.baseUrl;
    const resolvedApi = providerEntry?.api;
    const customModel = providerEntry?.customModels.find(
      (candidate) => candidate.id === modelId,
    );
    if (!customModel || !resolvedBaseUrl || !resolvedApi) {
      return null;
    }
    return {
      id: customModel.id,
      name: customModel.name ?? customModel.id,
      api: resolvedApi as Api,
      provider,
      baseUrl: resolvedBaseUrl,
      reasoning: customModel.reasoning,
      input: customModel.input,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: customModel.contextWindow,
      maxTokens: customModel.maxTokens,
    };
  }

  try {
    const builtInModel = getModel(
      provider as Parameters<typeof getModel>[0],
      modelId as never,
    );
    if (!builtInModel) {
      return null;
    }
    if (providerEntry?.baseUrl) {
      return {
        ...builtInModel,
        baseUrl: providerEntry.baseUrl,
      };
    }
    return builtInModel;
  } catch {
    return null;
  }
};

const normalizeSettingsFile = (
  raw: LegacySettingsFile | undefined,
): SettingsFile => {
  const providers = normalizeProviderEntries(raw?.providers);
  const mediaProviders = normalizeProviderEntries(raw?.mediaProviders);
  if (mediaProviders.length === 0) {
    mediaProviders.push({
      provider: "fal",
      enabled: false,
      apiKey: "",
      customModels: [],
      enabledModels: DEFAULT_FAL_ENABLED_MODELS,
    });
  }
  const mcpServers = normalizeMcpServers(raw?.mcpServers);

  const lastSelectedModel = raw?.lastSelectedModel;
  const normalizedLastSelectedModel =
    typeof lastSelectedModel === "string" &&
    lastSelectedModel.startsWith(`${LEGACY_OPENAI_COMPATIBLE_PROVIDER}:`)
      ? `${CUSTOM_API_PROVIDER}:${lastSelectedModel.slice(
          LEGACY_OPENAI_COMPATIBLE_PROVIDER.length + 1,
        )}`
      : lastSelectedModel;
  const lastSelectedThinkingLevel = normalizeChatThinkingLevel(
    raw?.lastSelectedThinkingLevel,
  );
  const lastSelectedModelByScope = normalizeModelSelectionMap(
    raw?.lastSelectedModelByScope,
  );
  const lastSelectedThinkingLevelByScope = normalizeThinkingLevelSelectionMap(
    raw?.lastSelectedThinkingLevelByScope,
  );
  if (typeof lastSelectedModel === "string" && lastSelectedModel.trim()) {
    lastSelectedModelByScope[MAIN_SCOPE_SETTINGS_KEY] ??=
      lastSelectedModel.trim();
  }
  if (lastSelectedThinkingLevel) {
    lastSelectedThinkingLevelByScope[MAIN_SCOPE_SETTINGS_KEY] ??=
      lastSelectedThinkingLevel;
  }

  const telegramRaw = raw?.chatChannels?.telegram;
  const discordRaw = raw?.chatChannels?.discord;
  const feishuRaw = raw?.chatChannels?.feishu;
  const weixinRaw = raw?.chatChannels?.weixin;
  const broadcastChannelsRaw = normalizeBroadcastChannels(
    raw?.chatChannels?.broadcastChannels,
  );
  const legacyBroadcastWebhook = normalizeSecretValue(
    raw?.chatChannels?.broadcast?.feishuWebhook,
  );
  const broadcastChannels =
    broadcastChannelsRaw.length > 0
      ? broadcastChannelsRaw
      : legacyBroadcastWebhook
        ? [
            {
              id: "1",
              name: "默认飞书渠道",
              type: "feishu" as const,
              webhook: legacyBroadcastWebhook,
            },
          ]
        : DEFAULT_BROADCAST_CHANNELS;
  const telegramUserIds = uniqueTelegramUserIds(
    telegramRaw?.ownerUserIds ?? telegramRaw?.userIds,
  );
  const legacyTelegramUserIds = parseLegacyTelegramUserIds(telegramRaw?.userId);
  const discordOwnerUserIds = uniqueStrings(discordRaw?.ownerUserIds);
  const discordServerIds = uniqueDiscordSnowflakeIds(discordRaw?.serverIds);
  const legacyDiscordServerIds = parseLegacyDiscordSnowflakeIds(
    discordRaw?.serverId,
  );
  const discordChannelIds = uniqueDiscordSnowflakeIds(discordRaw?.channelIds);
  const legacyDiscordChannelIds = parseLegacyDiscordSnowflakeIds(
    discordRaw?.channelId,
  );
  const feishuUserIds = uniqueStrings(
    feishuRaw?.ownerUserIds ?? feishuRaw?.userIds,
  );
  const legacyFeishuUserIds = parseLegacyUserIds(feishuRaw?.userId);
  return {
    providers,
    mediaProviders,
    lastSelectedModel: normalizedLastSelectedModel,
    lastSelectedThinkingLevel,
    lastSelectedModelByScope,
    lastSelectedThinkingLevelByScope,
    shortcuts: normalizeShortcutConfig(raw?.shortcuts),
    mcpServers,
    chatChannels: {
      telegram: {
        enabled:
          typeof telegramRaw?.enabled === "boolean"
            ? telegramRaw.enabled
            : DEFAULT_TELEGRAM_CHAT_CHANNEL.enabled,
        botToken: normalizeSecretValue(telegramRaw?.botToken),
        ownerUserIds:
          telegramUserIds.length > 0 ? telegramUserIds : legacyTelegramUserIds,
        lastUpdateId: toNonNegativeInt(
          telegramRaw?.lastUpdateId,
          DEFAULT_TELEGRAM_CHAT_CHANNEL.lastUpdateId,
        ),
      },
      discord: {
        enabled:
          typeof discordRaw?.enabled === "boolean"
            ? discordRaw.enabled
            : DEFAULT_DISCORD_CHAT_CHANNEL.enabled,
        botToken: normalizeSecretValue(discordRaw?.botToken),
        ownerUserIds: discordOwnerUserIds,
        serverIds:
          discordServerIds.length > 0
            ? discordServerIds
            : legacyDiscordServerIds,
        channelIds:
          discordChannelIds.length > 0
            ? discordChannelIds
            : legacyDiscordChannelIds,
      },
      feishu: {
        enabled:
          typeof feishuRaw?.enabled === "boolean"
            ? feishuRaw.enabled
            : DEFAULT_FEISHU_CHAT_CHANNEL.enabled,
        ownerUserIds:
          feishuUserIds.length > 0 ? feishuUserIds : legacyFeishuUserIds,
        appId: normalizeSecretValue(feishuRaw?.appId),
        appSecret: normalizeSecretValue(feishuRaw?.appSecret),
      },
      weixin: {
        enabled:
          typeof weixinRaw?.enabled === "boolean"
            ? weixinRaw.enabled
            : DEFAULT_WEIXIN_CHAT_CHANNEL.enabled,
        accountId: normalizeSecretValue(weixinRaw?.accountId),
      },
      broadcastChannels,
    },
  };
};

const ensureSettingsDir = async (): Promise<void> => {
  await fs.mkdir(INTERNAL_ROOT, { recursive: true });
};

let settingsWriteQueue: Promise<void> = Promise.resolve();

const withSettingsWriteLock = async <T>(task: () => Promise<T>): Promise<T> => {
  const previous = settingsWriteQueue;
  let release: (() => void) | undefined;
  settingsWriteQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await task();
  } finally {
    release?.();
  }
};

const parseLegacySettingsFile = (
  raw: string,
): LegacySettingsFile | undefined => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as LegacySettingsFile;
  } catch {
    return undefined;
  }
};

const parseSettingsContent = (raw: string): LegacySettingsFile | undefined => {
  const parsed = parseLegacySettingsFile(raw);
  if (parsed) {
    return parsed;
  }

  const recoveredRaw = extractFirstJsonObject(raw);
  return recoveredRaw ? parseLegacySettingsFile(recoveredRaw) : undefined;
};

const applyLegacyWorkspaceSettings = (
  settings: SettingsFile,
  legacy: LegacySettingsFile | undefined,
): SettingsFile => {
  const defaultProvider = normalizeOptionalString(legacy?.defaultProvider);
  const defaultModel = normalizeOptionalString(legacy?.defaultModel);

  if (!defaultProvider || !defaultModel || settings.lastSelectedModel) {
    return settings;
  }

  return {
    ...settings,
    lastSelectedModel: `${defaultProvider}:${defaultModel}`,
    lastSelectedModelByScope: {
      ...settings.lastSelectedModelByScope,
      [MAIN_SCOPE_SETTINGS_KEY]: `${defaultProvider}:${defaultModel}`,
    },
  };
};

const extractFirstJsonObject = (raw: string): string | null => {
  const start = raw.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return raw.slice(start, index + 1);
    }
    if (depth < 0) {
      return null;
    }
  }

  return null;
};

const backupCorruptedSettingsFile = async (raw: string): Promise<void> => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${SETTINGS_PATH}.broken-${stamp}`;
  await fs.writeFile(backupPath, raw, "utf8");
};

const readLegacyWorkspaceSettingsFile = async (): Promise<
  LegacySettingsFile | undefined
> => {
  try {
    const raw = await fs.readFile(LEGACY_WORKSPACE_SETTINGS_PATH, "utf8");
    return parseSettingsContent(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

const removeLegacyWorkspaceSettingsFile = async (): Promise<void> => {
  try {
    await fs.unlink(LEGACY_WORKSPACE_SETTINGS_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
};

const migrateLegacyWorkspaceSettings = async (
  settings: SettingsFile | undefined,
): Promise<SettingsFile | undefined> => {
  const legacy = await readLegacyWorkspaceSettingsFile();
  if (!legacy) {
    return settings;
  }

  const nextSettings = applyLegacyWorkspaceSettings(
    settings ?? normalizeSettingsFile(legacy),
    legacy,
  );

  if (!settings || nextSettings !== settings) {
    await writeSettingsFile(nextSettings);
  }
  await removeLegacyWorkspaceSettingsFile();
  return nextSettings;
};

const getScopedSelectedModel = (
  settings: SettingsFile,
  scope: ChatScope = { type: "main" },
): string | undefined => {
  const scopeKey = getSettingsScopeKey(scope);
  const scopedModel = settings.lastSelectedModelByScope[scopeKey]?.trim();
  if (scopedModel) {
    return scopedModel;
  }
  if (scope.type === "main") {
    const legacyModel = settings.lastSelectedModel?.trim();
    return legacyModel || undefined;
  }
  return undefined;
};

const getScopedThinkingLevel = (
  settings: SettingsFile,
  scope: ChatScope = { type: "main" },
): ChatThinkingLevel | undefined => {
  const scopeKey = getSettingsScopeKey(scope);
  const scopedThinkingLevel =
    settings.lastSelectedThinkingLevelByScope[scopeKey];
  if (scopedThinkingLevel) {
    return scopedThinkingLevel;
  }
  if (scope.type === "main") {
    return settings.lastSelectedThinkingLevel;
  }
  return undefined;
};

const readSettingsFile = async (): Promise<SettingsFile> => {
  await ensureSettingsDir();

  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    const parsed = parseSettingsContent(raw);
    if (parsed) {
      const normalized = normalizeSettingsFile(parsed);
      return (await migrateLegacyWorkspaceSettings(normalized)) ?? normalized;
    }

    await backupCorruptedSettingsFile(raw);
    const fallback = normalizeSettingsFile(undefined);
    await writeSettingsFile(fallback);
    return (await migrateLegacyWorkspaceSettings(fallback)) ?? fallback;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    const migrated = await migrateLegacyWorkspaceSettings(undefined);
    return migrated ?? normalizeSettingsFile(undefined);
  }
};

const writeSettingsFile = async (settings: SettingsFile): Promise<void> => {
  await ensureSettingsDir();
  const tempPath = `${SETTINGS_PATH}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(
    tempPath,
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
  try {
    await fs.rename(tempPath, SETTINGS_PATH);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
};

const resolveTelegramBotTokenFromSettings = async (
  settings: SettingsFile,
): Promise<{ settings: SettingsFile; token: string }> => {
  const persistedToken = normalizeSecretValue(
    settings.chatChannels.telegram.botToken,
  );
  return { settings, token: persistedToken };
};

const resolveDiscordBotTokenFromSettings = async (
  settings: SettingsFile,
): Promise<{ settings: SettingsFile; token: string }> => {
  const persistedToken = normalizeSecretValue(
    settings.chatChannels.discord.botToken,
  );
  return { settings, token: persistedToken };
};

export const settingsService = {
  async saveClaudeConfig(input: {
    provider: string;
    displayName?: string;
    enabled: boolean;
    secret?: string;
    baseUrl?: string;
    api?: string;
    customModels: CustomAgentModelConfigDTO[];
    enabledModels: string[];
  }): Promise<void> {
    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const providerId = normalizeAgentProviderId(input.provider);
      const existing = settings.providers.find((e) => e.provider === providerId);
      const nextApiKey = input.secret ?? existing?.apiKey ?? "";
      const nextDisplayName = isCustomAgentProviderId(providerId)
        ? normalizeOptionalString(input.displayName) ??
          existing?.displayName ??
          getDefaultCustomProviderDisplayName(providerId)
        : undefined;
      const nextEntryDraft: ProviderEntry = {
        provider: providerId,
        displayName: nextDisplayName,
        enabled: input.enabled,
        apiKey: nextApiKey,
        baseUrl: normalizeOptionalHttpUrl(input.baseUrl),
        api: normalizeOptionalString(input.api),
        customModels:
          input.customModels.length > 0
            ? input.customModels.map((model) => ({
                id: model.id.trim(),
                name: normalizeOptionalString(model.name),
                reasoning: model.reasoning,
                input: model.input.includes("image")
                  ? (["text", "image"] as Array<"text" | "image">)
                  : (["text"] as Array<"text" | "image">),
                contextWindow: model.contextWindow,
                maxTokens: model.maxTokens,
              }))
            : [],
        enabledModels: [],
      };
      const enabledModels = uniqueStrings(input.enabledModels).filter((modelId) =>
        getConfiguredModelsForProvider(providerId, nextEntryDraft).some(
          (model) => model.id === modelId,
        ),
      );
      const nextEntry: ProviderEntry = {
        ...nextEntryDraft,
        enabledModels,
      };

      const nextProviders = existing
        ? settings.providers.map((e) => (e.provider === providerId ? nextEntry : e))
        : [...settings.providers, nextEntry];

      await writeSettingsFile({
        ...settings,
        providers: nextProviders,
      });
    });
  },

  async getClaudeStatus(
    scope: ChatScope = { type: "main" },
  ): Promise<ClaudeConfigStatus> {
    const settings = await readSettingsFile();

    const providers: Record<string, ProviderConfigEntry> = {};
    const allEnabledModels: {
      provider: string;
      modelId: string;
      modelName: string;
    }[] = [];

    for (const entry of settings.providers) {
      const configured = isProviderEntryConfigured(entry);
      const enabledModels = getConfiguredEnabledModels(entry);
      providers[entry.provider] = {
        configured,
        enabled: entry.enabled,
        apiKey: entry.apiKey,
        baseUrl: entry.baseUrl,
        api: entry.api,
        customModels: entry.customModels,
        enabledModels,
      };

      if (entry.enabled && configured && enabledModels.length > 0) {
        const availableModels = getConfiguredModelsForProvider(
          entry.provider,
          entry,
        );
        const modelNameMap = new Map(
          availableModels.map((m) => [m.id, m.name]),
        );
        for (const modelId of enabledModels) {
          allEnabledModels.push({
            provider: entry.provider,
            modelId,
            modelName: modelNameMap.get(modelId) ?? modelId,
          });
        }
      }
    }

    return {
      providers,
      allEnabledModels,
      lastSelectedModel: getScopedSelectedModel(settings, scope),
      lastSelectedThinkingLevel: getScopedThinkingLevel(settings, scope),
    };
  },

  async getAgentSystemPrompt(
    scopeType: ChatScope["type"] = "project",
    sessionKind: ChatSessionKind = "normal",
  ): Promise<string> {
    return readBundledPromptFile(
      sessionKind === "digital_avatar" || sessionKind === "channel_runtime"
        ? "default-avatar-system-prompt.md"
        : scopeType === "main"
          ? "default-main-system-prompt.md"
          : "default-system-prompt.md",
    );
  },

  async getClaudeSecret(provider: string): Promise<string | null> {
    const settings = await readSettingsFile();
    const entry = settings.providers.find(
      (e) => e.provider === normalizeAgentProviderId(provider),
    );
    return getProviderRuntimeApiKey(entry);
  },

  async saveModelProviderConfig(input: {
    provider: MediaProvider;
    secret?: string;
    enabledModels?: string[];
  }): Promise<void> {
    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const existing = settings.mediaProviders.find((e) => e.provider === input.provider);
      const existingApiKey = existing?.apiKey ?? "";
      const nextApiKey = input.secret ?? existingApiKey;

      const enabledModels =
        input.enabledModels === undefined
          ? (existing?.enabledModels ?? DEFAULT_FAL_ENABLED_MODELS)
          : uniqueStrings(input.enabledModels);

      const nextEntry: ProviderEntry = {
        provider: input.provider,
        enabled: existing?.enabled ?? Boolean(nextApiKey),
        apiKey: nextApiKey,
        customModels: [],
        enabledModels,
      };

      const nextMediaProviders = existing
        ? settings.mediaProviders.map((e) => (e.provider === input.provider ? nextEntry : e))
        : [...settings.mediaProviders, nextEntry];

      await writeSettingsFile({
        ...settings,
        mediaProviders: nextMediaProviders,
      });
    });
  },

  async getModelProviderStatus(
    provider: MediaProvider,
  ): Promise<ModelProviderConfigStatus> {
    const settings = await readSettingsFile();
    const entry = settings.mediaProviders.find((e) => e.provider === provider);
    const apiKey = entry?.apiKey ?? "";
    const enabledModels = entry?.enabledModels ?? [];

    if (provider === "fal") {
      return {
        provider,
        configured: Boolean(apiKey),
        secret: apiKey,
        enabledModels,
        models: FAL_SUPPORTED_MODELS,
      };
    }

    return {
      provider,
      configured: Boolean(apiKey),
      secret: apiKey,
      enabledModels,
      models: [],
    };
  },

  async getModelProviderSecret(
    provider: MediaProvider,
  ): Promise<string | null> {
    const settings = await readSettingsFile();
    const entry = settings.mediaProviders.find((e) => e.provider === provider);
    return entry?.apiKey || null;
  },

  async getModelProviderRuntime(provider: MediaProvider): Promise<{
    configured: boolean;
    enabledModels: string[];
    secret: string | null;
  }> {
    const settings = await readSettingsFile();
    const entry = settings.mediaProviders.find((e) => e.provider === provider);
    const secret = entry?.apiKey || null;
    return {
      configured: Boolean(secret),
      enabledModels: entry?.enabledModels ?? [],
      secret,
    };
  },

  async saveTelegramChatChannelConfig(input: {
    enabled: boolean;
    botToken?: string;
    ownerUserIds: string[];
  }): Promise<void> {
    const ownerUserIds = uniqueTelegramUserIds(input.ownerUserIds);

    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const { settings: hydratedSettings, token: existingToken } =
        await resolveTelegramBotTokenFromSettings(settings);
      const providedToken = normalizeSecretValue(input.botToken);
      const nextToken = providedToken || existingToken;
      const nextOwnerUserIds = input.enabled
        ? ownerUserIds
        : ownerUserIds.length > 0
          ? ownerUserIds
          : hydratedSettings.chatChannels.telegram.ownerUserIds;

      const tokenChanged = Boolean(
        providedToken && providedToken !== existingToken,
      );
      await writeSettingsFile({
        ...hydratedSettings,
        chatChannels: {
          ...hydratedSettings.chatChannels,
          telegram: {
            ...hydratedSettings.chatChannels.telegram,
            enabled: input.enabled,
            botToken: nextToken,
            ownerUserIds: nextOwnerUserIds,
            lastUpdateId: tokenChanged
              ? 0
              : hydratedSettings.chatChannels.telegram.lastUpdateId,
          },
        },
      });
    });
  },

  async getTelegramChatChannelStatus(): Promise<TelegramChatChannelStatus> {
    return withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const { settings: hydratedSettings, token } =
        await resolveTelegramBotTokenFromSettings(settings);
      const telegram = hydratedSettings.chatChannels.telegram;
      return {
        provider: "telegram",
        enabled: telegram.enabled,
        configured: Boolean(token),
        botToken: token ?? "",
        ownerUserIds: telegram.ownerUserIds,
        ownerCandidates: chatChannelOwnerDiscoveryService.list("telegram"),
      };
    });
  },

  async getTelegramChatChannelRuntime(): Promise<{
    enabled: boolean;
    configured: boolean;
    ownerUserIds: string[];
    secret: string | null;
    lastUpdateId: number;
  }> {
    return withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const { settings: hydratedSettings, token } =
        await resolveTelegramBotTokenFromSettings(settings);
      const telegram = hydratedSettings.chatChannels.telegram;
      return {
        enabled: telegram.enabled,
        configured: Boolean(token),
        ownerUserIds: telegram.ownerUserIds,
        secret: token || null,
        lastUpdateId: telegram.lastUpdateId,
      };
    });
  },

  async saveDiscordChatChannelConfig(input: {
    enabled: boolean;
    botToken?: string;
    ownerUserIds: string[];
    serverIds: string[];
    channelIds: string[];
  }): Promise<void> {
    const ownerUserIds = uniqueStrings(input.ownerUserIds);
    const serverIds = uniqueDiscordSnowflakeIds(input.serverIds);
    const channelIds = uniqueDiscordSnowflakeIds(input.channelIds);

    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const { settings: hydratedSettings, token: existingToken } =
        await resolveDiscordBotTokenFromSettings(settings);
      const providedToken = normalizeSecretValue(input.botToken);
      const nextToken = providedToken || existingToken;
      const nextServerIds = input.enabled
        ? serverIds
        : serverIds.length > 0
          ? serverIds
          : hydratedSettings.chatChannels.discord.serverIds;
      const nextChannelIds = input.enabled
        ? channelIds
        : channelIds.length > 0
          ? channelIds
          : hydratedSettings.chatChannels.discord.channelIds;

      await writeSettingsFile({
        ...hydratedSettings,
        chatChannels: {
          ...hydratedSettings.chatChannels,
          discord: {
            ...hydratedSettings.chatChannels.discord,
            enabled: input.enabled,
            botToken: nextToken,
            ownerUserIds,
            serverIds: nextServerIds,
            channelIds: nextChannelIds,
          },
        },
      });
    });
  },

  async getDiscordChatChannelStatus(): Promise<DiscordChatChannelStatus> {
    return withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const { settings: hydratedSettings, token } =
        await resolveDiscordBotTokenFromSettings(settings);
      return {
        provider: "discord",
        enabled: hydratedSettings.chatChannels.discord.enabled,
        configured: Boolean(token),
        botToken: token ?? "",
        ownerUserIds: hydratedSettings.chatChannels.discord.ownerUserIds,
        ownerCandidates: chatChannelOwnerDiscoveryService.list("discord"),
        serverIds: hydratedSettings.chatChannels.discord.serverIds,
        channelIds: hydratedSettings.chatChannels.discord.channelIds,
      };
    });
  },

  async getDiscordChatChannelRuntime(): Promise<{
    enabled: boolean;
    configured: boolean;
    ownerUserIds: string[];
    serverIds: string[];
    channelIds: string[];
    secret: string | null;
  }> {
    return withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const { settings: hydratedSettings, token } =
        await resolveDiscordBotTokenFromSettings(settings);
      return {
        enabled: hydratedSettings.chatChannels.discord.enabled,
        configured: Boolean(token),
        ownerUserIds: hydratedSettings.chatChannels.discord.ownerUserIds,
        serverIds: hydratedSettings.chatChannels.discord.serverIds,
        channelIds: hydratedSettings.chatChannels.discord.channelIds,
        secret: token || null,
      };
    });
  },

  async saveFeishuChatChannelConfig(input: {
    enabled: boolean;
    appId?: string;
    appSecret?: string;
    ownerUserIds: string[];
  }): Promise<void> {
    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const existingCredentials = await getFeishuAppCredentials(settings);
      const nextAppId = input.appId ?? existingCredentials.appId ?? "";
      const nextAppSecret = input.appSecret ?? existingCredentials.appSecret ?? "";
      const ownerUserIds = uniqueStrings(input.ownerUserIds);

      await writeSettingsFile({
        ...settings,
        chatChannels: {
          ...settings.chatChannels,
          feishu: {
            ...settings.chatChannels.feishu,
            enabled: input.enabled,
            appId: nextAppId,
            appSecret: nextAppSecret,
            ownerUserIds,
          },
        },
      });
    });
  },

  async getFeishuChatChannelStatus(): Promise<FeishuChatChannelStatus> {
    const settings = await readSettingsFile();
    const credentials = await getFeishuAppCredentials(settings);
    return {
      provider: "feishu",
      enabled: settings.chatChannels.feishu.enabled,
      configured: Boolean(credentials.appId && credentials.appSecret),
      appId: credentials.appId ?? "",
      appSecret: credentials.appSecret ?? "",
      ownerUserIds: settings.chatChannels.feishu.ownerUserIds,
      ownerCandidates: chatChannelOwnerDiscoveryService.list("feishu"),
    };
  },

  async getFeishuChatChannelRuntime(): Promise<{
    enabled: boolean;
    configured: boolean;
    appId: string | null;
    appSecret: string | null;
    ownerUserIds: string[];
  }> {
    const settings = await readSettingsFile();
    const credentials = await getFeishuAppCredentials(settings);
    return {
      enabled: settings.chatChannels.feishu.enabled,
      configured: Boolean(credentials.appId && credentials.appSecret),
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      ownerUserIds: settings.chatChannels.feishu.ownerUserIds,
    };
  },

  async saveWeixinChatChannelConfig(input: {
    enabled: boolean;
    accountId?: string;
  }): Promise<void> {
    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      await writeSettingsFile({
        ...settings,
        chatChannels: {
          ...settings.chatChannels,
          weixin: {
            ...settings.chatChannels.weixin,
            enabled: input.enabled,
            accountId:
              input.accountId !== undefined
                ? normalizeSecretValue(input.accountId)
                : settings.chatChannels.weixin.accountId,
          },
        },
      });
    });
  },

  async getWeixinChatChannelRuntime(): Promise<{
    enabled: boolean;
    accountId: string | null;
  }> {
    const settings = await readSettingsFile();
    return {
      enabled: settings.chatChannels.weixin.enabled,
      accountId: settings.chatChannels.weixin.accountId || null,
    };
  },

  async saveBroadcastChannelsConfig(input: {
    channels: Array<{
      id?: string;
      name: string;
      type?: string;
      webhook: string;
    }>;
  }): Promise<BroadcastChannelDTO[]> {
    return withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const seenIds = new Set<number>();
      let nextId =
        settings.chatChannels.broadcastChannels.reduce((max, channel) => {
          const parsedId = parsePositiveIntegerId(channel.id);
          if (parsedId === null) return max;
          return parsedId > max ? parsedId : max;
        }, 0) + 1;
      const nextChannels: BroadcastChannelSettings[] = input.channels.map(
        (item) => {
          const name = normalizeBroadcastChannelName(item.name);
          const type = normalizeBroadcastChannelType(item.type);
          const webhook = normalizeSecretValue(item.webhook);

          let id = parsePositiveIntegerId(item.id);
          if (id !== null && id >= nextId) {
            nextId = id + 1;
          }
          if (id === null || seenIds.has(id)) {
            while (seenIds.has(nextId)) {
              nextId += 1;
            }
            id = nextId;
            nextId += 1;
          }

          seenIds.add(id);

          return {
            id: String(id),
            name,
            type,
            webhook,
          };
        },
      );

      await writeSettingsFile({
        ...settings,
        chatChannels: {
          ...settings.chatChannels,
          broadcastChannels: nextChannels,
        },
      });

      return nextChannels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        webhook: channel.webhook,
      }));
    });
  },

  async getBroadcastChannels(): Promise<BroadcastChannelDTO[]> {
    const settings = await readSettingsFile();
    return settings.chatChannels.broadcastChannels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      webhook: channel.webhook,
    }));
  },

  async getBroadcastChannelById(
    channelId: string,
  ): Promise<BroadcastChannelDTO | null> {
    const targetId = channelId.trim();
    if (!targetId) return null;
    const settings = await readSettingsFile();
    const channel = settings.chatChannels.broadcastChannels.find(
      (item) => item.id === targetId,
    );
    if (!channel) return null;
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      webhook: channel.webhook,
    };
  },

  async getMcpServers(): Promise<McpServerDTO[]> {
    const settings = await readSettingsFile();
    return settings.mcpServers.map((server) => toMcpServerDTO(server));
  },

  async addMcpServer(input: {
    name: string;
    transport: McpTransportType;
    enabled?: boolean;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }): Promise<McpServerDTO> {
    return withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const nextId =
        settings.mcpServers.reduce((max, server) => {
          const parsedId = parsePositiveIntegerId(server.id);
          if (parsedId === null) return max;
          return parsedId > max ? parsedId : max;
        }, 0) + 1;
      const timestamp = nowIso();
      const nextServer: McpServerSettings = {
        id: String(nextId),
        name: normalizeMcpServerName(input.name) || `MCP 服务 ${nextId}`,
        transport: normalizeMcpTransportType(input.transport),
        enabled: input.enabled ?? true,
        command: normalizeSecretValue(input.command),
        args: normalizeMcpArgs(input.args),
        cwd: normalizeSecretValue(input.cwd),
        env: normalizeStringRecord(input.env),
        url: normalizeSecretValue(input.url),
        headers: normalizeStringRecord(input.headers),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await writeSettingsFile({
        ...settings,
        mcpServers: [...settings.mcpServers, nextServer],
      });

      logger.info("MCP server added", {
        serverId: nextServer.id,
        name: nextServer.name,
        transport: nextServer.transport,
        enabled: nextServer.enabled,
        argsCount: nextServer.args.length,
        envKeyCount: Object.keys(nextServer.env).length,
        headerKeyCount: Object.keys(nextServer.headers).length,
        hasCwd: Boolean(nextServer.cwd),
        hasUrl: Boolean(nextServer.url),
      });

      return toMcpServerDTO(nextServer);
    });
  },

  async updateMcpServer(input: {
    id: string;
    name: string;
    transport: McpTransportType;
    enabled?: boolean;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }): Promise<McpServerDTO> {
    return withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const targetId = input.id.trim();
      const existing = settings.mcpServers.find((server) => server.id === targetId);
      if (!existing) {
        throw new Error("MCP 服务不存在");
      }

      const updatedServer: McpServerSettings = {
        ...existing,
        name: normalizeMcpServerName(input.name) || existing.name,
        transport: normalizeMcpTransportType(input.transport),
        enabled: input.enabled ?? existing.enabled,
        command: normalizeSecretValue(input.command),
        args: normalizeMcpArgs(input.args),
        cwd: normalizeSecretValue(input.cwd),
        env: normalizeStringRecord(input.env),
        url: normalizeSecretValue(input.url),
        headers: normalizeStringRecord(input.headers),
        updatedAt: nowIso(),
      };

      await writeSettingsFile({
        ...settings,
        mcpServers: settings.mcpServers.map((server) =>
          server.id === targetId ? updatedServer : server,
        ),
      });

      logger.info("MCP server updated", {
        serverId: updatedServer.id,
        name: updatedServer.name,
        transport: updatedServer.transport,
        enabled: updatedServer.enabled,
        argsCount: updatedServer.args.length,
        envKeyCount: Object.keys(updatedServer.env).length,
        headerKeyCount: Object.keys(updatedServer.headers).length,
        hasCwd: Boolean(updatedServer.cwd),
        hasUrl: Boolean(updatedServer.url),
      });

      return toMcpServerDTO(updatedServer);
    });
  },

  async setMcpServerEnabled(input: {
    id: string;
    enabled: boolean;
  }): Promise<McpServerDTO> {
    return withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const targetId = input.id.trim();
      const existing = settings.mcpServers.find((server) => server.id === targetId);
      if (!existing) {
        throw new Error("MCP 服务不存在");
      }

      const updatedServer: McpServerSettings = {
        ...existing,
        enabled: input.enabled,
        updatedAt: nowIso(),
      };

      await writeSettingsFile({
        ...settings,
        mcpServers: settings.mcpServers.map((server) =>
          server.id === targetId ? updatedServer : server,
        ),
      });

      logger.info("MCP server enabled state changed", {
        serverId: updatedServer.id,
        name: updatedServer.name,
        enabled: updatedServer.enabled,
        transport: updatedServer.transport,
      });

      return toMcpServerDTO(updatedServer);
    });
  },

  async setTelegramLastUpdateId(lastUpdateId: number): Promise<void> {
    const normalized = toNonNegativeInt(lastUpdateId, 0);
    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      if (settings.chatChannels.telegram.lastUpdateId === normalized) {
        return;
      }
      await writeSettingsFile({
        ...settings,
        chatChannels: {
          ...settings.chatChannels,
          telegram: {
            ...settings.chatChannels.telegram,
            lastUpdateId: normalized,
          },
        },
      });
    });
  },

  async setLastSelectedModel(scope: ChatScope, model: string): Promise<void> {
    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const scopeKey = getSettingsScopeKey(scope);
      const currentModel = getScopedSelectedModel(settings, scope);
      if (currentModel === model) return;
      await writeSettingsFile({
        ...settings,
        lastSelectedModel:
          scope.type === "main" ? model : settings.lastSelectedModel,
        lastSelectedModelByScope: {
          ...settings.lastSelectedModelByScope,
          [scopeKey]: model,
        },
      });
    });
  },

  async setLastSelectedThinkingLevel(
    scope: ChatScope,
    level: ChatThinkingLevel,
  ): Promise<void> {
    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      const scopeKey = getSettingsScopeKey(scope);
      const currentLevel = getScopedThinkingLevel(settings, scope);
      if (currentLevel === level) return;
      await writeSettingsFile({
        ...settings,
        lastSelectedThinkingLevel:
          scope.type === "main" ? level : settings.lastSelectedThinkingLevel,
        lastSelectedThinkingLevelByScope: {
          ...settings.lastSelectedThinkingLevelByScope,
          [scopeKey]: level,
        },
      });
    });
  },

  async getShortcutConfig(): Promise<ShortcutConfigDTO> {
    const settings = await readSettingsFile();
    return normalizeShortcutConfig(settings.shortcuts);
  },

  async saveShortcutConfig(input: ShortcutConfigDTO): Promise<void> {
    const shortcuts = normalizeShortcutConfig(input);
    await withSettingsWriteLock(async () => {
      const settings = await readSettingsFile();
      await writeSettingsFile({
        ...settings,
        shortcuts,
      });
    });
  },

  async getAvailableProviders(): Promise<AgentProviderDTO[]> {
    const settings = await readSettingsFile();
    const hidden = new Set([
      'anthropic',
      'openai-codex',
      'github-copilot',
      'google-antigravity',
      'google-gemini-cli',
    ]);
    const providers: AgentProviderDTO[] = getProviders()
      .filter((id) => !hidden.has(id))
      .map((id) => ({
        id,
        name: toProviderDisplayName(id),
      }));
    const customProviders = settings.providers
      .filter((entry) => isCustomAgentProviderId(entry.provider))
      .map((entry) => ({
        id: entry.provider,
        name:
          entry.displayName?.trim() ||
          getDefaultCustomProviderDisplayName(entry.provider),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const openRouterIndex = providers.findIndex(
      (provider) => provider.id === "openrouter",
    );
    if (openRouterIndex >= 0) {
      providers.splice(openRouterIndex + 1, 0, ...customProviders);
    } else {
      providers.push(...customProviders);
    }
    return providers;
  },

  async getAvailableModels(provider: string): Promise<AgentModelDTO[]> {
    const settings = await readSettingsFile();
    const providerId = normalizeAgentProviderId(provider);
    const providerEntry = settings.providers.find(
      (entry) => entry.provider === providerId,
    );
    return getConfiguredModelsForProvider(providerId, providerEntry);
  },

  async resolveAgentModel(
    provider: string,
    modelId: string,
  ): Promise<Model<Api> | null> {
    const settings = await readSettingsFile();
    const providerId = normalizeAgentProviderId(provider);
    const providerEntry = settings.providers.find(
      (entry) => entry.provider === providerId,
    );
    const resolvedModel = resolveConfiguredModel(providerId, modelId, providerEntry);
    if (!resolvedModel) {
      return null;
    }
    if (
      isCustomAgentProviderId(providerId) &&
      resolvedModel.api === "openai-completions"
    ) {
      return {
        ...resolvedModel,
        compat: {
          ...(resolvedModel.compat ?? {}),
          supportsDeveloperRole: false,
        },
      };
    }
    return resolvedModel;
  },

  async getGeneralConfig(): Promise<GeneralConfigDTO> {
    try {
      const raw = await fs.readFile(GLOBAL_CONFIG_PATH, "utf8");
      return normalizeGeneralConfig(JSON.parse(raw));
    } catch {
      // config file doesn't exist yet
    }
    return normalizeGeneralConfig(undefined);
  },

  async saveGeneralConfig(input: {
    workspaceRoot: string;
    language?: AppLanguage;
    themeMode?: AppThemeMode;
    linkOpenMode?: LinkOpenMode;
    mainSubModeEnabled?: boolean;
    quickGuideDismissed?: boolean;
    chatInputShortcutTipDismissed?: boolean;
  }): Promise<void> {
    const currentConfig = await this.getGeneralConfig();
    const nextConfig: GeneralConfigDTO = {
      workspaceRoot: input.workspaceRoot,
      language: isAppLanguage(input.language)
        ? input.language
        : currentConfig.language,
      themeMode: isAppThemeMode(input.themeMode)
        ? input.themeMode
        : currentConfig.themeMode,
      linkOpenMode:
        input.linkOpenMode === "system" || input.linkOpenMode === "builtin"
          ? input.linkOpenMode
          : currentConfig.linkOpenMode,
      mainSubModeEnabled: true,
      quickGuideDismissed:
        typeof input.quickGuideDismissed === "boolean"
          ? input.quickGuideDismissed
          : currentConfig.quickGuideDismissed,
      chatInputShortcutTipDismissed:
        typeof input.chatInputShortcutTipDismissed === "boolean"
          ? input.chatInputShortcutTipDismissed
          : currentConfig.chatInputShortcutTipDismissed,
    };

    await fs.mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      GLOBAL_CONFIG_PATH,
      `${JSON.stringify(
        {
          workspaceRoot: nextConfig.workspaceRoot,
          language: nextConfig.language,
          themeMode: nextConfig.themeMode,
          linkOpenMode: nextConfig.linkOpenMode,
          quickGuideDismissed: nextConfig.quickGuideDismissed,
          chatInputShortcutTipDismissed:
            nextConfig.chatInputShortcutTipDismissed,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  },

  async getMainSubModeEnabled(): Promise<boolean> {
    return true;
  },
};
