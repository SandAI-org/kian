import { CheckCircleOutlined, SearchOutlined } from "@ant-design/icons";
import type { MainLayoutOutletContext } from "@renderer/app/MainLayout";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { api } from "@renderer/lib/api";
import { DEFAULT_APP_LANGUAGE, type AppLanguage } from "@shared/i18n";
import { DEFAULT_APP_THEME_MODE, type AppThemeMode } from "@shared/theme";
import { getAboutUpdatePresentation } from "@renderer/modules/settings/updatePresentation";
import {
  formatKeyboardShortcut,
  keyboardShortcutFromEvent,
} from "@renderer/lib/shortcuts";
import type {
  AgentModelDTO,
  ClaudeConfigStatus,
  AppUpdateStatusDTO,
  CustomAgentModelConfigDTO,
  KeyboardShortcutDTO,
  ProviderConfigEntry,
  ShortcutConfigDTO,
} from "@shared/types";
import {
  DEFAULT_SHORTCUT_CONFIG,
  shortcutConfigToSignature,
} from "@shared/utils/shortcuts";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Col,
  Form,
  Input,
  Progress,
  Row,
  Select,
  Switch,
  Tabs,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";

const SETTINGS_TABS = [
  "general",
  "shortcuts",
  "agent",
  "model",
  "channels",
  "broadcast",
  "about",
] as const;

const CUSTOM_API_PROVIDER = "custom-api";

const CUSTOM_MODEL_API_OPTIONS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "mistral-conversations",
  "google-generative-ai",
  "google-gemini-cli",
  "google-vertex",
  "azure-openai-responses",
  "openai-codex-responses",
  "bedrock-converse-stream",
] as const;

const KNOWN_PROVIDER_META: Record<
  string,
  { keyLabel: string; keyPlaceholder: string }
> = {
  anthropic: { keyLabel: "API Key", keyPlaceholder: "sk-ant-..." },
  openrouter: { keyLabel: "API Key", keyPlaceholder: "sk-or-..." },
  "custom-api": { keyLabel: "API Key", keyPlaceholder: "sk-..." },
  openai: { keyLabel: "API Key", keyPlaceholder: "sk-..." },
  google: { keyLabel: "API Key", keyPlaceholder: "AIza..." },
  mistral: { keyLabel: "API Key", keyPlaceholder: "sk-..." },
  groq: { keyLabel: "API Key", keyPlaceholder: "gsk_..." },
  xai: { keyLabel: "API Key", keyPlaceholder: "xai-..." },
};

const getProviderMeta = (provider: string) =>
  KNOWN_PROVIDER_META[provider] ?? {
    keyLabel: "API Key",
    keyPlaceholder: "sk-...",
  };

const getFieldLabel = (label: string, _filled?: boolean) => label;

const parseDelimitedValues = (raw: string): string[] => {
  const values = raw
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set(values));
};

const parseTelegramUserIds = (raw: string): string[] =>
  parseDelimitedValues(raw);
const normalizeTagValues = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw.map((item) => String(item).trim()).filter((item) => item.length > 0),
    ),
  );
};

const normalizeIdList = (values: string[]): string[] =>
  Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ).sort();

const isSameStringArray = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((item, index) => item === right[index]);

const normalizeBroadcastChannelsForSave = (
  channels: BroadcastChannelDraft[],
): BroadcastChannelDraft[] =>
  channels.map((channel) => ({
    id: channel.id,
    name: channel.name.trim(),
    type: channel.type,
    webhook: channel.webhook.trim(),
  }));

const isSameBroadcastChannelDraft = (
  left: BroadcastChannelDraft[],
  right: BroadcastChannelDraft[],
): boolean =>
  left.length === right.length &&
  left.every((channel, index) => {
    const target = right[index];
    if (!target) return false;
    return (
      channel.id === target.id &&
      channel.name === target.name &&
      channel.type === target.type &&
      channel.webhook === target.webhook
    );
  });

const getUpdateStageLabel = (
  stage: AppUpdateStatusDTO["stage"] | undefined,
): string => {
  switch (stage) {
    case "checking":
      return "正在检查更新";
    case "available":
      return "发现新版本";
    case "downloading":
      return "正在下载更新";
    case "verifying":
      return "正在校验更新包";
    case "downloaded":
      return "更新已下载，可安装";
    case "upToDate":
      return "当前已是最新版本";
    case "failed":
      return "更新失败";
    default:
      return "未检查更新";
  }
};

const DEFAULT_CUSTOM_MODEL_FORM_VALUE = (): CustomModelFormValue => ({
  id: "",
  name: "",
  reasoning: false,
  contextWindow: 128000,
  maxTokens: 16384,
});

const customModelFormValueFromConfig = (
  model: CustomAgentModelConfigDTO,
): CustomModelFormValue => ({
  id: model.id,
  name: model.name ?? "",
  reasoning: model.reasoning,
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
});

const normalizeCustomModelFormValues = (
  values: CustomModelFormValue[],
): CustomAgentModelConfigDTO[] =>
  values
    .map((value) => ({
      id: String(value.id ?? "").trim(),
      name: String(value.name ?? "").trim() || undefined,
      reasoning: Boolean(value.reasoning),
      input: ["text"] as Array<"text" | "image">,
      contextWindow: Number(value.contextWindow ?? 0),
      maxTokens: Number(value.maxTokens ?? 0),
    }))
    .filter((value) => value.id.length > 0);

const customModelConfigSignature = (
  values: CustomAgentModelConfigDTO[],
): string =>
  values
    .map((value) =>
      [
        value.id,
        value.name ?? "",
        value.reasoning ? "1" : "0",
        value.input.join(","),
        value.contextWindow,
        value.maxTokens,
      ].join(":"),
    )
    .join("|");

const customModelConfigToAgentModel = (
  model: CustomAgentModelConfigDTO,
): AgentModelDTO => ({
  id: model.id,
  name: model.name ?? model.id,
  reasoning: model.reasoning,
  input: model.input,
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
  source: "custom",
});
type ClaudeFormValues = {
  provider: string;
  enabled: boolean;
  secret?: string;
  baseUrl?: string;
  api?: string;
  customModels: CustomModelFormValue[];
  enabledModels: string[];
};

type CustomModelFormValue = {
  id: string;
  name?: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
};

type ProviderFormValues = {
  secret?: string;
  enabledModels: string[];
};

const cloneCustomModelFormValues = (
  values: CustomModelFormValue[],
): CustomModelFormValue[] =>
  values.map((value) => ({
    id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    reasoning: Boolean(value.reasoning),
    contextWindow: Number(value.contextWindow ?? 0),
    maxTokens: Number(value.maxTokens ?? 0),
  }));

const getClaudeFormValuesFromProviderConfig = (
  provider: string,
  providerConfig?: ProviderConfigEntry,
): ClaudeFormValues => ({
  provider,
  enabled: providerConfig?.enabled ?? false,
  secret: providerConfig?.apiKey ?? "",
  baseUrl: providerConfig?.baseUrl ?? "",
  api: providerConfig?.api ?? undefined,
  customModels: (providerConfig?.customModels ?? []).map(
    customModelFormValueFromConfig,
  ),
  enabledModels: providerConfig?.enabledModels ?? [],
});

const normalizeClaudeDraftValues = (
  values: Partial<ClaudeFormValues>,
  provider: string,
): ClaudeFormValues => ({
  provider,
  enabled: Boolean(values.enabled),
  secret: String(values.secret ?? ""),
  baseUrl: String(values.baseUrl ?? ""),
  api: String(values.api ?? "").trim() || undefined,
  customModels: cloneCustomModelFormValues(values.customModels ?? []),
  enabledModels: Array.isArray(values.enabledModels)
    ? values.enabledModels.map((value) => String(value))
    : [],
});

const getCustomModelIdsSignatureFromClaudeValues = (
  values: ClaudeFormValues,
): string =>
  normalizeCustomModelFormValues(values.customModels)
    .map((model) => model.id)
    .join("|");

const getNormalizedClaudeDraftFromStatus = (
  provider: string,
  status?: ClaudeConfigStatus,
): ClaudeFormValues =>
  normalizeClaudeDraftValues(
    getClaudeFormValuesFromProviderConfig(provider, status?.providers[provider]),
    provider,
  );

type ChannelFormValues = {
  enabled: boolean;
  botToken?: string;
  appId?: string;
  appSecret?: string;
  userIdsText?: string;
  serverIds?: string[];
  channelIds?: string[];
};

type GeneralFormValues = {
  workspaceRoot: string;
  language: AppLanguage;
  themeMode: AppThemeMode;
  linkOpenMode: "builtin" | "system";
};

type BroadcastChannelDraft = {
  id: string;
  name: string;
  type: string;
  webhook: string;
};

type CheckUpdateOptions = {
  force?: boolean;
  silent?: boolean;
};

type ShortcutFieldKey = keyof ShortcutConfigDTO;

interface ModelSwitchGridItem {
  id: string;
  title: string;
  description: string;
}

type SettingsGuideCardTone = "blue" | "cyan" | "green";

const SettingsGuideCard = ({
  title,
  steps,
  tone = "blue",
}: {
  title: string;
  steps: string[];
  tone?: SettingsGuideCardTone;
}) => (
  <div className={`settings-guide-card settings-guide-card--${tone}`}>
    <div className="settings-guide-card__glow settings-guide-card__glow--primary" />
    <div className="settings-guide-card__glow settings-guide-card__glow--secondary" />
    <Typography.Text strong className="settings-guide-card__title">
      {title}
    </Typography.Text>
    <div className="settings-guide-card__steps">
      {steps.map((step) => (
        <div key={step} className="settings-guide-card__step">
          {step}
        </div>
      ))}
    </div>
  </div>
);

const ThemeModeSelector = ({
  value = DEFAULT_APP_THEME_MODE,
  onChange,
  t,
}: {
  value?: AppThemeMode;
  onChange?: (value: AppThemeMode) => void;
  t: (value: string) => string;
}) => {
  const options: Array<{ value: AppThemeMode; label: string }> = [
    { value: "system", label: t("跟随系统") },
    { value: "light", label: t("浅色模式") },
    { value: "dark", label: t("深色模式") },
  ];

  return (
    <div className="theme-mode-picker" role="radiogroup" aria-label={t("外观")}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`theme-mode-card${selected ? " is-selected" : ""}`}
            onClick={() => onChange?.(option.value)}
          >
            <div className={`theme-mode-card__preview theme-mode-card__preview--${option.value}`}>
              <div className="theme-mode-card__window">
                <div className="theme-mode-card__toolbar">
                  <span className="theme-mode-card__traffic theme-mode-card__traffic--red" />
                  <span className="theme-mode-card__traffic theme-mode-card__traffic--yellow" />
                  <span className="theme-mode-card__traffic theme-mode-card__traffic--green" />
                </div>
                <div className="theme-mode-card__body">
                  <div className="theme-mode-card__sidebar" />
                  <div className="theme-mode-card__content">
                    <div className="theme-mode-card__hero" />
                    <div className="theme-mode-card__line theme-mode-card__line--strong" />
                    <div className="theme-mode-card__line" />
                    <div className="theme-mode-card__line theme-mode-card__line--short" />
                  </div>
                </div>
              </div>
              {option.value === "system" ? (
                <div className="theme-mode-card__window theme-mode-card__window--overlay">
                  <div className="theme-mode-card__toolbar">
                    <span className="theme-mode-card__traffic theme-mode-card__traffic--red" />
                    <span className="theme-mode-card__traffic theme-mode-card__traffic--yellow" />
                    <span className="theme-mode-card__traffic theme-mode-card__traffic--green" />
                  </div>
                  <div className="theme-mode-card__body">
                    <div className="theme-mode-card__sidebar" />
                    <div className="theme-mode-card__content">
                      <div className="theme-mode-card__hero" />
                      <div className="theme-mode-card__line theme-mode-card__line--strong" />
                      <div className="theme-mode-card__line" />
                      <div className="theme-mode-card__line theme-mode-card__line--short" />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <span className="theme-mode-card__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};

const ModelSwitchGrid = ({
  items,
  empty,
  search,
  value = [],
  onChange,
}: {
  items: ModelSwitchGridItem[];
  empty: string;
  search?: string;
  value?: string[];
  onChange?: (value: string[]) => void;
}) => {
  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...value, id] : value.filter((v) => v !== id);
    onChange?.(next);
  };

  const filtered = search
    ? items.filter(
        (item) =>
          item.title.toLowerCase().includes(search.toLowerCase()) ||
          item.id.toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  const sorted = [...filtered].sort((a, b) => {
    const aEnabled = value.includes(a.id) ? 1 : 0;
    const bEnabled = value.includes(b.id) ? 1 : 0;
    return bEnabled - aEnabled;
  });

  if (items.length === 0) {
    return <Typography.Text type="secondary">{empty}</Typography.Text>;
  }

  if (sorted.length === 0) {
    return <Typography.Text type="secondary">无匹配模型</Typography.Text>;
  }

  return (
    <Row gutter={[12, 12]}>
      {sorted.map((item) => (
        <Col key={item.id} span={12}>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="mr-2 min-w-0 flex-1 leading-tight">
              <div className="truncate font-medium text-slate-900">
                {item.title}
              </div>
              <div className="truncate text-xs text-slate-500">
                {item.description}
              </div>
            </div>
            <Switch
              size="small"
              checked={value.includes(item.id)}
              onChange={(checked) => toggle(item.id, checked)}
            />
          </div>
        </Col>
      ))}
    </Row>
  );
};

const ShortcutCaptureInput = ({
  value,
  onChange,
  capturePlaceholder,
  recordingLabel,
  idleLabel,
}: {
  value: KeyboardShortcutDTO;
  onChange: (value: KeyboardShortcutDTO) => void;
  capturePlaceholder: string;
  recordingLabel: string;
  idleLabel: string;
}) => {
  const [isCapturing, setIsCapturing] = useState(false);

  return (
    <Input
      readOnly
      value={isCapturing ? capturePlaceholder : formatKeyboardShortcut(value)}
      onFocus={() => setIsCapturing(true)}
      onBlur={() => setIsCapturing(false)}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          setIsCapturing(false);
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (event.key === "Escape") {
          setIsCapturing(false);
          event.currentTarget.blur();
          return;
        }

        const nextShortcut = keyboardShortcutFromEvent(event.nativeEvent);
        if (!nextShortcut) {
          return;
        }

        const inputElement = event.currentTarget;
        onChange(nextShortcut);
        setIsCapturing(false);
        window.setTimeout(() => {
          inputElement.blur();
        }, 0);
      }}
      suffix={
        <span className="text-[11px] text-slate-400">
          {isCapturing ? recordingLabel : idleLabel}
        </span>
      }
      className="font-mono"
    />
  );
};

export const SettingsPage = () => {
  const { language } = useAppI18n();
  const t = useCallback(
    (value: string): string => translateUiText(language, value),
    [language],
  );
  const { setHeaderActions } = useOutletContext<MainLayoutOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeSettingsTab = useMemo(() => {
    const tab = searchParams.get("tab");
    if (tab && SETTINGS_TABS.includes(tab as (typeof SETTINGS_TABS)[number])) {
      return tab;
    }
    return "general";
  }, [searchParams]);

  const handleSettingsTabChange = useCallback(
    (nextTab: string) => {
      const params = new URLSearchParams(searchParams);
      if (nextTab === "general") {
        params.delete("tab");
      } else {
        params.set("tab", nextTab);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [generalForm] = Form.useForm<GeneralFormValues>();
  const [claudeForm] = Form.useForm<ClaudeFormValues>();
  const [providerForm] = Form.useForm<ProviderFormValues>();
  const [telegramForm] = Form.useForm<ChannelFormValues>();
  const [discordForm] = Form.useForm<ChannelFormValues>();
  const [feishuForm] = Form.useForm<ChannelFormValues>();

  const workspaceRootValue =
    Form.useWatch("workspaceRoot", { form: generalForm, preserve: true }) ?? "";
  const languageValue =
    Form.useWatch("language", { form: generalForm, preserve: true }) ??
    DEFAULT_APP_LANGUAGE;
  const themeModeValue =
    Form.useWatch("themeMode", { form: generalForm, preserve: true }) ??
    DEFAULT_APP_THEME_MODE;
  const linkOpenModeValue =
    Form.useWatch("linkOpenMode", { form: generalForm, preserve: true }) ??
    "builtin";

  const provider = (Form.useWatch("provider", {
    form: claudeForm,
    preserve: true,
  }) ?? "anthropic") as string;
  const providerMeta = getProviderMeta(provider);
  const isCustomApiProvider = provider === CUSTOM_API_PROVIDER;
  const providerEnabled =
    Form.useWatch("enabled", { form: claudeForm, preserve: true }) ?? false;
  const secretValue = Form.useWatch("secret", {
    form: claudeForm,
    preserve: true,
  });
  const baseUrlValue = Form.useWatch("baseUrl", {
    form: claudeForm,
    preserve: true,
  });
  const apiValue = Form.useWatch("api", {
    form: claudeForm,
    preserve: true,
  });
  const customModelsValue =
    Form.useWatch("customModels", { form: claudeForm, preserve: true }) ?? [];
  const enabledModelsValue =
    Form.useWatch("enabledModels", { form: claudeForm, preserve: true }) ?? [];
  const providerSecretValue = Form.useWatch("secret", {
    form: providerForm,
    preserve: true,
  });
  const falEnabledModelsValue =
    Form.useWatch("enabledModels", { form: providerForm, preserve: true }) ??
    [];

  const telegramEnabled =
    Form.useWatch("enabled", { form: telegramForm, preserve: true }) ?? false;
  const telegramBotTokenValue = Form.useWatch("botToken", {
    form: telegramForm,
    preserve: true,
  });
  const telegramUserIdsTextValue = Form.useWatch("userIdsText", {
    form: telegramForm,
    preserve: true,
  });

  const discordEnabled =
    Form.useWatch("enabled", { form: discordForm, preserve: true }) ?? false;
  const discordBotTokenValue = Form.useWatch("botToken", {
    form: discordForm,
    preserve: true,
  });
  const discordServerIdsValue = Form.useWatch("serverIds", {
    form: discordForm,
    preserve: true,
  });
  const discordChannelIdsValue = Form.useWatch("channelIds", {
    form: discordForm,
    preserve: true,
  });

  const feishuEnabled =
    Form.useWatch("enabled", { form: feishuForm, preserve: true }) ?? false;
  const feishuAppIdValue = Form.useWatch("appId", {
    form: feishuForm,
    preserve: true,
  });
  const feishuAppSecretValue = Form.useWatch("appSecret", {
    form: feishuForm,
    preserve: true,
  });

  const [agentModelSearch, setAgentModelSearch] = useState("");
  const [providerModelSearch, setProviderModelSearch] = useState("");
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatusDTO | null>(
    null,
  );
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const autoSaveInFlightRef = useRef(false);
  const aboutAutoCheckTriggeredRef = useRef(false);
  const claudeProviderDraftsRef = useRef<Record<string, ClaudeFormValues>>({});
  const previousCustomModelIdsSignatureRef = useRef<string | null>(null);
  const [broadcastChannelsDraft, setBroadcastChannelsDraft] = useState<
    BroadcastChannelDraft[]
  >([]);
  const [shortcutConfigDraft, setShortcutConfigDraft] =
    useState<ShortcutConfigDTO>(DEFAULT_SHORTCUT_CONFIG);

  const generalConfigQuery = useQuery({
    queryKey: ["settings", "general"],
    queryFn: api.settings.getGeneralConfig,
  });
  const shortcutConfigQuery = useQuery({
    queryKey: ["settings", "shortcuts"],
    queryFn: api.settings.getShortcutConfig,
  });
  const claudeStatusQuery = useQuery({
    queryKey: ["settings", "claude"],
    queryFn: () => api.settings.get({ type: "main" }),
  });
  const availableProvidersQuery = useQuery({
    queryKey: ["settings", "available-providers"],
    queryFn: api.settings.getAvailableProviders,
  });
  const availableModelsQuery = useQuery({
    queryKey: ["settings", "available-models", provider],
    queryFn: () => api.settings.getAvailableModels(provider),
    enabled: Boolean(provider),
  });
  const providerStatusQuery = useQuery({
    queryKey: ["settings", "model-provider", "fal"],
    queryFn: () => api.settings.getModelProviderStatus("fal"),
  });
  const telegramStatusQuery = useQuery({
    queryKey: ["settings", "chat-channel", "telegram"],
    queryFn: api.settings.getTelegramChatChannelStatus,
  });
  const discordStatusQuery = useQuery({
    queryKey: ["settings", "chat-channel", "discord"],
    queryFn: api.settings.getDiscordChatChannelStatus,
  });
  const feishuStatusQuery = useQuery({
    queryKey: ["settings", "chat-channel", "feishu"],
    queryFn: api.settings.getFeishuChatChannelStatus,
  });
  const broadcastChannelsQuery = useQuery({
    queryKey: ["settings", "broadcast-channels"],
    queryFn: api.settings.getBroadcastChannels,
  });
  const updateStatusQuery = useQuery({
    queryKey: ["update", "status"],
    queryFn: api.update.getStatus,
  });

  const saveGeneralMutation = useMutation({
    mutationFn: (values: GeneralFormValues) =>
      api.settings.saveGeneralConfig({
        workspaceRoot: values.workspaceRoot,
        language: values.language,
        themeMode: values.themeMode,
        linkOpenMode: values.linkOpenMode,
        mainSubModeEnabled: true,
        quickGuideDismissed:
          generalConfigQuery.data?.quickGuideDismissed ?? false,
        chatInputShortcutTipDismissed:
          generalConfigQuery.data?.chatInputShortcutTipDismissed ?? false,
      }),
  });
  const saveShortcutConfigMutation = useMutation({
    mutationFn: (values: ShortcutConfigDTO) =>
      api.settings.saveShortcutConfig(values),
  });

  const saveClaudeMutation = useMutation({
    mutationFn: (values: ClaudeFormValues) =>
      api.settings.saveClaudeApiKey({
        provider: values.provider,
        enabled: values.enabled,
        secret: values.secret,
        baseUrl: values.baseUrl,
        api: values.api,
        customModels: normalizeCustomModelFormValues(values.customModels ?? []),
        enabledModels: values.enabledModels,
      }),
  });

  const saveProviderMutation = useMutation({
    mutationFn: (values: ProviderFormValues) =>
      api.settings.saveModelProviderConfig({
        provider: "fal",
        secret: values.secret,
        enabledModels:
          values.enabledModels ?? providerStatusQuery.data?.enabledModels,
      }),
  });

  const saveTelegramMutation = useMutation({
    mutationFn: (values: ChannelFormValues) =>
      api.settings.saveTelegramChatChannelConfig({
        enabled: values.enabled,
        botToken: values.botToken,
        userIds: parseTelegramUserIds(String(values.userIdsText ?? "")),
      }),
  });

  const saveDiscordMutation = useMutation({
    mutationFn: (values: ChannelFormValues) =>
      api.settings.saveDiscordChatChannelConfig({
        enabled: values.enabled,
        botToken: values.botToken,
        serverIds: normalizeTagValues(values.serverIds),
        channelIds: normalizeTagValues(values.channelIds),
      }),
  });

  const saveFeishuMutation = useMutation({
    mutationFn: (values: ChannelFormValues) =>
      api.settings.saveFeishuChatChannelConfig({
        enabled: values.enabled,
        appId: values.appId,
        appSecret: values.appSecret,
      }),
  });
  const saveBroadcastChannelsMutation = useMutation({
    mutationFn: (channels: BroadcastChannelDraft[]) =>
      api.settings.saveBroadcastChannelsConfig({
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name.trim(),
          type: channel.type,
          webhook: channel.webhook.trim(),
        })),
      }),
  });
  const checkUpdateMutation = useMutation({
    mutationFn: (payload?: { force?: boolean }) => api.update.check(payload),
  });
  const installUpdateMutation = useMutation({
    mutationFn: () => api.update.quitAndInstall(),
  });

  const sortedProviders = useMemo(() => {
    const providers = availableProvidersQuery.data ?? [];
    const providerStatuses = claudeStatusQuery.data?.providers ?? {};
    return [...providers].sort((a, b) => {
      const aActive =
        providerStatuses[a.id]?.enabled && providerStatuses[a.id]?.configured
          ? 1
          : 0;
      const bActive =
        providerStatuses[b.id]?.enabled && providerStatuses[b.id]?.configured
          ? 1
          : 0;
      return bActive - aActive;
    });
  }, [availableProvidersQuery.data, claudeStatusQuery.data]);

  const currentClaudeDraft = useMemo(
    () =>
      normalizeClaudeDraftValues(
        {
          provider,
          enabled: providerEnabled,
          secret: secretValue,
          baseUrl: baseUrlValue,
          api: apiValue,
          customModels: customModelsValue,
          enabledModels: enabledModelsValue,
        },
        provider,
      ),
    [
      apiValue,
      baseUrlValue,
      customModelsValue,
      enabledModelsValue,
      provider,
      providerEnabled,
      secretValue,
    ],
  );

  const syncClaudeProviderDraftFromStatus = useCallback(
    (
      providerId: string,
      status?: ClaudeConfigStatus,
      options?: { applyToForm?: boolean },
    ): ClaudeFormValues => {
      const syncedDraft = getNormalizedClaudeDraftFromStatus(providerId, status);
      claudeProviderDraftsRef.current = {
        ...claudeProviderDraftsRef.current,
        [providerId]: syncedDraft,
      };
      if (options?.applyToForm) {
        claudeForm.setFieldsValue(syncedDraft);
        previousCustomModelIdsSignatureRef.current =
          getCustomModelIdsSignatureFromClaudeValues(syncedDraft);
      }
      return syncedDraft;
    },
    [claudeForm],
  );

  useEffect(() => {
    if (!generalConfigQuery.data) return;
    generalForm.setFieldsValue({
      workspaceRoot: generalConfigQuery.data.workspaceRoot,
      language: generalConfigQuery.data.language,
      themeMode: generalConfigQuery.data.themeMode,
      linkOpenMode: generalConfigQuery.data.linkOpenMode,
    });
  }, [generalForm, generalConfigQuery.data]);

  useEffect(() => {
    if (!shortcutConfigQuery.data) return;
    setShortcutConfigDraft(shortcutConfigQuery.data);
  }, [shortcutConfigQuery.data]);

  useEffect(() => {
    if (!provider.trim()) return;
    claudeProviderDraftsRef.current[provider] = currentClaudeDraft;
  }, [currentClaudeDraft, provider]);

  useEffect(() => {
    if (!claudeStatusQuery.data) return;
    const effectiveProvider =
      sortedProviders.length > 0 &&
      !sortedProviders.some((p) => p.id === provider)
        ? sortedProviders[0].id
        : provider;
    const nextDrafts = { ...claudeProviderDraftsRef.current };
    for (const sortedProvider of sortedProviders) {
      if (!nextDrafts[sortedProvider.id]) {
        nextDrafts[sortedProvider.id] = getNormalizedClaudeDraftFromStatus(
          sortedProvider.id,
          claudeStatusQuery.data,
        );
      }
    }
    const nextValues =
      nextDrafts[effectiveProvider] ??
      getClaudeFormValuesFromProviderConfig(
        effectiveProvider,
        claudeStatusQuery.data.providers[effectiveProvider],
      );
    nextDrafts[effectiveProvider] = normalizeClaudeDraftValues(
      nextValues,
      effectiveProvider,
    );
    claudeProviderDraftsRef.current = nextDrafts;
    claudeForm.setFieldsValue(nextDrafts[effectiveProvider]);
    previousCustomModelIdsSignatureRef.current =
      getCustomModelIdsSignatureFromClaudeValues(nextDrafts[effectiveProvider]);
  }, [claudeForm, claudeStatusQuery.data, provider, sortedProviders]);

  useEffect(() => {
    if (!providerStatusQuery.data) return;
    providerForm.setFieldsValue({
      secret: providerStatusQuery.data.secret,
      enabledModels: providerStatusQuery.data.enabledModels,
    });
  }, [providerForm, providerStatusQuery.data]);

  useEffect(() => {
    if (!telegramStatusQuery.data) return;
    telegramForm.setFieldsValue({
      enabled: telegramStatusQuery.data.enabled,
      botToken: telegramStatusQuery.data.botToken,
      userIdsText: telegramStatusQuery.data.userIds.join("\n"),
    });
  }, [telegramForm, telegramStatusQuery.data]);

  useEffect(() => {
    if (!discordStatusQuery.data) return;
    discordForm.setFieldsValue({
      enabled: discordStatusQuery.data.enabled,
      botToken: discordStatusQuery.data.botToken,
      serverIds: discordStatusQuery.data.serverIds,
      channelIds: discordStatusQuery.data.channelIds,
    });
  }, [discordForm, discordStatusQuery.data]);

  useEffect(() => {
    if (!feishuStatusQuery.data) return;
    feishuForm.setFieldsValue({
      enabled: feishuStatusQuery.data.enabled,
      appId: feishuStatusQuery.data.appId,
      appSecret: feishuStatusQuery.data.appSecret,
    });
  }, [feishuForm, feishuStatusQuery.data]);

  useEffect(() => {
    if (!broadcastChannelsQuery.data) return;
    setBroadcastChannelsDraft(
      broadcastChannelsQuery.data.map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        webhook: channel.webhook,
      })),
    );
  }, [broadcastChannelsQuery.data]);

  useEffect(() => {
    const unsubscribe = api.update.subscribeStatus((status) => {
      setUpdateStatus(status);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const providerFilled = Boolean(provider.trim());
  const enabledAgentModelsFilled = enabledModelsValue.length > 0;

  const secretText = String(secretValue ?? "").trim();
  const tokenFilled = Boolean(secretText);
  const baseUrlText = String(baseUrlValue ?? "").trim();
  const apiText = String(apiValue ?? "").trim();
  const normalizedCustomModels = normalizeCustomModelFormValues(customModelsValue);
  const customModelIds = normalizedCustomModels.map((model) => model.id);
  const customModelIdsSignature = customModelIds.join("|");
  const customModelsFilled = normalizedCustomModels.length > 0;
  const availableAgentModels = useMemo(
    () =>
      isCustomApiProvider
        ? normalizedCustomModels.map(customModelConfigToAgentModel)
        : (availableModelsQuery.data ?? []),
    [availableModelsQuery.data, isCustomApiProvider, normalizedCustomModels],
  );

  useEffect(() => {
    if (!isCustomApiProvider) {
      previousCustomModelIdsSignatureRef.current = customModelIdsSignature;
      return;
    }
    if (previousCustomModelIdsSignatureRef.current === null) {
      previousCustomModelIdsSignatureRef.current = customModelIdsSignature;
      return;
    }

    if (previousCustomModelIdsSignatureRef.current === customModelIdsSignature) {
      return;
    }

    const previousIds = previousCustomModelIdsSignatureRef.current
      .split("|")
      .filter(Boolean);
    const addedIds = customModelIds.filter((id) => !previousIds.includes(id));
    const removedIds = previousIds.filter((id) => !customModelIds.includes(id));
    previousCustomModelIdsSignatureRef.current = customModelIdsSignature;

    if (addedIds.length === 0 && removedIds.length === 0) {
      return;
    }

    const currentEnabledModels =
      ((claudeForm.getFieldValue("enabledModels") as string[] | undefined) ?? []);
    const nextEnabledModels = currentEnabledModels.filter(
      (modelId) => !removedIds.includes(modelId),
    );

    for (const modelId of addedIds) {
      if (!nextEnabledModels.includes(modelId)) {
        nextEnabledModels.push(modelId);
      }
    }

    const changed =
      nextEnabledModels.length !== currentEnabledModels.length ||
      nextEnabledModels.some(
        (modelId, index) => modelId !== currentEnabledModels[index],
      );

    if (changed) {
      claudeForm.setFieldsValue({
        enabledModels: nextEnabledModels,
      });
    }
  }, [claudeForm, customModelIds, customModelIdsSignature, isCustomApiProvider]);

  const providerSecretText = String(providerSecretValue ?? "").trim();
  const hasInputProviderToken = Boolean(providerSecretText);
  const hasSavedProviderToken = Boolean(providerStatusQuery.data?.configured);
  const providerTokenFilled = hasInputProviderToken || hasSavedProviderToken;
  const enabledModelsFilled = falEnabledModelsValue.length > 0;

  const telegramBotTokenText = String(telegramBotTokenValue ?? "").trim();
  const hasInputTelegramToken = Boolean(telegramBotTokenText);
  const hasSavedTelegramToken = Boolean(telegramStatusQuery.data?.configured);
  const telegramTokenFilled = hasInputTelegramToken || hasSavedTelegramToken;
  const telegramUserIds = parseTelegramUserIds(
    String(telegramUserIdsTextValue ?? ""),
  );
  const telegramUserIdFilled = telegramUserIds.length > 0;

  const discordBotTokenText = String(discordBotTokenValue ?? "").trim();
  const hasInputDiscordToken = Boolean(discordBotTokenText);
  const hasSavedDiscordToken = Boolean(discordStatusQuery.data?.configured);
  const discordTokenFilled = hasInputDiscordToken || hasSavedDiscordToken;
  const discordServerIds = normalizeTagValues(discordServerIdsValue);
  const discordServerIdsFilled = discordServerIds.length > 0;
  const discordChannelIds = normalizeTagValues(discordChannelIdsValue);
  const discordChannelIdsFilled = discordChannelIds.length > 0;

  const feishuAppIdText = String(feishuAppIdValue ?? "").trim();
  const feishuAppSecretText = String(feishuAppSecretValue ?? "").trim();
  const hasInputFeishuAppId = Boolean(feishuAppIdText);
  const hasInputFeishuAppSecret = Boolean(feishuAppSecretText);
  const hasSavedFeishuCredentials = Boolean(feishuStatusQuery.data?.configured);
  const feishuAppIdFilled = hasInputFeishuAppId || hasSavedFeishuCredentials;
  const feishuAppSecretFilled =
    hasInputFeishuAppSecret || hasSavedFeishuCredentials;

  const normalizedEnabledModels = normalizeIdList(falEnabledModelsValue);
  const savedEnabledModels = normalizeIdList(
    providerStatusQuery.data?.enabledModels ?? [],
  );
  const normalizedTelegramUserIds = normalizeIdList(telegramUserIds);
  const savedTelegramUserIds = normalizeIdList(
    telegramStatusQuery.data?.userIds ?? [],
  );
  const normalizedDiscordServerIds = normalizeIdList(discordServerIds);
  const savedDiscordServerIds = normalizeIdList(
    discordStatusQuery.data?.serverIds ?? [],
  );
  const normalizedDiscordChannelIds = normalizeIdList(discordChannelIds);
  const savedDiscordChannelIds = normalizeIdList(
    discordStatusQuery.data?.channelIds ?? [],
  );
  const normalizedBroadcastChannelsDraft = normalizeBroadcastChannelsForSave(
    broadcastChannelsDraft,
  );
  const savedBroadcastChannels = normalizeBroadcastChannelsForSave(
    (broadcastChannelsQuery.data ?? []).map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      webhook: channel.webhook,
    })),
  );

  const generalConfig = generalConfigQuery.data;
  const generalDirty = generalConfig
    ? String(workspaceRootValue ?? "") !== generalConfig.workspaceRoot ||
      languageValue !== generalConfig.language ||
      themeModeValue !== generalConfig.themeMode ||
      linkOpenModeValue !== generalConfig.linkOpenMode
    : false;
  const savedShortcutConfig =
    shortcutConfigQuery.data ?? DEFAULT_SHORTCUT_CONFIG;
  const shortcutDirty =
    shortcutConfigToSignature(shortcutConfigDraft) !==
    shortcutConfigToSignature(savedShortcutConfig);

  const claudeStatus = claudeStatusQuery.data;
  const providerStatus = providerStatusQuery.data;
  const telegramStatus = telegramStatusQuery.data;
  const discordStatus = discordStatusQuery.data;
  const feishuStatus = feishuStatusQuery.data;

  const currentProviderConfig = claudeStatus?.providers[provider];
  const normalizedEnabledAgentModels = normalizeIdList(enabledModelsValue);
  const savedEnabledAgentModels = normalizeIdList(
    currentProviderConfig?.enabledModels ?? [],
  );
  const savedCustomModelSignature = customModelConfigSignature(
    currentProviderConfig?.customModels ?? [],
  );
  const claudeDirty = claudeStatus
    ? providerEnabled !== (currentProviderConfig?.enabled ?? false) ||
      secretText !== (currentProviderConfig?.apiKey ?? "") ||
      baseUrlText !== String(currentProviderConfig?.baseUrl ?? "") ||
      apiText !== String(currentProviderConfig?.api ?? "") ||
      customModelConfigSignature(normalizedCustomModels) !==
        savedCustomModelSignature ||
      !isSameStringArray(normalizedEnabledAgentModels, savedEnabledAgentModels)
    : false;
  const providerDirty = providerStatus
    ? providerSecretText !== (providerStatus.secret ?? "") ||
      !isSameStringArray(normalizedEnabledModels, savedEnabledModels)
    : false;
  const telegramDirty = telegramStatus
    ? telegramEnabled !== telegramStatus.enabled ||
      telegramBotTokenText !== (telegramStatus.botToken ?? "") ||
      !isSameStringArray(normalizedTelegramUserIds, savedTelegramUserIds)
    : false;
  const discordDirty = discordStatus
    ? discordEnabled !== discordStatus.enabled ||
      discordBotTokenText !== (discordStatus.botToken ?? "") ||
      !isSameStringArray(normalizedDiscordServerIds, savedDiscordServerIds) ||
      !isSameStringArray(normalizedDiscordChannelIds, savedDiscordChannelIds)
    : false;
  const feishuDirty = feishuStatus
    ? feishuEnabled !== feishuStatus.enabled ||
      feishuAppIdText !== (feishuStatus.appId ?? "") ||
      feishuAppSecretText !== (feishuStatus.appSecret ?? "")
    : false;
  const broadcastDirty = broadcastChannelsQuery.data
    ? !isSameBroadcastChannelDraft(
        normalizedBroadcastChannelsDraft,
        savedBroadcastChannels,
      )
    : false;

  const hasUnsavedChanges =
    generalDirty ||
    shortcutDirty ||
    claudeDirty ||
    providerDirty ||
    telegramDirty ||
    discordDirty ||
    feishuDirty ||
    broadcastDirty;
  const resolvedUpdateStatus = updateStatus ?? updateStatusQuery.data ?? null;
  const {
    canInstallUpdate,
    label: updateStatusLabel,
    isUpdateChecking: isUpdateCheckingByStage,
    isUpdateInFlight,
    progressPercent: updateProgressPercent,
    showLatestVersion,
    showProgress,
  } = getAboutUpdatePresentation(resolvedUpdateStatus);
  const isUpdateChecking =
    isUpdateCheckingByStage || checkUpdateMutation.isPending;
  const isSavingAny =
    saveGeneralMutation.isPending ||
    saveShortcutConfigMutation.isPending ||
    saveClaudeMutation.isPending ||
    saveProviderMutation.isPending ||
    saveTelegramMutation.isPending ||
    saveDiscordMutation.isPending ||
    saveFeishuMutation.isPending ||
    saveBroadcastChannelsMutation.isPending;

  const handleAutoSaveChanges = useCallback(async () => {
    if (autoSaveInFlightRef.current) return;
    if (!hasUnsavedChanges) return;
    autoSaveInFlightRef.current = true;
    setAutoSaveError(null);

    const refetchTasks: Array<Promise<unknown>> = [];
    let firstSaveError: string | null = null;
    let savedClaudeProvider: string | null = null;

    const captureSaveError = (error: unknown) => {
      if (firstSaveError) return;
      firstSaveError =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "自动保存失败";
    };

    const runSaveTask = async (
      dirty: boolean,
      task: () => Promise<void>,
      refetch: () => Promise<unknown>,
    ) => {
      if (!dirty) return;
      try {
        await task();
        refetchTasks.push(refetch());
      } catch (error) {
        captureSaveError(error);
      }
    };

    await runSaveTask(
      generalDirty,
      async () => {
        const values = generalForm.getFieldsValue(true) as GeneralFormValues;
        await saveGeneralMutation.mutateAsync({
          workspaceRoot: String(values.workspaceRoot ?? ""),
          language: values.language ?? DEFAULT_APP_LANGUAGE,
          themeMode: values.themeMode ?? DEFAULT_APP_THEME_MODE,
          linkOpenMode:
            values.linkOpenMode === "system" ? "system" : "builtin",
        });
      },
      generalConfigQuery.refetch,
    );

    await runSaveTask(
      shortcutDirty,
      async () => {
        await saveShortcutConfigMutation.mutateAsync(shortcutConfigDraft);
      },
      shortcutConfigQuery.refetch,
    );

    await runSaveTask(
      claudeDirty,
      async () => {
        const values = claudeForm.getFieldsValue(true) as ClaudeFormValues;
        const normalizedSecret = values.secret?.trim();
        const payload: ClaudeFormValues = {
          provider: values.provider,
          enabled: values.enabled,
          secret: normalizedSecret || undefined,
          baseUrl: String(values.baseUrl ?? "").trim() || undefined,
          api: String(values.api ?? "").trim() || undefined,
          customModels: cloneCustomModelFormValues(values.customModels ?? []),
          enabledModels: values.enabledModels,
        };
        savedClaudeProvider = payload.provider.trim();
        await saveClaudeMutation.mutateAsync(payload);
      },
      async () => {
        const result = await claudeStatusQuery.refetch();
        const refreshedStatus = result.data;
        const savedProvider = savedClaudeProvider;
        if (!refreshedStatus || !savedProvider) {
          return result;
        }
        const activeProvider = String(
          claudeForm.getFieldValue("provider") ?? provider,
        ).trim();
        syncClaudeProviderDraftFromStatus(savedProvider, refreshedStatus, {
          applyToForm: activeProvider === savedProvider,
        });
        return result;
      },
    );

    await runSaveTask(
      providerDirty,
      async () => {
        const values = providerForm.getFieldsValue(true) as ProviderFormValues;
        const normalizedSecret = values.secret?.trim();
        await saveProviderMutation.mutateAsync({
          secret: normalizedSecret || undefined,
          enabledModels:
            values.enabledModels ?? providerStatusQuery.data?.enabledModels,
        });
      },
      providerStatusQuery.refetch,
    );

    await runSaveTask(
      telegramDirty,
      async () => {
        const values = telegramForm.getFieldsValue(true) as ChannelFormValues;
        const normalizedToken = values.botToken?.trim();
        await saveTelegramMutation.mutateAsync({
          ...values,
          botToken: normalizedToken || undefined,
        });
      },
      telegramStatusQuery.refetch,
    );

    await runSaveTask(
      discordDirty,
      async () => {
        const values = discordForm.getFieldsValue(true) as ChannelFormValues;
        const normalizedToken = values.botToken?.trim();
        await saveDiscordMutation.mutateAsync({
          ...values,
          botToken: normalizedToken || undefined,
        });
      },
      discordStatusQuery.refetch,
    );

    await runSaveTask(
      feishuDirty,
      async () => {
        const values = feishuForm.getFieldsValue(true) as ChannelFormValues;
        const normalizedAppId = values.appId?.trim();
        const normalizedAppSecret = values.appSecret?.trim();
        await saveFeishuMutation.mutateAsync({
          ...values,
          appId: normalizedAppId || undefined,
          appSecret: normalizedAppSecret || undefined,
        });
      },
      feishuStatusQuery.refetch,
    );

    await runSaveTask(
      broadcastDirty,
      async () => {
        const saved = await saveBroadcastChannelsMutation.mutateAsync(
          normalizedBroadcastChannelsDraft,
        );
        setBroadcastChannelsDraft(
          saved.map((channel) => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            webhook: channel.webhook,
          })),
        );
      },
      broadcastChannelsQuery.refetch,
    );

    try {
      if (refetchTasks.length > 0) {
        await Promise.all(refetchTasks);
      }
    } catch (error) {
      captureSaveError(error);
    } finally {
      autoSaveInFlightRef.current = false;
    }

    if (firstSaveError) {
      setAutoSaveError(firstSaveError);
      message.error(firstSaveError);
      return;
    }

    setAutoSaveError(null);
  }, [
    hasUnsavedChanges,
    generalDirty,
    generalForm,
    generalConfigQuery.refetch,
    saveGeneralMutation.mutateAsync,
    shortcutDirty,
    shortcutConfigDraft,
    shortcutConfigQuery.refetch,
    saveShortcutConfigMutation.mutateAsync,
    claudeDirty,
    claudeForm,
    claudeStatusQuery.refetch,
    discordDirty,
    discordForm,
    discordStatusQuery.refetch,
    feishuDirty,
    feishuForm,
    feishuStatusQuery.refetch,
    broadcastDirty,
    broadcastChannelsQuery.refetch,
    providerDirty,
    providerForm,
    providerStatusQuery.data?.enabledModels,
    providerStatusQuery.refetch,
    normalizedBroadcastChannelsDraft,
    saveClaudeMutation.mutateAsync,
    saveBroadcastChannelsMutation.mutateAsync,
    saveDiscordMutation.mutateAsync,
    saveFeishuMutation.mutateAsync,
    saveProviderMutation.mutateAsync,
    saveTelegramMutation.mutateAsync,
    telegramDirty,
    telegramForm,
    telegramStatusQuery.refetch,
  ]);

  const autoSaveSignature = useMemo(
    () =>
      [
        workspaceRootValue,
        languageValue,
        themeModeValue,
        linkOpenModeValue,
        shortcutConfigToSignature(shortcutConfigDraft),
        provider,
        providerEnabled,
        secretText,
        baseUrlText,
        apiText,
        customModelConfigSignature(normalizedCustomModels),
        normalizedEnabledAgentModels.join(","),
        providerSecretText,
        normalizedEnabledModels.join(","),
        telegramEnabled,
        telegramBotTokenText,
        normalizedTelegramUserIds.join(","),
        discordEnabled,
        discordBotTokenText,
        normalizedDiscordServerIds.join(","),
        normalizedDiscordChannelIds.join(","),
        feishuEnabled,
        feishuAppIdText,
        feishuAppSecretText,
        normalizedBroadcastChannelsDraft
          .map(
            (channel) =>
              `${channel.id}:${channel.name}:${channel.type}:${channel.webhook}`,
          )
          .join(","),
      ].join("|"),
    [
      workspaceRootValue,
      languageValue,
      themeModeValue,
      linkOpenModeValue,
      shortcutConfigDraft,
      provider,
      providerEnabled,
      secretText,
      baseUrlText,
      apiText,
      normalizedCustomModels,
      normalizedEnabledAgentModels,
      providerSecretText,
      normalizedEnabledModels,
      telegramEnabled,
      telegramBotTokenText,
      normalizedTelegramUserIds,
      discordEnabled,
      discordBotTokenText,
      normalizedDiscordServerIds,
      normalizedDiscordChannelIds,
      feishuEnabled,
      feishuAppIdText,
      feishuAppSecretText,
      normalizedBroadcastChannelsDraft,
    ],
  );

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    if (isSavingAny || autoSaveInFlightRef.current) return;

    const timer = window.setTimeout(() => {
      void handleAutoSaveChanges();
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    autoSaveSignature,
    handleAutoSaveChanges,
    hasUnsavedChanges,
    isSavingAny,
  ]);

  useEffect(() => {
    if (hasUnsavedChanges) return;
    if (!autoSaveError) return;
    setAutoSaveError(null);
  }, [autoSaveError, hasUnsavedChanges]);

  const handleCheckUpdate = useCallback(
    async (options?: CheckUpdateOptions) => {
      const force = options?.force ?? true;
      const silent = options?.silent ?? false;
      try {
        const status = await checkUpdateMutation.mutateAsync({ force });
        setUpdateStatus(status);
        if (silent) {
          return;
        }
        if (status.stage === "upToDate") {
          message.success(t("当前已是最新版本"));
          return;
        }
        if (status.stage === "downloaded") {
          message.success(t("新版本已下载完成，可以安装"));
          return;
        }
        if (status.stage === "downloading" || status.stage === "available") {
          message.info(t("发现新版本，正在下载"));
        }
      } catch (error) {
        if (!silent) {
          message.error(
            error instanceof Error ? error.message : t("检查更新失败"),
          );
        }
      }
    },
    [checkUpdateMutation, t],
  );

  const handleInstallUpdate = useCallback(async () => {
    try {
      await installUpdateMutation.mutateAsync();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("安装更新失败"));
    }
  }, [installUpdateMutation, t]);

  useEffect(() => {
    if (activeSettingsTab !== "about") {
      aboutAutoCheckTriggeredRef.current = false;
      return;
    }
    if (aboutAutoCheckTriggeredRef.current) {
      return;
    }
    aboutAutoCheckTriggeredRef.current = true;

    if (
      checkUpdateMutation.isPending ||
      resolvedUpdateStatus?.stage === "checking" ||
      resolvedUpdateStatus?.stage === "downloading" ||
      resolvedUpdateStatus?.stage === "downloaded"
    ) {
      return;
    }

    void handleCheckUpdate({ force: false, silent: true });
  }, [
    activeSettingsTab,
    checkUpdateMutation.isPending,
    handleCheckUpdate,
    resolvedUpdateStatus?.stage,
  ]);

  const handleAddBroadcastChannel = useCallback(() => {
    const nextId =
      broadcastChannelsDraft.reduce((max, channel) => {
        const parsed = Number.parseInt(channel.id, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) return max;
        return parsed > max ? parsed : max;
      }, 0) + 1;
    setBroadcastChannelsDraft((current) => [
      ...current,
      {
        id: String(nextId),
        name: translateUiText(language, `广播渠道 ${nextId}`),
        type: "feishu",
        webhook: "",
      },
    ]);
  }, [broadcastChannelsDraft, language]);

  const handleUpdateBroadcastChannel = useCallback(
    (channelId: string, field: "name" | "type" | "webhook", value: string) => {
      setBroadcastChannelsDraft((current) =>
        current.map((channel) =>
          channel.id === channelId ? { ...channel, [field]: value } : channel,
        ),
      );
    },
    [],
  );

  const handleShortcutChange = useCallback(
    (field: ShortcutFieldKey, value: KeyboardShortcutDTO) => {
      setShortcutConfigDraft((current) => ({
        ...current,
        [field]: value,
      }));
    },
    [],
  );

  const handleShortcutReset = useCallback((field: ShortcutFieldKey) => {
    setShortcutConfigDraft((current) => ({
      ...current,
      [field]: { ...DEFAULT_SHORTCUT_CONFIG[field] },
    }));
  }, []);

  const handleRemoveBroadcastChannel = useCallback((channelId: string) => {
    setBroadcastChannelsDraft((current) =>
      current.filter((channel) => channel.id !== channelId),
    );
  }, []);

  const isConfigSaving = isSavingAny || hasUnsavedChanges;

  const settingsHeaderActions = useMemo(() => {
    return (
      <div className="no-drag flex items-center rounded-full border border-[#dce5f4] bg-white/90 px-3 py-1 shadow-[0_4px_12px_rgba(15,23,42,0.05)]">
        <span
          className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${isConfigSaving ? "bg-[#2f6ff7]" : "bg-[#22c55e]"}`}
        />
        <Typography.Text className="!text-[12px] !leading-[1.2] !text-slate-600">
          {isConfigSaving ? "配置保存中" : "配置已经保存"}
        </Typography.Text>
      </div>
    );
  }, [isConfigSaving]);

  useEffect(() => {
    setHeaderActions(settingsHeaderActions);
    return () => {
      setHeaderActions(null);
    };
  }, [setHeaderActions, settingsHeaderActions]);

  const shortcutItems = useMemo(
    () => [
      {
        key: "sendMessage" as const,
        title: "发送消息",
        description: "聚焦消息发送窗口时触发发送。",
      },
      {
        key: "insertNewline" as const,
        title: "输入换行",
        description: "聚焦消息发送窗口时插入换行。",
      },
      {
        key: "focusMainAgentInput" as const,
        title: "聚焦主 Agent 输入框",
        description: "任意页面下跳转并聚焦主 Agent 输入框。",
      },
      {
        key: "openSettingsPage" as const,
        title: "打开设置页面",
        description: "任意页面下跳转到设置页面。",
      },
      {
        key: "newChatSession" as const,
        title: "新建对话",
        description: "新建当前智能体的对话",
      },
      {
        key: "quickLauncher" as const,
        title: "打开快速启动器",
        description: "任意页面下打开快速启动器。",
      },
    ],
    [],
  );

  return (
    <div className="h-full">
      <div className="h-full w-full">
        <Tabs
          activeKey={activeSettingsTab}
          onChange={handleSettingsTabChange}
          tabPosition="left"
          destroyInactiveTabPane={false}
          animated={false}
          className="settings-sidebar-tabs"
          items={[
            {
              key: "general",
              label: "通用",
              children: (
                <ScrollArea className="h-full">
                  <div className="px-5 pb-5">
                    <Typography.Title level={4} className="!text-slate-900">
                      通用
                    </Typography.Title>

                    <Form
                      form={generalForm}
                      layout="vertical"
                      initialValues={{
                        workspaceRoot: "",
                        language: DEFAULT_APP_LANGUAGE,
                        themeMode: DEFAULT_APP_THEME_MODE,
                        linkOpenMode: "builtin",
                      }}
                    >
                      <Form.Item
                        name="themeMode"
                        label={t("外观")}
                      >
                        <ThemeModeSelector t={t} />
                      </Form.Item>

                      <Form.Item
                        name="workspaceRoot"
                        label="数据存放目录"
                        extra="修改后需要重启应用才能生效。默认：~/KianWorkspace"
                        rules={[
                          { required: true, message: t("数据存放目录不能为空") },
                        ]}
                      >
                        <Input placeholder="~/KianWorkspace" />
                      </Form.Item>

                      <Form.Item
                        name="language"
                        label="语言"
                        extra="选择界面显示语言。"
                      >
                        <Select
                          className="i18n-no-translate"
                          popupClassName="i18n-no-translate"
                          options={[
                            { label: "中文 (简体)", value: "zh-CN" },
                            { label: "English", value: "en-US" },
                            { label: "한국어", value: "ko-KR" },
                            { label: "日本語", value: "ja-JP" },
                          ]}
                        />
                      </Form.Item>

                      <Form.Item
                        name="linkOpenMode"
                        label="打开链接的方式"
                        extra="选择应用内打开，或交给系统默认浏览器处理。"
                      >
                        <Select
                          options={[
                            { label: "内置浏览器", value: "builtin" },
                            { label: "系统默认浏览器", value: "system" },
                          ]}
                        />
                      </Form.Item>
                    </Form>
                  </div>
                </ScrollArea>
              ),
            },
            {
              key: "shortcuts",
              label: "快捷键",
              children: (
                <ScrollArea className="h-full">
                  <div className="px-5 pb-5">
                    <Typography.Title level={4} className="!text-slate-900">
                      {t("快捷键")}
                    </Typography.Title>
                    <div className="mb-4 rounded-xl border border-[#dbe5f5] bg-[#f7faff] px-4 py-3 text-xs text-slate-600">
                      {t("点击输入框后按下新的组合键即可录制，按")}{" "}
                      <strong>Esc</strong> {t("退出录制。")}
                    </div>

                    {shortcutConfigQuery.isLoading ? (
                      <Typography.Text type="secondary">
                        {t("正在加载快捷键配置...")}
                      </Typography.Text>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {shortcutItems.map((item) => (
                          <div
                            key={item.key}
                            className="rounded-xl border border-slate-200 bg-white p-4"
                          >
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <Typography.Text
                                  strong
                                  className="text-slate-900"
                                >
                                  {t(item.title)}
                                </Typography.Text>
                                <div className="mt-1 text-xs text-slate-500">
                                  {t(item.description)}
                                </div>
                              </div>
                              <Button
                                size="small"
                                type="default"
                                className="!rounded-full !border-slate-200 !px-2.5 !text-[12px] !leading-none !text-slate-500 [&>span]:!text-[12px] hover:!border-slate-300 hover:!text-slate-700"
                                onClick={() => handleShortcutReset(item.key)}
                              >
                                {t("恢复默认")}
                              </Button>
                            </div>

                            <ShortcutCaptureInput
                              value={shortcutConfigDraft[item.key]}
                              onChange={(value) =>
                                handleShortcutChange(item.key, value)
                              }
                              capturePlaceholder={t("按下快捷键组合")}
                              recordingLabel={t("录制中")}
                              idleLabel={t("点击后录制")}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              ),
            },
            {
              key: "agent",
              label: "语言模型",
              children: (
                <ScrollArea className="h-full">
                  <div className="px-5 pb-5">
                    <Typography.Title level={4} className="!text-slate-900">
                      语言模型
                    </Typography.Title>
                    <Typography.Paragraph className="!text-slate-600">
                        {t(
                        "选择 Provider 标签页来切换接入方式，配置对应的 API Key 并启用模型。Custom API 与 OpenRouter 平级，用于配置 Custom URL、自定义 API 类型和模型列表。",
                      )}
                    </Typography.Paragraph>

                    <Form
                      form={claudeForm}
                      layout="vertical"
                      initialValues={{
                        provider: "anthropic",
                        enabled: false,
                        customModels: [],
                        enabledModels: [],
                      }}
                    >
                      <Form.Item name="provider" hidden>
                        <Input />
                      </Form.Item>

                      <Tabs
                        activeKey={provider}
                        onChange={(nextProvider) => {
                          if (provider.trim()) {
                            claudeProviderDraftsRef.current[provider] =
                              currentClaudeDraft;
                          }
                          const nextValues =
                            claudeProviderDraftsRef.current[nextProvider] ??
                            getClaudeFormValuesFromProviderConfig(
                              nextProvider,
                              claudeStatusQuery.data?.providers[nextProvider],
                            );
                          claudeProviderDraftsRef.current[nextProvider] =
                            normalizeClaudeDraftValues(
                              nextValues,
                              nextProvider,
                            );
                          claudeForm.setFieldsValue(
                            claudeProviderDraftsRef.current[nextProvider],
                          );
                          previousCustomModelIdsSignatureRef.current =
                            getCustomModelIdsSignatureFromClaudeValues(
                              claudeProviderDraftsRef.current[nextProvider],
                            );
                        }}
                        destroyInactiveTabPane={false}
                        animated={false}
                        items={sortedProviders.map((p) => {
                          const pConfig =
                            claudeStatusQuery.data?.providers[p.id];
                          const active =
                            pConfig?.enabled && pConfig?.configured;
                          return {
                            key: p.id,
                            label: active ? (
                              <span>
                                <CheckCircleOutlined className="mr-1 text-green-500" />
                                {p.name}
                              </span>
                            ) : (
                              p.name
                            ),
                            children: null,
                          };
                        })}
                      />

                      <div className="mt-2">
                        {isCustomApiProvider ? (
                          <Typography.Paragraph className="!text-slate-600">
                            {t(
                              "Custom API 用于接入兼容 OpenAI、Anthropic 或其他受支持协议的服务。API Key 可选；是否填写取决于你的服务是否要求鉴权。",
                            )}
                          </Typography.Paragraph>
                        ) : null}

                        {!isCustomApiProvider ? (
                          <Form.Item name="enabled" valuePropName="checked">
                            <Switch
                              checkedChildren="已启用"
                              unCheckedChildren="未启用"
                            />
                          </Form.Item>
                        ) : null}

                        {isCustomApiProvider ? (
                          <>
                            <Form.Item
                              name="baseUrl"
                              label={getFieldLabel(
                                "自定义 URL",
                                Boolean(baseUrlText),
                              )}
                              extra={t(
                                "填写 API 根地址，不要包含 /chat/completions、/responses、/messages 等具体接口路径。",
                              )}
                              rules={[
                                {
                                  validator: async (_, value) => {
                                    const trimmed = String(value ?? "").trim();
                                    if (!trimmed) {
                                      return Promise.resolve();
                                    }
                                    try {
                                      const parsed = new URL(trimmed);
                                      if (
                                        parsed.protocol === "http:" ||
                                        parsed.protocol === "https:"
                                      ) {
                                        return Promise.resolve();
                                      }
                                    } catch {
                                      // handled below
                                    }
                                    return Promise.reject(
                                      new Error(
                                        t("URL 必须是合法的 http/https 地址"),
                                      ),
                                    );
                                  },
                                },
                              ]}
                            >
                              <Input placeholder="https://api.example.com/v1" />
                            </Form.Item>

                            <Form.Item
                              name="api"
                              label={getFieldLabel(
                                "自定义模型 API 类型",
                                Boolean(apiText),
                              )}
                              extra={t(
                                "选择你的服务实际兼容的协议类型；大多数 OpenAI 兼容服务应选择 openai-completions。",
                              )}
                              rules={[
                                {
                                  validator: async (_, value) => {
                                    const customModels =
                                      normalizeCustomModelFormValues(
                                        (claudeForm.getFieldValue(
                                          "customModels",
                                        ) as
                                          | CustomModelFormValue[]
                                          | undefined) ?? [],
                                      );
                                    const trimmed = String(value ?? "").trim();
                                    if (customModels.length === 0 || trimmed) {
                                      return Promise.resolve();
                                    }
                                    return Promise.reject(
                                      new Error(
                                        t("配置自定义模型时必须选择 API 类型"),
                                      ),
                                    );
                                  },
                                },
                              ]}
                            >
                              <Select
                                allowClear
                                placeholder="请选择"
                                options={CUSTOM_MODEL_API_OPTIONS.map((value) => ({
                                  label: value,
                                  value,
                                }))}
                              />
                            </Form.Item>
                          </>
                        ) : null}

                        <Form.Item
                          name="secret"
                          label={getFieldLabel(
                            providerMeta.keyLabel,
                            tokenFilled,
                          )}
                          extra={
                            isCustomApiProvider
                              ? t(
                                  "Custom API 的 API Key 为可选项；如果你的服务不要求 Bearer Token，可以留空。",
                                )
                              : undefined
                          }
                          rules={[
                            {
                              validator: async (_, value) => {
                                const enabled =
                                  claudeForm.getFieldValue("enabled");
                                if (
                                  enabled &&
                                  !isCustomApiProvider &&
                                  !String(value ?? "").trim()
                                ) {
                                    return Promise.reject(
                                      new Error(
                                        t("启用 Provider 时必须设置 API Key"),
                                      ),
                                    );
                                }
                                const trimmed = String(value ?? "").trim();
                                if (trimmed && trimmed.length < 10) {
                                  return Promise.reject(
                                    new Error(t("凭证长度至少 10 位")),
                                  );
                                }
                                return Promise.resolve();
                              },
                            },
                          ]}
                        >
                          <Input.Password
                            placeholder={providerMeta.keyPlaceholder}
                          />
                        </Form.Item>

                        {isCustomApiProvider ? (
                          <>
                            <Form.Item name="enabled" valuePropName="checked">
                              <Switch
                                checkedChildren="已启用"
                                unCheckedChildren="未启用"
                              />
                            </Form.Item>

                            <Form.List name="customModels">
                              {(fields, { add, remove }) => (
                                <Form.Item
                                  label={getFieldLabel(
                                    "自定义模型",
                                    customModelsFilled,
                                  )}
                                  extra={t(
                                    "这里定义 Custom API 可用的模型。新增后会出现在下方的启用模型列表中。",
                                  )}
                                  className="[&_.ant-form-item-label>label]:after:!content-none"
                                >
                                  <div className="flex flex-col gap-3">
                                    {fields.map((field) => (
                                      <div
                                        key={field.key}
                                        className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                                      >
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                          <Typography.Text strong>
                                            {t(`自定义模型 ${field.name + 1}`)}
                                          </Typography.Text>
                                          <Button
                                            size="small"
                                            type="text"
                                            danger
                                            onClick={() => {
                                              const currentCustomModels =
                                                normalizeCustomModelFormValues(
                                                  ((claudeForm.getFieldValue(
                                                    "customModels",
                                                  ) as CustomModelFormValue[] | undefined) ??
                                                    []),
                                                );
                                              const removedModelId =
                                                currentCustomModels[field.name]?.id;
                                              remove(field.name);
                                              if (!removedModelId) {
                                                return;
                                              }
                                              const currentEnabledModels =
                                                ((claudeForm.getFieldValue(
                                                  "enabledModels",
                                                ) as string[] | undefined) ?? []);
                                              const nextEnabledModels =
                                                currentEnabledModels.filter(
                                                  (modelId) =>
                                                    modelId !== removedModelId,
                                                );
                                              claudeForm.setFieldsValue({
                                                enabledModels: nextEnabledModels,
                                              });
                                            }}
                                          >
                                            {t("删除")}
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                          <Form.Item
                                            {...field}
                                            name={[field.name, "id"]}
                                            label="模型 ID"
                                            rules={[
                                              {
                                                required: true,
                                                message: t("Model ID 不能为空"),
                                              },
                                            ]}
                                          >
                                            <Input placeholder="gpt-4.1-mini" />
                                          </Form.Item>
                                          <Form.Item
                                            {...field}
                                            name={[field.name, "name"]}
                                            label="显示名称"
                                          >
                                            <Input placeholder="留空则使用 Model ID" />
                                          </Form.Item>
                                          <Form.Item
                                            {...field}
                                            name={[field.name, "contextWindow"]}
                                            label="上下文窗口"
                                            rules={[
                                              {
                                                required: true,
                                                message: t("上下文窗口不能为空"),
                                              },
                                            ]}
                                          >
                                            <Input type="number" min={1} />
                                          </Form.Item>
                                          <Form.Item
                                            {...field}
                                            name={[field.name, "maxTokens"]}
                                            label="最大输出 Token"
                                            rules={[
                                              {
                                                required: true,
                                                message: t("最大输出 Token 不能为空"),
                                              },
                                            ]}
                                          >
                                            <Input type="number" min={1} />
                                          </Form.Item>
                                        </div>
                                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                          <Form.Item
                                            {...field}
                                            name={[field.name, "reasoning"]}
                                            label="支持推理"
                                            valuePropName="checked"
                                          >
                                            <Switch
                                              checkedChildren="是"
                                              unCheckedChildren="否"
                                            />
                                          </Form.Item>
                                        </div>
                                      </div>
                                    ))}
                                    <Button
                                      type="dashed"
                                      onClick={() => {
                                        add(DEFAULT_CUSTOM_MODEL_FORM_VALUE());
                                      }}
                                    >
                                      {t("新增自定义模型")}
                                    </Button>
                                  </div>
                                </Form.Item>
                              )}
                            </Form.List>
                          </>
                        ) : null}

                        <Form.Item
                          name="enabledModels"
                          label={
                            <div
                              className="flex items-center justify-between"
                              style={{ width: "100%" }}
                            >
                              <span>
                                {getFieldLabel(
                                  "启用模型",
                                  enabledAgentModelsFilled,
                                )}
                              </span>
                              <Input
                                prefix={
                                  <SearchOutlined className="text-slate-400" />
                                }
                                placeholder="搜索模型"
                                allowClear
                                value={agentModelSearch}
                                onChange={(e) =>
                                  setAgentModelSearch(e.target.value)
                                }
                                className="!w-48 [&_.ant-input]:!text-[12px] [&_.ant-input-prefix]:!text-[12px]"
                                style={{ borderRadius: 999, height: 28 }}
                              />
                            </div>
                          }
                          className="[&_.ant-form-item-label]:!w-full [&_.ant-form-item-label>label]:!w-full [&_.ant-form-item-label>label]:after:!content-none"
                        >
                          <ModelSwitchGrid
                            search={agentModelSearch}
                            items={availableAgentModels.map(
                              (m) => ({
                                id: m.id,
                                title: m.name,
                                description: `${m.id} · ctx ${Math.round(m.contextWindow / 1024)}k · max ${Math.round(m.maxTokens / 1024)}k${m.reasoning ? " · reasoning" : ""}${m.source === "custom" ? ` · ${t("自定义")}` : ""}`,
                              }),
                            )}
                            empty={
                              availableModelsQuery.isLoading
                                ? "加载中..."
                                : "暂无可用模型"
                            }
                          />
                        </Form.Item>
                      </div>
                    </Form>
                  </div>
                </ScrollArea>
              ),
            },
            {
              key: "model",
              label: "音视频模型",
              children: (
                <ScrollArea className="h-full">
                  <div className="px-5 pb-5">
                    <Typography.Title level={4} className="!text-slate-900">
                      音视频模型
                    </Typography.Title>
                    <Typography.Paragraph className="!text-slate-600">
                      当前支持 fal Provider。你可以配置 fal API
                      Key，并启用可用于生图/生视频的模型。
                    </Typography.Paragraph>

                    <Form
                      form={providerForm}
                      layout="vertical"
                      initialValues={{ secret: "", enabledModels: [] }}
                    >
                      <Form.Item label={getFieldLabel("Provider", true)}>
                        <Input value="fal" readOnly />
                      </Form.Item>

                      <Form.Item
                        name="secret"
                        label={getFieldLabel(
                          "fal API Key",
                          providerTokenFilled,
                        )}
                        extra="留空表示保持当前凭证不变"
                        rules={[
                          {
                            validator: async (_, value) => {
                              if (!value) return Promise.resolve();
                              if (String(value).length >= 10)
                                return Promise.resolve();
                              return Promise.reject(
                                new Error(t("凭证长度至少 10 位")),
                              );
                            },
                          },
                        ]}
                      >
                        <Input.Password placeholder="fal_xxx..." />
                      </Form.Item>

                      <Form.Item
                        name="enabledModels"
                        label={
                          <div
                            className="flex items-center justify-between"
                            style={{ width: "100%" }}
                          >
                            <span>
                              {getFieldLabel("启用模型", enabledModelsFilled)}
                            </span>
                            <Input
                              prefix={
                                <SearchOutlined className="text-slate-400" />
                              }
                              placeholder="搜索模型"
                              allowClear
                              value={providerModelSearch}
                              onChange={(e) =>
                                setProviderModelSearch(e.target.value)
                              }
                              className="!w-48 [&_.ant-input]:!text-[12px] [&_.ant-input-prefix]:!text-[12px]"
                              style={{ borderRadius: 999, height: 28 }}
                            />
                          </div>
                        }
                        className="[&_.ant-form-item-label]:!w-full [&_.ant-form-item-label>label]:!w-full [&_.ant-form-item-label>label]:after:!content-none"
                        rules={[
                          {
                            validator: async (_, value) => {
                              if (Array.isArray(value) && value.length > 0)
                                return Promise.resolve();
                              return Promise.reject(
                                new Error(t("请至少启用一个模型")),
                              );
                            },
                          },
                        ]}
                      >
                        <ModelSwitchGrid
                          search={providerModelSearch}
                          items={(providerStatusQuery.data?.models ?? []).map(
                            (model) => ({
                              id: model.modelId,
                              title: model.modelId,
                              description: t(model.modelDescription),
                            }),
                          )}
                          empty="暂无可用模型"
                        />
                      </Form.Item>
                    </Form>
                  </div>
                </ScrollArea>
              ),
            },
            {
              key: "channels",
              label: "渠道",
              children: (
                <ScrollArea className="h-full">
                  <div className="px-5 pb-5">
                    <Typography.Title level={4} className="!text-slate-900">
                      渠道
                    </Typography.Title>
                    <Typography.Paragraph className="!text-slate-600">
                      所有渠道消息统一发送到主 Agent，子智能体
                      聊天仍可在桌面端查看。
                    </Typography.Paragraph>

                    <Tabs
                      defaultActiveKey="telegram"
                      destroyInactiveTabPane={false}
                      animated={false}
                      items={[
                        {
                          key: "telegram",
                          label: "Telegram",
                          children: (
                            <Form
                              form={telegramForm}
                              layout="vertical"
                              initialValues={{
                                enabled: false,
                                botToken: "",
                                userIdsText: "",
                              }}
                            >
                              <Form.Item name="enabled" valuePropName="checked">
                                <Switch
                                  checkedChildren="已启用"
                                  unCheckedChildren="未启用"
                                />
                              </Form.Item>

                              {telegramEnabled ? (
                                <>
                                  <Form.Item
                                    name="botToken"
                                    label={getFieldLabel(
                                      "Telegram Bot Token",
                                      telegramTokenFilled,
                                    )}
                                    extra="留空表示保持当前凭证不变"
                                    rules={[
                                      {
                                        validator: async (_, value) => {
                                          if (!telegramEnabled && !value)
                                            return Promise.resolve();
                                          if (!value) {
                                            if (hasSavedTelegramToken)
                                              return Promise.resolve();
                                            return Promise.reject(
                                              new Error(
                                                t(
                                                  "启用 Telegram 前请先输入 Bot Token",
                                                ),
                                              ),
                                            );
                                          }
                                          if (String(value).length >= 10)
                                            return Promise.resolve();
                                          return Promise.reject(
                                            new Error(t("凭证长度至少 10 位")),
                                          );
                                        },
                                      },
                                    ]}
                                  >
                                    <Input.Password placeholder="123456789:AA..." />
                                  </Form.Item>

                                  <Form.Item
                                    name="userIdsText"
                                    label={getFieldLabel(
                                      "允许用户 user_id",
                                      telegramUserIdFilled,
                                    )}
                                    extra="多个 user_id 使用换行、空格或逗号分隔。"
                                    rules={[
                                      {
                                        validator: async (_, value) => {
                                          const tokens = parseTelegramUserIds(
                                            String(value ?? ""),
                                          );
                                          if (
                                            !telegramEnabled &&
                                            tokens.length === 0
                                          )
                                            return Promise.resolve();
                                          if (tokens.length === 0)
                                            return Promise.reject(
                                              new Error(
                                                t(
                                                  "启用 Telegram 前请先填写 user_id",
                                                ),
                                              ),
                                            );
                                          if (
                                            tokens.some(
                                              (item) => !/^\d+$/.test(item),
                                            )
                                          ) {
                                            return Promise.reject(
                                              new Error(t("user_id 必须为纯数字")),
                                            );
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <Input.TextArea
                                      placeholder="123456789\n987654321"
                                      autoSize={{ minRows: 3, maxRows: 8 }}
                                    />
                                  </Form.Item>

                                  <div className="mt-1">
                                    <SettingsGuideCard
                                      tone="blue"
                                      title={t("Telegram 接入方式指引")}
                                      steps={[
                                        t(
                                          "1. 在 Telegram 中通过 BotFather 创建 Bot，并获取 Bot Token。",
                                        ),
                                        t(
                                          "2. 给 Bot 发送消息，获取自己的 user_id（纯数字）。",
                                        ),
                                        t(
                                          "3. 配置允许与 Bot 对话的 user_id 列表。",
                                        ),
                                      ]}
                                    />
                                  </div>
                                </>
                              ) : null}
                            </Form>
                          ),
                        },
                        {
                          key: "discord",
                          label: "Discord",
                          children: (
                            <Form
                              form={discordForm}
                              layout="vertical"
                              initialValues={{
                                enabled: false,
                                botToken: "",
                                serverIds: [],
                                channelIds: [],
                              }}
                            >
                              <Form.Item name="enabled" valuePropName="checked">
                                <Switch
                                  checkedChildren="已启用"
                                  unCheckedChildren="未启用"
                                />
                              </Form.Item>

                              {discordEnabled ? (
                                <>
                                  <Form.Item
                                    name="botToken"
                                    label={getFieldLabel(
                                      "Discord Bot Token",
                                      discordTokenFilled,
                                    )}
                                    extra="留空表示保持当前凭证不变"
                                    rules={[
                                      {
                                        validator: async (_, value) => {
                                          if (!discordEnabled && !value)
                                            return Promise.resolve();
                                          if (!value) {
                                            if (hasSavedDiscordToken)
                                              return Promise.resolve();
                                            return Promise.reject(
                                              new Error(
                                                t(
                                                  "启用 Discord 前请先输入 Bot Token",
                                                ),
                                              ),
                                            );
                                          }
                                          if (String(value).length >= 10)
                                            return Promise.resolve();
                                          return Promise.reject(
                                            new Error(t("凭证长度至少 10 位")),
                                          );
                                        },
                                      },
                                    ]}
                                  >
                                    <Input.Password placeholder="Discord Bot Token" />
                                  </Form.Item>

                                  <Form.Item
                                    name="serverIds"
                                    label={getFieldLabel(
                                      "允许服务器 ID",
                                      discordServerIdsFilled,
                                    )}
                                    extra="输入多个服务器 ID，每个 ID 按回车生成标签。"
                                    rules={[
                                      {
                                        validator: async (_, value) => {
                                          const tokens =
                                            normalizeTagValues(value);
                                          if (
                                            !discordEnabled &&
                                            tokens.length === 0
                                          )
                                            return Promise.resolve();
                                          if (tokens.length === 0)
                                            return Promise.reject(
                                              new Error(
                                                t(
                                                  "启用 Discord 前请先填写允许服务器 ID",
                                                ),
                                              ),
                                            );
                                          if (
                                            tokens.some(
                                              (item) => !/^\d+$/.test(item),
                                            )
                                          ) {
                                            return Promise.reject(
                                              new Error(
                                                t("服务器 ID 必须为纯数字"),
                                              ),
                                            );
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <Select
                                      mode="tags"
                                      open={false}
                                      tokenSeparators={[",", " ", "\n"]}
                                      placeholder="输入服务器 ID 后按回车"
                                    />
                                  </Form.Item>

                                  <Form.Item
                                    name="channelIds"
                                    label={getFieldLabel(
                                      "允许频道 ID",
                                      discordChannelIdsFilled,
                                    )}
                                    extra="输入多个频道 ID，每个 ID 按回车生成标签。"
                                    rules={[
                                      {
                                        validator: async (_, value) => {
                                          const tokens =
                                            normalizeTagValues(value);
                                          if (
                                            !discordEnabled &&
                                            tokens.length === 0
                                          )
                                            return Promise.resolve();
                                          if (tokens.length === 0)
                                            return Promise.reject(
                                              new Error(
                                                t(
                                                  "启用 Discord 前请先填写允许频道 ID",
                                                ),
                                              ),
                                            );
                                          if (
                                            tokens.some(
                                              (item) => !/^\d+$/.test(item),
                                            )
                                          ) {
                                            return Promise.reject(
                                              new Error(t("频道 ID 必须为纯数字")),
                                            );
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <Select
                                      mode="tags"
                                      open={false}
                                      tokenSeparators={[",", " ", "\n"]}
                                      placeholder="输入频道 ID 后按回车"
                                    />
                                  </Form.Item>

                                  <div className="mt-1">
                                    <SettingsGuideCard
                                      tone="cyan"
                                      title={t("Discord 接入方式指引")}
                                      steps={[
                                        t(
                                          "1. 在 Discord Developer Portal 创建应用并添加 Bot，复制 Bot Token。",
                                        ),
                                        t(
                                          "2. 将 Bot 邀请进目标服务器并授予可读取/发送消息权限。",
                                        ),
                                        t(
                                          "3. 配置允许接入的服务器 ID 与频道 ID。",
                                        ),
                                      ]}
                                    />
                                  </div>
                                </>
                              ) : null}
                            </Form>
                          ),
                        },
                        {
                          key: "feishu",
                          label: "飞书",
                          children: (
                            <Form
                              form={feishuForm}
                              layout="vertical"
                              initialValues={{
                                enabled: false,
                                appId: "",
                                appSecret: "",
                              }}
                            >
                              <Form.Item name="enabled" valuePropName="checked">
                                <Switch
                                  checkedChildren="已启用"
                                  unCheckedChildren="未启用"
                                />
                              </Form.Item>

                              {feishuEnabled ? (
                                <>
                                  <Form.Item
                                    name="appId"
                                    label={getFieldLabel(
                                      "飞书应用 AppID",
                                      feishuAppIdFilled,
                                    )}
                                    extra="留空表示保持当前凭证不变"
                                    rules={[
                                      {
                                        validator: async (_, value) => {
                                          if (!feishuEnabled && !value)
                                            return Promise.resolve();
                                          if (!value) {
                                            if (hasSavedFeishuCredentials)
                                              return Promise.resolve();
                                            return Promise.reject(
                                              new Error(
                                                t("启用飞书前请先输入 AppID"),
                                              ),
                                            );
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <Input placeholder="cli_xxx" />
                                  </Form.Item>

                                  <Form.Item
                                    name="appSecret"
                                    label={getFieldLabel(
                                      "飞书应用 AppSecret",
                                      feishuAppSecretFilled,
                                    )}
                                    extra="留空表示保持当前凭证不变"
                                    rules={[
                                      {
                                        validator: async (_, value) => {
                                          if (!feishuEnabled && !value)
                                            return Promise.resolve();
                                          if (!value) {
                                            if (hasSavedFeishuCredentials)
                                              return Promise.resolve();
                                            return Promise.reject(
                                              new Error(
                                                t("启用飞书前请先输入 AppSecret"),
                                              ),
                                            );
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <Input.Password placeholder="sec_xxx" />
                                  </Form.Item>

                                  <div className="mt-1">
                                    <SettingsGuideCard
                                      tone="green"
                                      title={t("飞书接入方式指引")}
                                      steps={[
                                        t(
                                          "1. 在飞书开发者后台创建应用，获取 app_id 与 app_secret。",
                                        ),
                                        t(
                                          "2. 在配置中分别填写 AppID 与 AppSecret。",
                                        ),
                                        t(
                                          "3. 事件与回调使用长链接接受事件，添加 im.message.receive_v1 事件。",
                                        ),
                                        t(
                                          "4. 添加 im:message 和 im:resource 权限。",
                                        ),
                                        t(
                                          "5. 成员管理中只添加自己（自己使用确保安全，同时可以免审核发布）。",
                                        ),
                                      ]}
                                    />
                                  </div>
                                </>
                              ) : null}
                            </Form>
                          ),
                        },
                      ]}
                    />
                  </div>
                </ScrollArea>
              ),
            },
            {
              key: "broadcast",
              label: "广播渠道",
              children: (
                <ScrollArea className="h-full">
                  <div className="px-5 pb-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <Typography.Title
                        level={4}
                        className="!mb-0 !text-slate-900"
                      >
                        广播渠道
                      </Typography.Title>
                      <div className="flex items-center gap-2">
                        <Button onClick={handleAddBroadcastChannel}>
                          新增渠道
                        </Button>
                      </div>
                    </div>

                    <Typography.Paragraph className="!text-slate-600">
                      使用哪个渠道广播消息，Kian 说了算。
                    </Typography.Paragraph>

                    {broadcastChannelsQuery.isLoading ? (
                      <Typography.Text type="secondary">
                        正在加载广播渠道...
                      </Typography.Text>
                    ) : broadcastChannelsDraft.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
                        <Typography.Text type="secondary">
                          还没有广播渠道，点击“新增渠道”开始配置。
                        </Typography.Text>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {broadcastChannelsDraft.map((channel) => (
                          <div
                            key={channel.id}
                            className="rounded-xl border border-slate-200 bg-white p-4"
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <Typography.Text className="!text-xs !text-slate-500">
                                ID: {channel.id}
                              </Typography.Text>
                              <Button
                                danger
                                type="text"
                                onClick={() =>
                                  handleRemoveBroadcastChannel(channel.id)
                                }
                              >
                                删除
                              </Button>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              <Input
                                value={channel.name}
                                placeholder="渠道名称"
                                onChange={(event) =>
                                  handleUpdateBroadcastChannel(
                                    channel.id,
                                    "name",
                                    event.target.value,
                                  )
                                }
                              />
                              <Select
                                value={channel.type || "feishu"}
                                onChange={(value) =>
                                  handleUpdateBroadcastChannel(
                                    channel.id,
                                    "type",
                                    value,
                                  )
                                }
                                options={[
                                  { label: "飞书", value: "feishu" },
                                  { label: "企业微信", value: "wechat" },
                                ]}
                              />
                            </div>
                            <Input
                              className="mt-3"
                              value={channel.webhook}
                              placeholder={
                                channel.type === "wechat"
                                  ? "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                                  : "https://open.feishu.cn/open-apis/bot/v2/hook/..."
                              }
                              onChange={(event) =>
                                handleUpdateBroadcastChannel(
                                  channel.id,
                                  "webhook",
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 space-y-3">
                      <SettingsGuideCard
                        tone="green"
                        title={t("如何获取飞书群机器人 Webhook")}
                        steps={[
                          t("1. 打开目标飞书群，点击右上角”设置”。"),
                          t("2. 进入”群机器人”，添加”自定义机器人”。"),
                          t(
                            "3. 按提示设置机器人名称与安全策略（如关键词或签名）。",
                          ),
                          t(
                            "4. 创建完成后复制 Webhook 地址，粘贴到上方渠道配置中。",
                          ),
                        ]}
                      />

                      <SettingsGuideCard
                        tone="cyan"
                        title={t("如何获取企业微信群机器人 Webhook")}
                        steps={[
                          t("1. 打开企业微信桌面端，进入目标群聊。"),
                          t(
                            "2. 右键群聊，选择”添加群机器人”，点击”新创建一个机器人”。",
                          ),
                          t("3. 设置机器人名称和头像，点击”添加”。"),
                          t(
                            "4. 创建完成后复制 Webhook 地址，粘贴到上方渠道配置中。",
                          ),
                        ]}
                      />
                    </div>
                  </div>
                </ScrollArea>
              ),
            },
            {
              key: "about",
              label: t("关于"),
              children: (
                <ScrollArea className="h-full">
                  <div className="px-5 pb-5">
                    <Typography.Title level={4} className="!text-slate-900">
                      {t("关于")}
                    </Typography.Title>
                    <div className="rounded-xl border border-[#dbe5f5] bg-white p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <Typography.Text className="!text-slate-500">
                            {t("当前版本")}{" "}
                            {resolvedUpdateStatus?.currentVersion ?? "-"}
                          </Typography.Text>
                        </div>
                        <Button
                          onClick={() => {
                            void handleCheckUpdate();
                          }}
                          loading={isUpdateChecking}
                          disabled={isUpdateInFlight}
                        >
                          {t("检查更新")}
                        </Button>
                      </div>

                      {updateStatusLabel ? (
                        <div className="mb-2 text-sm text-slate-700">
                          {t(updateStatusLabel)}
                        </div>
                      ) : null}

                      {showLatestVersion ? (
                        <div className="mb-2 text-xs text-slate-500">
                          {t("最新版本：")}
                          {resolvedUpdateStatus?.latestVersion ?? "-"}
                        </div>
                      ) : null}

                      {showProgress ? (
                        <div className="mb-3">
                          <Progress
                            percent={updateProgressPercent}
                            size="small"
                            status={canInstallUpdate ? "success" : "active"}
                          />
                        </div>
                      ) : null}

                      {resolvedUpdateStatus?.message ? (
                        <Typography.Paragraph className="!mb-3 !text-xs !text-slate-500">
                          {t(resolvedUpdateStatus.message)}
                        </Typography.Paragraph>
                      ) : null}

                      {canInstallUpdate ? (
                        <div className="flex items-center gap-2">
                          <Button
                            type="primary"
                            onClick={() => {
                              void handleInstallUpdate();
                            }}
                            loading={installUpdateMutation.isPending}
                          >
                            {t("安装更新")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </ScrollArea>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
};
