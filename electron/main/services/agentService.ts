import { Type, type AssistantMessageEvent } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  DefaultResourceLoader,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type {
  ChatAttachmentDTO,
  ChatCapabilityMode,
  ChatInterruptPayload,
  ChatMessageMetadata,
  ChatMessageSourceInfo,
  ChatModuleType,
  ChatQueueDeliveryMode,
  ChatQueuedMessageDTO,
  ChatQueuePayload,
  ChatScope,
  ChatSendPayload,
  ChatSendResponse,
  ChatSessionKind,
  ChatStreamEvent,
  ChatThinkingLevel,
  ClaudeConfigStatus,
  DelegationContext,
  ModuleType,
} from "@shared/types";
import { app } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildSessionSystemPrompt,
  type SessionContextFile,
} from "./agentPrompt";
import { appOperationEvents } from "./appOperationEvents";
import { createAppOperationTools } from "./appOperationMcpServer";
import { createBuiltinTools } from "./builtinMcpServer";
import {
  applyChatStreamEventToTimeline,
  createChatTurnTimelineState,
  formatUserMessageContent,
  persistChatTurnTimeline,
  persistUserMessage,
  type ChatTurnTimelineState,
} from "./chatTurnTimeline";
import { buildContextSnapshotSection } from "./contextSnapshotFormatter";
import { toToolDefinition, type CustomToolDef } from "./customTools";
import { logger } from "./logger";
import {
  attachAgentLlmRequestDebug,
} from "./llmRequestDebug";
import { buildMcpServerSignature, createMcpRuntime } from "./mcpRuntime";
import {
  buildExtendedMarkdown,
  buildMediaMarkdown,
  detectAttachmentMediaKind,
  normalizeMediaMarkdownInText,
  resolveAttachmentAbsolutePath,
} from "./mediaMarkdown";
import { repositoryService } from "./repositoryService";
import { settingsService } from "./settingsService";
import { skillService } from "./skillService";
import {
  GLOBAL_CONFIG_DIR,
  INTERNAL_ROOT,
  WORKSPACE_ROOT,
} from "./workspacePaths";

// ---------------------------------------------------------------------------
// Agent Session Store — maps projectId+chatSessionId → AgentSession
// ---------------------------------------------------------------------------

type AgentSessionEntry = {
  session: AgentSession;
  unsubscribe: () => void;
  modelId: string;
  modelConfigSignature: string;
  thinkingLevel: ChatThinkingLevel;
  mcpSignature: string;
  sessionKind: ChatSessionKind;
  capabilityMode: ChatCapabilityMode;
  systemPromptSignature: string;
  disposeMcpRuntime: () => Promise<void>;
  toolNames: string[];
  activeSkillNames: string[];
  delegationToolRuntime: DelegationToolRuntime;
};

type ActiveAgentRequestState = {
  requestId: string;
  interrupted: boolean;
  pendingTurnCount: number;
  observedTurnLifecycle: boolean;
  agentEnded: boolean;
  resolvePromptDone?: () => void;
  queuedRequests: QueuedAgentRequestState[];
  activeQueuedRequest?: ActiveQueuedRequestTurnState;
};

type QueuedAgentRequestState = {
  requestId: string;
  deliveryMode: ChatQueueDeliveryMode;
  message: string;
  attachments?: ChatAttachmentDTO[];
  matchText: string;
  queuedAt: string;
};

type ActiveQueuedRequestTurnState = {
  requestId: string;
  timelineState: ChatTurnTimelineState;
  assistantText: string;
  toolActions: Set<string>;
  toolOutputCount: number;
  assistantErrorMessage: string;
  toolErrorMessage: string;
};

type DelegationReportState = {
  reported: boolean;
  appendedReport?: {
    status: "completed" | "failed";
    result: string;
  };
};

type DelegationToolRuntime = {
  chatSessionId: string;
  delegationContext?: DelegationContext;
  delegationReportState?: DelegationReportState;
};

type DeveloperMetadata = {
  name?: string;
  email?: string;
};

const agentSessionStore = new Map<string, AgentSessionEntry>();
const activeAgentRequestStore = new Map<string, ActiveAgentRequestState>();
const freshSessionOnNextPrompt = new Set<string>();
const refreshSessionOnNextPrompt = new Set<string>();
const delegatedSessionStore = new Map<string, string>();
let appDeveloperMetadataCache: DeveloperMetadata | null | undefined = undefined;
const isDevelopmentMode =
  !app.isPackaged || process.env.NODE_ENV === "development";
const DEFAULT_CHAT_THINKING_LEVEL: ChatThinkingLevel = "low";
const DEFAULT_STREAMING_BEHAVIOR = "followUp" as const;
const MAIN_AGENT_ID = "main-agent";
const MAIN_AGENT_NAME = "主 Agent";
const EMPTY_AGENT_FINAL_MESSAGE = "已处理请求，但未收到 Agent 文本回复。";
const SUCCESS_WITHOUT_TEXT_FINAL_MESSAGE = "已处理完成。";
const nowISO = (): string => new Date().toISOString();

const buildAgentModelConfigSignature = (input: {
  provider: string;
  apiKey?: string;
  model: {
    id: string;
    api: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    compat?: unknown;
    reasoning?: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
  };
}): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        provider: input.provider,
        apiKey: input.apiKey ?? null,
        modelId: input.model.id,
        api: input.model.api,
        baseUrl: input.model.baseUrl ?? null,
        headers: input.model.headers ?? null,
        compat: input.model.compat ?? null,
        reasoning: input.model.reasoning ?? false,
        input: input.model.input ?? [],
        contextWindow: input.model.contextWindow ?? null,
        maxTokens: input.model.maxTokens ?? null,
      }),
    )
    .digest("hex");

const buildTextSignature = (value: string): string =>
  createHash("sha256").update(value).digest("hex");


const resolveEffectiveAgentModelSelection = (
  status: ClaudeConfigStatus,
  modelOverride?: string,
): {
  provider: string;
  modelId: string;
  modelSource:
    | "payload.model"
    | "settings.lastSelectedModel"
    | "settings.firstEnabledModel";
} => {
  if (modelOverride && modelOverride.includes(":")) {
    const sepIdx = modelOverride.indexOf(":");
    return {
      provider: modelOverride.slice(0, sepIdx),
      modelId: modelOverride.slice(sepIdx + 1),
      modelSource: "payload.model",
    };
  }
  const savedScopeModel = status.lastSelectedModel?.trim();
  if (savedScopeModel) {
    const sepIdx = savedScopeModel.indexOf(":");
    if (sepIdx > 0 && sepIdx < savedScopeModel.length - 1) {
      return {
        provider: savedScopeModel.slice(0, sepIdx),
        modelId: savedScopeModel.slice(sepIdx + 1),
        modelSource: "settings.lastSelectedModel",
      };
    }
  }
  const first = status.allEnabledModels[0];
  return {
    provider: first?.provider ?? "anthropic",
    modelId: modelOverride ?? first?.modelId ?? "",
    modelSource: "settings.firstEnabledModel",
  };
};

const registerActiveRequestTurnStarted = (
  storeKey: string,
  requestId: string,
): boolean => {
  const state = activeAgentRequestStore.get(storeKey);
  if (!state || state.requestId !== requestId) {
    return false;
  }

  state.observedTurnLifecycle = true;
  state.agentEnded = false;
  state.pendingTurnCount += 1;
  return true;
};

const markActiveRequestTurnCompleted = (
  storeKey: string,
  requestId: string,
): boolean => {
  const state = activeAgentRequestStore.get(storeKey);
  if (!state || state.requestId !== requestId) {
    return false;
  }

  state.pendingTurnCount = Math.max(0, state.pendingTurnCount - 1);
  if (state.agentEnded && state.pendingTurnCount === 0) {
    state.resolvePromptDone?.();
  }
  return true;
};

const markActiveRequestAgentEnded = (
  storeKey: string,
  requestId: string,
): boolean => {
  const state = activeAgentRequestStore.get(storeKey);
  if (!state || state.requestId !== requestId) {
    return false;
  }

  state.agentEnded = true;
  if (!state.observedTurnLifecycle || state.pendingTurnCount === 0) {
    state.resolvePromptDone?.();
  }
  return true;
};

const getScopeKey = (scope: ChatScope): string =>
  scope.type === "main" ? MAIN_AGENT_ID : scope.projectId;

const getSessionStoreKey = (scope: ChatScope, chatSessionId: string): string =>
  `${getScopeKey(scope)}:${chatSessionId}`;

const getAgentLogLabel = (scope: ChatScope): string =>
  scope.type === "main" ? MAIN_AGENT_NAME : `子智能体(${scope.projectId})`;

const collectExplicitSkillPaths = (
  skills: Array<{ skillFilePath: string }>,
): string[] =>
  Array.from(
    new Set(
      skills
        .map((skill) => skill.skillFilePath.trim())
        .filter((skillFilePath) => skillFilePath.length > 0),
    ),
  );

const isAbortLikeError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    name.includes("abort") ||
    name.includes("cancel") ||
    message.includes("abort") ||
    message.includes("cancel") ||
    message.includes("interrupted")
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const isPdfAttachment = (
  attachment: Pick<ChatAttachmentDTO, "name" | "path" | "mimeType">,
): boolean => {
  const mime = attachment.mimeType?.toLowerCase().trim();
  if (mime === "application/pdf") return true;
  const ext = path.extname(attachment.path || attachment.name).toLowerCase();
  return ext === ".pdf";
};

const resolveImageMimeType = (
  attachment: Pick<ChatAttachmentDTO, "name" | "path" | "mimeType">,
  absolutePath: string,
): string => {
  const mime = attachment.mimeType?.toLowerCase().trim();
  if (mime?.startsWith("image/")) return mime;
  const ext = path
    .extname(absolutePath || attachment.path || attachment.name)
    .toLowerCase();
  return IMAGE_MIME_BY_EXTENSION[ext] ?? "image/png";
};

type ImageContentBlock = {
  type: "image";
  data: string;
  mimeType: string;
};

type AttachmentBuildResult = {
  promptText: string;
  images: ImageContentBlock[];
};

type StructuredPromptContent = Array<
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
>;

type PromptContentBuildResult = {
  fullPromptText: string;
  promptContent: string | StructuredPromptContent;
};

const formatChannelProviderLabel = (
  provider: ChatMessageSourceInfo["provider"],
): string => {
  if (provider === "feishu") return "飞书";
  if (provider === "discord") return "Discord";
  if (provider === "telegram") return "Telegram";
  if (provider === "weixin") return "微信";
  if (provider === "broadcast") return "广播";
  return "未知渠道";
};

const buildPromptMessageText = (input: {
  message: string;
  messageSourceInfo?: ChatMessageSourceInfo;
}): string => {
  const messageText = input.message.trim() || "（仅上传了附件）";
  const sourceInfo = input.messageSourceInfo;
  if (!sourceInfo || sourceInfo.kind !== "channel_event") {
    return messageText;
  }

  const senderName = sourceInfo.senderName?.trim() || "";
  const senderId = sourceInfo.senderId?.trim() || "";
  const lines = [
    "[渠道消息上下文]",
    `渠道：${formatChannelProviderLabel(sourceInfo.provider)}`,
    `会话类型：${sourceInfo.chatType === "group" ? "群聊" : "私聊"}`,
    `发送者：${senderName || senderId || "未知"}`,
  ];

  if (senderId && senderId !== senderName) {
    lines.push(`发送者 ID：${senderId}`);
  }
  if (typeof sourceInfo.isOwner === "boolean") {
    lines.push(`发送者身份：${sourceInfo.isOwner ? "拥有者" : "非拥有者"}`);
  }
  if (typeof sourceInfo.mentioned === "boolean") {
    lines.push(`提及状态：${sourceInfo.mentioned ? "被提及" : "未提及"}`);
  }
  if (sourceInfo.capabilityMode) {
    lines.push(
      `渠道能力：${sourceInfo.capabilityMode === "full" ? "完整 Agent" : "仅聊天"}`,
    );
  }
  if (
    typeof sourceInfo.batchedCount === "number" &&
    sourceInfo.batchedCount > 1
  ) {
    lines.push(`批量消息数：${sourceInfo.batchedCount}`);
  }

  lines.push("消息正文：", messageText);
  return lines.join("\n");
};

const buildAttachmentContent = async (
  scope: ChatScope,
  attachments: ChatSendPayload["attachments"],
): Promise<AttachmentBuildResult> => {
  if (!attachments || attachments.length === 0) {
    return { promptText: "", images: [] };
  }

  const lines: string[] = [];
  const images: ImageContentBlock[] = [];

  for (const file of attachments) {
    const absolutePath = resolveAttachmentAbsolutePath(scope, file.path);
    const mediaKind = detectAttachmentMediaKind(file);
    const isPdf = isPdfAttachment(file);
    const previewSyntax = mediaKind
      ? buildMediaMarkdown(mediaKind, absolutePath)
      : buildExtendedMarkdown("file", absolutePath);

    if (mediaKind === "image") {
      try {
        const binary = await readFile(absolutePath);
        const data = binary.toString("base64");
        lines.push(
          `[Attached image: ${file.name}]\nFile path: ${absolutePath}`,
        );
        images.push({
          type: "image",
          data,
          mimeType: resolveImageMimeType(file, absolutePath),
        });
        continue;
      } catch (error) {
        logger.warn("Failed to load image attachment", {
          filePath: absolutePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (isPdf) {
      lines.push(`[Attached PDF: ${file.name}]\nFile path: ${absolutePath}`);
      lines.push(previewSyntax);
      continue;
    }

    lines.push(`[Attached file: ${file.name}]\nFile path: ${absolutePath}`);
    lines.push(previewSyntax);
  }

  return {
    promptText: lines.join("\n"),
    images,
  };
};

const buildPromptContent = (input: {
  message: string;
  messageSourceInfo?: ChatMessageSourceInfo;
  attachmentContent: AttachmentBuildResult;
}): PromptContentBuildResult => {
  const messageText = buildPromptMessageText({
    message: input.message,
    messageSourceInfo: input.messageSourceInfo,
  });
  const fullPromptText = input.attachmentContent.promptText
    ? `${messageText}\n\n${input.attachmentContent.promptText}`
    : messageText;

  if (input.attachmentContent.images.length === 0) {
    return {
      fullPromptText,
      promptContent: fullPromptText,
    };
  }

  const contentParts: StructuredPromptContent = [
    { type: "text", text: fullPromptText },
  ];
  for (const img of input.attachmentContent.images) {
    contentParts.push({
      type: "image",
      data: img.data,
      mimeType: img.mimeType,
    });
  }
  return {
    fullPromptText,
    promptContent: contentParts,
  };
};

const buildFinalAssistantMessage = (input: {
  assistantText: string;
  assistantErrorMessage: string;
  toolErrorMessage: string;
  interrupted: boolean;
  toolOutputCount: number;
  toolActionsCount: number;
}): string =>
  normalizeMediaMarkdownInText(
    input.assistantText.trim() ||
      (input.interrupted
        ? "已停止当前回答。"
        : input.assistantErrorMessage
          ? `处理失败：${input.assistantErrorMessage}`
          : input.toolErrorMessage
            ? `处理失败：${input.toolErrorMessage}`
            : input.toolOutputCount > 0 || input.toolActionsCount > 0
              ? SUCCESS_WITHOUT_TEXT_FINAL_MESSAGE
              : EMPTY_AGENT_FINAL_MESSAGE),
  );

const getUserMessageText = (
  message: { role?: string; content?: unknown } | undefined,
): string => {
  if (!message || message.role !== "user") return "";
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        Boolean(part) &&
        typeof part === "object" &&
        "type" in part &&
        "text" in part &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("");
};

const getScopeCwd = (scope: ChatScope): string =>
  scope.type === "main"
    ? path.join(INTERNAL_ROOT, MAIN_AGENT_ID)
    : path.resolve(WORKSPACE_ROOT, scope.projectId);

const getScopeAgentRuntimeDir = (scope: ChatScope): string =>
  scope.type === "main"
    ? path.join(INTERNAL_ROOT, MAIN_AGENT_ID)
    : path.join(INTERNAL_ROOT, "project-agents", scope.projectId);

const safeStringifyInput = (input: unknown): string => {
  if (input === undefined || input === null) return "";
  try {
    const json = JSON.stringify(input);
    if (!json || json === "{}" || json === "[]") return "";
    return json.length > 500 ? `${json.slice(0, 500)}...` : json;
  } catch {
    return "";
  }
};

const SESSION_CONTEXT_FILES = [
  {
    fileName: "SOUL.md",
    title: "Agent 行为准则（灵魂）",
  },
  {
    fileName: "USER.md",
    title: "用户画像",
  },
  {
    fileName: "IDENTITY.md",
    title: "Agent 身份定义",
  },
] as const;

const toAuthProviderKey = (provider: string): string =>
  provider === "openrouter" ? "openrouter" : provider;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractAuthorInfoFromString = (
  rawAuthor: string,
): DeveloperMetadata | null => {
  const trimmed = rawAuthor.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
  if (!match) {
    return { name: trimmed };
  }
  const name = match[1]?.trim();
  const email = match[2]?.trim();
  return {
    name: name || undefined,
    email: email || undefined,
  };
};

const loadAppDeveloperMetadata =
  async (): Promise<DeveloperMetadata | null> => {
    if (appDeveloperMetadataCache !== undefined) {
      return appDeveloperMetadataCache;
    }

    try {
      const packagePath = path.join(app.getAppPath(), "package.json");
      const raw = await readFile(packagePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      let authorInfo: DeveloperMetadata | null = null;
      if (typeof parsed.author === "string") {
        authorInfo = extractAuthorInfoFromString(parsed.author);
      } else if (isRecord(parsed.author)) {
        const name =
          typeof parsed.author.name === "string"
            ? parsed.author.name.trim()
            : undefined;
        const email =
          typeof parsed.author.email === "string"
            ? parsed.author.email.trim()
            : undefined;
        authorInfo = {
          name: name || undefined,
          email: email || undefined,
        };
      }

      const fallbackEmail =
        typeof parsed.email === "string" ? parsed.email.trim() : "";

      const next: DeveloperMetadata = {
        name: authorInfo?.name,
        email: authorInfo?.email || fallbackEmail || undefined,
      };

      appDeveloperMetadataCache = next.name || next.email ? next : null;
      return appDeveloperMetadataCache;
    } catch {
      appDeveloperMetadataCache = null;
      return null;
    }
  };

export const getPersistentSessionDir = (
  agentCwd: string,
  chatSessionId: string,
): string => path.resolve(agentCwd, ".pi", "sessions", chatSessionId);

const readOptionalUtf8File = async (
  filePath: string,
): Promise<string | null> => {
  try {
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const getContextDirectoryForScope = (
  scope: ChatScope,
  projectCwd: string,
): string => path.join(projectCwd, "docs");

const loadSessionContextFiles = async (
  contextDir: string,
  fallbackDir?: string,
): Promise<SessionContextFile[]> => {
  const sections: SessionContextFile[] = [];
  for (const item of SESSION_CONTEXT_FILES) {
    const targetPath = path.join(contextDir, item.fileName);
    const fallbackPath = fallbackDir
      ? path.join(fallbackDir, item.fileName)
      : undefined;
    const content =
      (await readOptionalUtf8File(targetPath)) ??
      (fallbackPath ? await readOptionalUtf8File(fallbackPath) : null);
    if (!content) continue;
    sections.push({
      fileName: item.fileName,
      title: item.title,
      content,
    });
  }
  return sections;
};

const buildSoftwareInfoSection = (input: {
  developerMetadata: DeveloperMetadata | null;
}): string => {
  return [
    `- 作者：${input.developerMetadata?.name ?? "未知"}`,
    `- 邮箱：${input.developerMetadata?.email ?? "未配置"}`,
  ].join("\n");
};

const buildRuntimeEnvironmentSection = (input: {
  workspaceRoot: string;
  agentWorkspaceRoot: string;
  globalConfigDir: string;
  currentBuildVersion: string;
}): string =>
  [
    `- 全局配置目录（<GlobalConfigDir>）：${input.globalConfigDir}`,
    `- 全局工作区根目录（<GlobalWorkspaceRoot>）：${input.workspaceRoot}`,
    `- 当前 Agent 工作区根目录（<AgentWorkspaceRoot>）：${input.agentWorkspaceRoot}`,
    `- 当前构建版本：${input.currentBuildVersion}`,
  ].join("\n");

const disposeSessionEntry = (storeKey: string): void => {
  const entry = agentSessionStore.get(storeKey);
  if (!entry) return;
  entry.unsubscribe();
  try {
    entry.session.dispose();
  } catch {
    // Ignore dispose error
  }
  void entry.disposeMcpRuntime().catch((error) => {
    logger.warn("Failed to dispose MCP runtime", {
      storeKey,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  agentSessionStore.delete(storeKey);
};

const clearSessionInternal = (
  scope: ChatScope,
  chatSessionId: string,
  options?: { startFreshOnNextPrompt?: boolean },
): void => {
  const storeKey = getSessionStoreKey(scope, chatSessionId);
  refreshSessionOnNextPrompt.delete(storeKey);
  if (options?.startFreshOnNextPrompt ?? true) {
    freshSessionOnNextPrompt.add(storeKey);
  }
  activeAgentRequestStore.delete(storeKey);
  disposeSessionEntry(storeKey);
  void repositoryService.setChatSessionSdkSessionId({
    scope,
    sessionId: chatSessionId,
    sdkSessionId: null,
  });
};

const buildNewSessionTool = (input: {
  scope: ChatScope;
  chatSessionId: string;
  description: string;
}): CustomToolDef => ({
  name: "NewSession",
  label: "NewSession",
  description: input.description,
  parameters: Type.Object({}),
  async handler() {
    try {
      const currentSession = await repositoryService.getChatSession(
        input.scope,
        input.chatSessionId,
      );
      const module =
        currentSession?.module ??
        (input.scope.type === "main" ? "main" : "docs");

      const isChannelSession =
        currentSession?.kind === "digital_avatar" &&
        currentSession.metadataJson;

      if (isChannelSession) {
        const { chatChannelService } = await import("./chatChannelService");
        const runtimeSessionIds =
          await chatChannelService.findChannelRuntimeSessionIds({
            scope: input.scope,
            digitalAvatarMetadataJson: currentSession.metadataJson!,
          });
        for (const runtimeSessionId of runtimeSessionIds) {
          clearSessionInternal(input.scope, runtimeSessionId, {
            startFreshOnNextPrompt: true,
          });
        }
        logger.info("NewSession tool: cleared channel runtime sessions", {
          chatSessionId: input.chatSessionId,
          clearedRuntimeSessionIds: runtimeSessionIds,
        });
        return {
          text: `已清空对话上下文（清理了 ${runtimeSessionIds.length} 个运行时会话）`,
        };
      }

      const created = await repositoryService.createChatSession({
        scope: input.scope,
        module,
        title: "",
      });

      logger.info("NewSession tool: created new session", {
        oldSessionId: input.chatSessionId,
        newSessionId: created.id,
        kind: created.kind,
      });

      appOperationEvents.emit({
        type: "open_chat_session",
        scope: input.scope,
        sessionId: created.id,
        module: created.module,
      });

      return {
        text: `已创建新会话并切换到该会话：${created.id}`,
      };
    } catch (error) {
      return {
        text: `NewSession failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isError: true,
      };
    }
  },
});

export const createSessionControlTools = (input: {
  scope: ChatScope;
  chatSessionId: string;
}): CustomToolDef[] => {
  return [
    buildNewSessionTool({
      scope: input.scope,
      chatSessionId: input.chatSessionId,
      description: `
        当用户明确要求开始一个新会话或新话题时调用此工具，例如“新会话”、“开个新会话”、“新话题”、“换个新话题”、“重新开始一个话题”。
        调用后会创建一个新的当前 Agent 会话，并立即切换到新会话输入框。旧会话会保留在对话列表中，不会自动归档或总结。
      `.trim(),
    }),
  ];
};

const describeProject = (projectId: string, projectName: string): string =>
  projectName === projectId ? projectId : `${projectName} (${projectId})`;

const buildChatMessageMetadataJson = (metadata: ChatMessageMetadata): string =>
  JSON.stringify(metadata);

const buildDelegationMessageContent = (input: {
  delegationId: string;
  module: ModuleType;
  task: string;
}): string =>
  [
    "来自主 Agent 的委派",
    `委派编号：${input.delegationId}`,
    `目标模块：${input.module}`,
    "",
    input.task.trim(),
  ].join("\n");

const normalizeProjectQuery = (value: string): string =>
  value.trim().toLowerCase();

const resolveDelegationTargetProject = async (
  rawProjectQuery: string,
): Promise<{ id: string; name: string }> => {
  const query = rawProjectQuery.trim();
  if (!query) {
    throw new Error("agent 不能为空");
  }

  const projects = await repositoryService.listProjects();
  if (projects.length === 0) {
    throw new Error("当前没有可用 Agent");
  }

  const keyword = normalizeProjectQuery(query);
  const exactMatches = projects.filter((project) => {
    const id = normalizeProjectQuery(project.id);
    const name = normalizeProjectQuery(project.name);
    return id === keyword || name === keyword;
  });
  if (exactMatches.length > 0) {
    return exactMatches.sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
  }

  const fuzzyMatches = projects.filter((project) => {
    const id = normalizeProjectQuery(project.id);
    const name = normalizeProjectQuery(project.name);
    return id.includes(keyword) || name.includes(keyword);
  });
  if (fuzzyMatches.length > 0) {
    return fuzzyMatches.sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
  }

  throw new Error(`未找到 Agent：${query}`);
};

const findReusableDelegatedSession = async (input: {
  mainSessionId: string;
  targetProjectId: string;
}): Promise<{ id: string } | null> => {
  const reusedSessionId = delegatedSessionStore.get(
    `${input.mainSessionId}:${input.targetProjectId}`,
  );
  if (!reusedSessionId) {
    return null;
  }

  const session = await repositoryService.getChatSession(
    { type: "project", projectId: input.targetProjectId },
    reusedSessionId,
  );
  if (!session) {
    delegatedSessionStore.delete(
      `${input.mainSessionId}:${input.targetProjectId}`,
    );
    return null;
  }

  return { id: session.id };
};

const appendSubAgentReport = async (input: {
  delegationContext: DelegationContext;
  sourceProjectId: string;
  sourceProjectName: string;
  status: "completed" | "failed";
  result: string;
  requestStartedAt?: string;
}): Promise<void> => {
  const content = [
    `来自 Agent ${describeProject(input.sourceProjectId, input.sourceProjectName)} 的回报`,
    `状态：${input.status === "completed" ? "已完成" : "失败"}`,
    "",
    input.result.trim() || "无结果正文",
  ].join("\n");
  await repositoryService.appendMessage({
    scope: { type: "main" },
    sessionId: input.delegationContext.mainSessionId,
    role: "system",
    content,
    metadataJson: JSON.stringify({
      kind: "sub_agent_report",
      delegationId: input.delegationContext.delegationId,
      sourceProjectId: input.sourceProjectId,
      sourceProjectName: input.sourceProjectName,
      status: input.status,
      requestStartedAt: input.requestStartedAt,
    }),
    createdAt: input.requestStartedAt,
  });
};

const triggerMainAgentReportProcessing = async (input: {
  delegationContext: DelegationContext;
  sourceProjectId: string;
  sourceProjectName: string;
  status: "completed" | "failed";
  result: string;
}): Promise<void> => {
  const mainScope: ChatScope = { type: "main" };
  const reportPrompt = [
    `子智能体 ${describeProject(input.sourceProjectId, input.sourceProjectName)} 收到任务回报。`,
    `委派编号：${input.delegationContext.delegationId}`,
    `状态：${input.status === "completed" ? "completed" : "failed"}`,
    "",
    "请基于这条回报继续处理当前用户任务，并在需要时决定是否继续委派或直接给出答复。",
    "不要逐字复述子智能体的完整回报，只需用一两句简短总结关键信息，或直接继续回应用户请求。",
    "",
    input.result.trim(),
  ].join("\n");

  const [{ chatService }, { chatChannelService }] = await Promise.all([
    import("./chatService"),
    import("./chatChannelService"),
  ]);
  const assistantMirrorStreamer =
    chatChannelService.createSessionAssistantReplyStreamer({
      scope: mainScope,
      projectId: MAIN_AGENT_ID,
      module: "main",
      sessionId: input.delegationContext.mainSessionId,
    }) ??
    chatChannelService.createAgentAssistantMirrorStreamer({
      projectId: MAIN_AGENT_ID,
      module: "main",
      sessionId: input.delegationContext.mainSessionId,
    });
  let reportPersisted = false;
  const result = await chatService.send(
    {
      scope: mainScope,
      module: "main",
      sessionId: input.delegationContext.mainSessionId,
      requestId: `main-report-${input.delegationContext.delegationId}`,
      message: reportPrompt,
      queuedSourceName: input.sourceProjectName,
      skipUserMessagePersistence: true,
    },
    (event) => {
      if (!reportPersisted && event.type === "request_started") {
        reportPersisted = true;
        void appendSubAgentReport({
          delegationContext: input.delegationContext,
          sourceProjectId: input.sourceProjectId,
          sourceProjectName: input.sourceProjectName,
          status: input.status,
          result: input.result,
          requestStartedAt: event.createdAt,
        }).catch((error) => {
          logger.warn("Persist sub-agent report failed", {
            delegationId: input.delegationContext.delegationId,
            sessionId: input.delegationContext.mainSessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      assistantMirrorStreamer.pushEvent(event);
    },
  );
  await assistantMirrorStreamer.finalize({
    fallbackAssistantMessage: result.assistantMessage,
    toolActions: result.toolActions,
  });
};

const hasMeaningfulDelegationText = (text: string): boolean => {
  const normalized = text.trim();
  return (
    normalized.length > 0 &&
    normalized !== EMPTY_AGENT_FINAL_MESSAGE &&
    normalized !== SUCCESS_WITHOUT_TEXT_FINAL_MESSAGE
  );
};

const formatDelegationToolOutputs = (toolOutputs: string[]): string =>
  toolOutputs
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");

export const buildAutomaticDelegationReport = (input: {
  reason: "completed" | "interrupted" | "error";
  finalMessage?: string;
  toolOutputs?: string[];
  errorMessage?: string;
}): {
  status: "completed" | "failed";
  result: string;
} => {
  const pushSection = (sections: string[], ...lines: string[]): void => {
    if (sections.length > 0) {
      sections.push("");
    }
    sections.push(...lines);
  };
  const finalMessage = input.finalMessage?.trim() ?? "";
  const toolOutputs = input.toolOutputs ?? [];
  const toolOutputSection = formatDelegationToolOutputs(toolOutputs);
  const hasFinalText = hasMeaningfulDelegationText(finalMessage);
  const hasToolOutputs = toolOutputSection.length > 0;

  if (input.reason === "error") {
    const sections = [`错误信息：${input.errorMessage?.trim() || "未知错误"}`];
    if (hasFinalText) {
      pushSection(sections, finalMessage);
    }
    return {
      status: "failed",
      result: sections.join("\n"),
    };
  }

  if (input.reason === "interrupted") {
    const sections: string[] = [];
    if (hasFinalText) {
      sections.push(finalMessage);
    } else if (hasToolOutputs) {
      sections.push("Agent 未输出最终文字说明。");
    }
    if (hasToolOutputs) {
      pushSection(sections, "工具执行摘要：", toolOutputSection);
    }
    if (!hasFinalText && !hasToolOutputs) {
      sections.push("Agent 在中断前没有产出可回报结果。");
    }
    return {
      status: "failed",
      result: sections.join("\n"),
    };
  }

  const status = hasFinalText || hasToolOutputs ? "completed" : "failed";
  const sections: string[] = [];
  if (hasFinalText) {
    sections.push(finalMessage);
  } else if (hasToolOutputs) {
    sections.push("Agent 未输出最终文字说明。");
  }
  if (hasToolOutputs) {
    pushSection(sections, "工具执行摘要：", toolOutputSection);
  }
  if (!hasFinalText && !hasToolOutputs) {
    sections.push(EMPTY_AGENT_FINAL_MESSAGE);
  }
  return {
    status,
    result: sections.join("\n"),
  };
};

export const deliverDelegationReportToMainAgent = async (input: {
  delegationContext: DelegationContext;
  sourceProjectId: string;
  sourceProjectName: string;
  status: "completed" | "failed";
  result: string;
  delegationReportState?: DelegationReportState;
}): Promise<void> => {
  if (input.delegationReportState?.reported) {
    return;
  }

  const existingReport = input.delegationReportState?.appendedReport;
  const effectiveReport = existingReport ?? {
    status: input.status,
    result: input.result,
  };

  if (!existingReport && input.delegationReportState) {
    input.delegationReportState.appendedReport = effectiveReport;
  }

  await triggerMainAgentReportProcessing({
    delegationContext: input.delegationContext,
    sourceProjectId: input.sourceProjectId,
    sourceProjectName: input.sourceProjectName,
    status: effectiveReport.status,
    result: effectiveReport.result,
  });

  if (input.delegationReportState) {
    input.delegationReportState.reported = true;
  }
};

export const createDelegationTools = (input: {
  scope: ChatScope;
  runtime: DelegationToolRuntime;
}): CustomToolDef[] => {
  const tools: CustomToolDef[] = [];

  if (input.scope.type === "main") {
    tools.push({
      name: "callSubAgent",
      label: "callSubAgent",
      description:
        "将具体任务异步委派给子智能体。涉及某个 Agent 工作区内的执行、创作、文档整理或应用开发时优先调用该工具；如果没有合适的 Agent，先使用 CreateAgent。",
      parameters: Type.Object({
        agent: Type.Optional(
          Type.String({ description: "目标 Agent 的 ID 或名称" }),
        ),
        project: Type.Optional(
          Type.String({ description: "兼容旧参数。目标 Agent 的 ID 或名称" }),
        ),
        task: Type.String({ description: "发给子智能体 的完整任务" }),
        module: Type.Optional(
          Type.Union([
            Type.Literal("docs"),
            Type.Literal("creation"),
            Type.Literal("assets"),
            Type.Literal("app"),
          ]),
        ),
      }),
      async handler(params) {
        const projectQuery =
          typeof params.agent === "string"
            ? params.agent.trim()
            : typeof params.project === "string"
              ? params.project.trim()
              : "";
        const task = typeof params.task === "string" ? params.task.trim() : "";
        const module =
          params.module === "creation" ||
          params.module === "assets" ||
          params.module === "app" ||
          params.module === "docs"
            ? (params.module as ModuleType)
            : "docs";
        if (!projectQuery) {
          return { text: "callSubAgent failed: agent 不能为空", isError: true };
        }
        if (!task) {
          return { text: "callSubAgent failed: task 不能为空", isError: true };
        }

        try {
          const project = await resolveDelegationTargetProject(projectQuery);
          const delegationId = randomUUID();
          const delegationMessage = buildDelegationMessageContent({
            delegationId,
            module,
            task,
          });
          const subScope: ChatScope = {
            type: "project",
            projectId: project.id,
          };
          const reusableSession = await findReusableDelegatedSession({
            mainSessionId: input.runtime.chatSessionId,
            targetProjectId: project.id,
          });
          const session =
            reusableSession ??
            (await repositoryService.createChatSession({
              scope: subScope,
              module,
              title: `${project.name} Agent 会话`,
            }));

          await repositoryService.appendMessage({
            scope: subScope,
            sessionId: session.id,
            role: "system",
            content: delegationMessage,
            metadataJson: buildChatMessageMetadataJson({
              kind: "delegation",
              delegationId,
              sourceProjectId: MAIN_AGENT_ID,
              sourceProjectName: MAIN_AGENT_NAME,
              targetProjectId: project.id,
              targetProjectName: project.name,
              targetSessionId: session.id,
            }),
          });
          delegatedSessionStore.set(
            `${input.runtime.chatSessionId}:${project.id}`,
            session.id,
          );

          void (async () => {
            try {
              const { chatService } = await import("./chatService");
              await chatService.send({
                scope: subScope,
                module,
                sessionId: session.id,
                requestId: `delegation-${delegationId}`,
                message: task,
                skipUserMessagePersistence: true,
                delegationContext: {
                  delegationId,
                  mainSessionId: input.runtime.chatSessionId,
                  source: "main",
                  projectId: project.id,
                  projectName: project.name,
                },
              });
            } catch (error) {
              const delegationContext: DelegationContext = {
                delegationId,
                mainSessionId: input.runtime.chatSessionId,
                source: "main",
                projectId: project.id,
                projectName: project.name,
              };
              const resultText =
                error instanceof Error ? error.message : String(error);
              await deliverDelegationReportToMainAgent({
                delegationContext,
                sourceProjectId: project.id,
                sourceProjectName: project.name,
                status: "failed",
                result: resultText,
                delegationReportState: { reported: false },
              });
            }
          })();

          return {
            text: [
              `已异步委派任务到 Agent ${describeProject(project.id, project.name)}。`,
              `delegationId: ${delegationId}`,
              `sessionId: ${session.id}`,
            ].join("\n"),
          };
        } catch (error) {
          return {
            text: `callSubAgent failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            isError: true,
          };
        }
      },
    });
  }

  return tools;
};

const buildRoleInstructionSection = (input: {
  scope: ChatScope;
  delegationContext?: DelegationContext;
}): string => {
  if (input.delegationContext) {
    return [
      "## 委派任务说明",
      "本轮任务来自主 Agent 委派。你是子智能体，只负责当前 Agent 工作区内执行。",
      `当前委派编号：${input.delegationContext.delegationId}`,
      "任务结束后，系统会自动把你的最终输出和关键工具执行结果回报给主 Agent。",
      "请专注执行并给出清晰的最终结论；如果失败或受阻，直接说明原因。",
    ].join("\n");
  }
  return "";
};

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

const createOrResumeSession = async (
  scope: ChatScope,
  projectCwd: string,
  chatSessionId: string,
  modelOverride?: string,
  thinkingLevel?: ChatThinkingLevel,
  capabilityMode: "full" | "chat_only" = "full",
  moduleName?: ChatModuleType,
  contextSnapshot?: unknown,
  delegationContext?: DelegationContext,
  delegationReportState?: DelegationReportState,
): Promise<{
  session: AgentSession;
  unsubscribe: () => void;
  modelId: string;
  provider: string;
  api: string;
  modelSource:
    | "payload.model"
    | "settings.lastSelectedModel"
    | "settings.firstEnabledModel";
  thinkingLevel: ChatThinkingLevel;
}> => {
  const storeKey = getSessionStoreKey(scope, chatSessionId);
  const scopeKey = getScopeKey(scope);
  const agentRuntimeDir = getScopeAgentRuntimeDir(scope);
  const currentChatSession = await repositoryService.getChatSession(
    scope,
    chatSessionId,
  );
  const sessionKind: ChatSessionKind = currentChatSession?.kind ?? "normal";
  const effectiveCapabilityMode: ChatCapabilityMode = capabilityMode;
  const status = await settingsService.getClaudeStatus(scope);
  const effectiveThinkingLevel = thinkingLevel ?? DEFAULT_CHAT_THINKING_LEVEL;

  // Resolve provider and model from override, saved scope state, or first enabled model.
  const {
    provider: effectiveProvider,
    modelId: effectiveModelId,
    modelSource,
  } = resolveEffectiveAgentModelSelection(status, modelOverride);

  const compositeModelKey = `${effectiveProvider}:${effectiveModelId}`;
  const providerApiKey =
    status.providers[effectiveProvider]?.apiKey ||
    (await settingsService.getClaudeSecret(effectiveProvider)) ||
    undefined;
  const model = await settingsService.resolveAgentModel(
    effectiveProvider,
    effectiveModelId,
  );
  if (!model) {
    throw new Error(
      `Model not found: ${effectiveProvider}:${effectiveModelId}`,
    );
  }
  const currentModelConfigSignature = buildAgentModelConfigSignature({
    provider: effectiveProvider,
    apiKey: providerApiKey,
    model,
  });
  const sessionDir = getPersistentSessionDir(projectCwd, chatSessionId);
  const startFreshRequested = freshSessionOnNextPrompt.has(storeKey);
  const refreshRequested = refreshSessionOnNextPrompt.has(storeKey);
  const mcpServers = await settingsService.getMcpServers();
  const mcpSignature = buildMcpServerSignature(mcpServers);
  const promptSessionKind: ChatSessionKind =
    effectiveCapabilityMode === "chat_only" ? sessionKind : "normal";
  const fallbackSystemPrompt = await settingsService.getAgentSystemPrompt(
    scope.type,
    promptSessionKind,
  );
  const systemPromptSignature = buildTextSignature(fallbackSystemPrompt);

  if (startFreshRequested || refreshRequested) {
    disposeSessionEntry(storeKey);
  }

  const delegationToolRuntime: DelegationToolRuntime = {
    chatSessionId,
    delegationContext,
    delegationReportState,
  };

  const existing = agentSessionStore.get(storeKey);
  logger.info("createOrResumeSession: store lookup", {
    storeKey,
    chatSessionId,
    sessionKind,
    hasExisting: Boolean(existing),
    allStoreKeys: [...agentSessionStore.keys()],
  });
  if (existing) {
    if (
      existing.modelId !== compositeModelKey ||
      existing.modelConfigSignature !== currentModelConfigSignature ||
      existing.mcpSignature !== mcpSignature ||
      existing.sessionKind !== sessionKind ||
      existing.capabilityMode !== effectiveCapabilityMode ||
      existing.systemPromptSignature !== systemPromptSignature
    ) {
      logger.info(
        "Rebuilding agent session due to runtime configuration change",
        {
          scope: scopeKey,
          chatSessionId,
          previousModelId: existing.modelId,
          nextModelId: compositeModelKey,
          modelChanged: existing.modelId !== compositeModelKey,
          modelRuntimeChanged:
            existing.modelConfigSignature !== currentModelConfigSignature,
          mcpChanged: existing.mcpSignature !== mcpSignature,
          sessionKindChanged: existing.sessionKind !== sessionKind,
          capabilityModeChanged:
            existing.capabilityMode !== effectiveCapabilityMode,
          systemPromptChanged:
            existing.systemPromptSignature !== systemPromptSignature,
          enabledMcpServerCount: mcpServers.filter((server) => server.enabled)
            .length,
        },
      );
      disposeSessionEntry(storeKey);
    } else {
      existing.delegationToolRuntime.chatSessionId = chatSessionId;
      existing.delegationToolRuntime.delegationContext = delegationContext;
      existing.delegationToolRuntime.delegationReportState =
        delegationReportState;
      if (existing.thinkingLevel !== effectiveThinkingLevel) {
        existing.session.setThinkingLevel(effectiveThinkingLevel);
        existing.thinkingLevel = effectiveThinkingLevel;
      }
      logger.info("Agent active skills", {
        scope: scopeKey,
        chatSessionId,
        agent: getAgentLogLabel(scope),
        activeSkillCount: existing.activeSkillNames.length,
        activeSkillNames: existing.activeSkillNames,
        reusedSession: true,
      });
      logger.info("Agent enabled tools", {
        scope: scopeKey,
        chatSessionId,
        agent: getAgentLogLabel(scope),
        toolCount: existing.toolNames.length,
        toolNames: existing.toolNames,
        activeSkillCount: existing.activeSkillNames.length,
        activeSkillNames: existing.activeSkillNames,
        reusedSession: true,
      });
      return {
        ...existing,
        provider: effectiveProvider,
        api: model.api,
        modelSource,
      };
    }
  }

  // Configure auth storage with the user's API key
  const authStorage = AuthStorage.inMemory();
  for (const [provider, providerState] of Object.entries(status.providers)) {
    if (!providerState.apiKey) continue;
    authStorage.setRuntimeApiKey(
      toAuthProviderKey(provider),
      providerState.apiKey,
    );
  }
  if (!status.providers[effectiveProvider]?.apiKey) {
    if (providerApiKey) {
      authStorage.setRuntimeApiKey(
        toAuthProviderKey(effectiveProvider),
        providerApiKey,
      );
    }
  }

  const toolAccessEnabled = effectiveCapabilityMode !== "chat_only";
  const tools = toolAccessEnabled ? createCodingTools(projectCwd) : [];
  const mcpRuntime = await createMcpRuntime(mcpServers);
  logger.info("MCP runtime prepared for agent session", {
    scope: scopeKey,
    chatSessionId,
    totalMcpServerCount: mcpServers.length,
    enabledMcpServerCount: mcpServers.filter((server) => server.enabled).length,
    runtimeToolCount: mcpRuntime.tools.length,
    warningCount: mcpRuntime.warnings.length,
  });
  if (mcpRuntime.warnings.length > 0) {
    logger.warn("MCP runtime loaded with warnings", {
      scope: scopeKey,
      chatSessionId,
      warnings: mcpRuntime.warnings,
    });
  }

  // Create custom tools from our business logic
  const builtinTools = toolAccessEnabled
    ? createBuiltinTools(projectCwd, scope.type).map(toToolDefinition)
    : [];
  const appOperationTools = toolAccessEnabled
    ? createAppOperationTools(
        scope.type === "project" ? scope.projectId : MAIN_AGENT_ID,
        scope.type,
      ).map(toToolDefinition)
    : [];
  const sessionControlTools = toolAccessEnabled
    ? createSessionControlTools({
        scope,
        chatSessionId,
      }).map(toToolDefinition)
    : [];
  const delegationTools = toolAccessEnabled
    ? createDelegationTools({
        scope,
        runtime: delegationToolRuntime,
      }).map(toToolDefinition)
    : [];
  const customTools = [
    ...builtinTools,
    ...appOperationTools,
    ...sessionControlTools,
    ...delegationTools,
    ...(toolAccessEnabled ? mcpRuntime.tools : []),
  ];
  const toolNames = [
    ...tools.map((tool) => tool.name),
    ...customTools.map((tool) => tool.name),
  ];
  logger.info("Agent enabled tools", {
    scope: scopeKey,
    chatSessionId,
    agent: getAgentLogLabel(scope),
    codingToolNames: tools.map((tool) => tool.name),
    builtinToolNames: builtinTools.map((tool) => tool.name),
    appOperationToolNames: appOperationTools.map((tool) => tool.name),
    sessionControlToolNames: sessionControlTools.map((tool) => tool.name),
    delegationToolNames: delegationTools.map((tool) => tool.name),
    mcpToolNames: mcpRuntime.tools.map((tool) => tool.name),
    capabilityMode: effectiveCapabilityMode,
    sessionKind,
    toolCount: toolNames.length,
    toolNames,
    reusedSession: false,
  });

  const resumedSessionManager = startFreshRequested
    ? undefined
    : SessionManager.continueRecent(projectCwd, sessionDir);
  const resumedContext = resumedSessionManager?.buildSessionContext();
  logger.info("createOrResumeSession: SessionManager state", {
    storeKey,
    chatSessionId,
    sessionDir,
    startFreshRequested,
    hasResumedSessionManager: Boolean(resumedSessionManager),
    resumedMessageCount: resumedContext?.messages?.length ?? 0,
  });
  const previousContextModel = resumedContext?.model;
  const modelChangedFromPersistedContext = Boolean(
    previousContextModel &&
    (previousContextModel.provider !== effectiveProvider ||
      previousContextModel.modelId !== effectiveModelId),
  );
  const sessionManager =
    resumedSessionManager ?? SessionManager.create(projectCwd, sessionDir);
  if (modelChangedFromPersistedContext) {
    logger.info("Restoring persisted session context with a different model", {
      scope: scopeKey,
      chatSessionId,
      previousModelId: `${previousContextModel?.provider}:${previousContextModel?.modelId}`,
      nextModelId: compositeModelKey,
    });
  }

  const contextDir = getContextDirectoryForScope(scope, projectCwd);
  const [project, contextFiles, developerMetadata, activeSkills] =
    await Promise.all([
      scope.type === "project"
        ? repositoryService.getProjectById(scope.projectId)
        : Promise.resolve(null),
      loadSessionContextFiles(
        contextDir,
        scope.type === "main" ? WORKSPACE_ROOT : undefined,
      ),
      loadAppDeveloperMetadata(),
      effectiveCapabilityMode === "chat_only"
        ? Promise.resolve([])
        : skillService.listActiveSkillsForScope({
            scope: scope.type,
            projectId: scope.type === "project" ? scope.projectId : undefined,
          }),
    ]);
  const contextSnapshotSection = buildContextSnapshotSection({
    projectId: scope.type === "project" ? scope.projectId : MAIN_AGENT_ID,
    projectName:
      project?.name ??
      (scope.type === "main" ? MAIN_AGENT_NAME : "未命名 Agent"),
    module: moduleName ?? "unknown",
    projectCwd,
    contextSnapshot,
    moduleKeys: scope.type === "main" ? ["docs"] : undefined,
    includeAgentSummary: scope.type !== "main",
    includeSummaryHeading: scope.type !== "main",
  });
  const softwareInfoSection = buildSoftwareInfoSection({
    developerMetadata,
  });
  const runtimeEnvironmentSection = buildRuntimeEnvironmentSection({
    globalConfigDir: GLOBAL_CONFIG_DIR,
    workspaceRoot: WORKSPACE_ROOT,
    agentWorkspaceRoot: projectCwd,
    currentBuildVersion: isDevelopmentMode ? "dev build" : "prod build",
  });
  const roleInstructionSection = buildRoleInstructionSection({
    scope,
    delegationContext,
  });
  const explicitSkillPaths = collectExplicitSkillPaths(activeSkills);
  let hasLoggedFinalSystemPrompt = false;
  const resourceLoader = new DefaultResourceLoader({
    cwd: projectCwd,
    agentDir: agentRuntimeDir,
    noSkills: true,
    additionalSkillPaths: explicitSkillPaths,
    systemPrompt: fallbackSystemPrompt,
    appendSystemPrompt: "",
    systemPromptOverride: () => {
      const basePrompt = buildSessionSystemPrompt(fallbackSystemPrompt, {
        contextFiles,
        runtimeEnvironmentSection,
        contextSnapshotSection,
        softwareInfoSection,
      });
      const finalSystemPrompt = roleInstructionSection
        ? `${basePrompt}\n\n${roleInstructionSection}`
        : basePrompt;
      if (isDevelopmentMode && !hasLoggedFinalSystemPrompt) {
        hasLoggedFinalSystemPrompt = true;
        logger.info("Final system prompt metadata (development)", {
          scope: scopeKey,
          chatSessionId,
          sessionKind,
        });
        logger.info(
          `Selected system prompt template Markdown (development)\n\n${fallbackSystemPrompt}`,
        );
        logger.info(
          `Final system prompt Markdown (development)\n\n${finalSystemPrompt}`,
        );
      }
      return finalSystemPrompt;
    },
  });
  await resourceLoader.reload();
  const loadedSkills = resourceLoader.getSkills();
  const activeSkillNames = activeSkills.map((skill) => skill.title);
  logger.info("Agent active skills", {
    scope: scopeKey,
    chatSessionId,
    agent: getAgentLogLabel(scope),
    agentRuntimeDir,
    activeSkillCount: activeSkills.length,
    activeSkillNames,
    explicitSkillPaths,
    loadedSkillCount: loadedSkills.skills.length,
    loadedSkillNames: loadedSkills.skills.map((skill) => skill.name),
    activeSkills: activeSkills.map((skill) => ({
      dirName: skill.dirName,
      title: skill.title,
      skillFilePath: skill.skillFilePath,
    })),
    reusedSession: false,
  });

  let session!: AgentSession;
  try {
    const result = await createAgentSession({
      cwd: projectCwd,
      agentDir: agentRuntimeDir,
      model,
      authStorage,
      tools,
      customTools,
      thinkingLevel: effectiveThinkingLevel,
      sessionManager,
      resourceLoader,
    });
    session = result.session;
  } catch (error) {
    await mcpRuntime.dispose();
    throw error;
  }

  // Placeholder for unsubscribe — will be set after first prompt
  const entry: AgentSessionEntry = {
    session,
    unsubscribe: () => {},
    modelId: compositeModelKey,
    modelConfigSignature: currentModelConfigSignature,
    thinkingLevel: effectiveThinkingLevel,
    mcpSignature,
    sessionKind,
    capabilityMode: effectiveCapabilityMode,
    systemPromptSignature,
    disposeMcpRuntime: mcpRuntime.dispose,
    toolNames,
    activeSkillNames,
    delegationToolRuntime,
  };
  agentSessionStore.set(storeKey, entry);
  freshSessionOnNextPrompt.delete(storeKey);
  refreshSessionOnNextPrompt.delete(storeKey);

  return {
    ...entry,
    provider: effectiveProvider,
    api: model.api,
    modelSource,
  };
};

// ---------------------------------------------------------------------------
// Public Service
// ---------------------------------------------------------------------------

export const agentService = {
  async send(
    payload: ChatSendPayload,
    onStream?: (event: ChatStreamEvent) => void,
  ): Promise<ChatSendResponse> {
    const status = await settingsService.getClaudeStatus(payload.scope);

    if (status.allEnabledModels.length === 0) {
      return {
        assistantMessage: "模型尚未配置。请先在设置中录入凭证并启用模型。",
        toolActions: [],
      };
    }

    console.log(
      `[kian-agent] send() called: module=${payload.module} sessionId=${payload.sessionId} message="${payload.message.slice(0, 50)}"`,
    );

    const requestId = payload.requestId ?? `req_${Date.now()}`;
    const projectCwd = getScopeCwd(payload.scope);
    const { provider: effectiveProvider, modelId: effectiveModelId } =
      resolveEffectiveAgentModelSelection(status, payload.model);
    const resolvedModel = await settingsService.resolveAgentModel(
      effectiveProvider,
      effectiveModelId,
    );
    if (!resolvedModel) {
      throw new Error(
        `Model not found: ${effectiveProvider}:${effectiveModelId}`,
      );
    }

    logger.info("Context snapshot", {
      contextSnapshot: payload.contextSnapshot,
      payload,
    });

    const attachmentContent = await buildAttachmentContent(
      payload.scope,
      payload.attachments,
    );

    const emit = (event: ChatStreamEvent): void => onStream?.(event);
    const storeKey = getSessionStoreKey(payload.scope, payload.sessionId);
    activeAgentRequestStore.set(storeKey, {
      requestId,
      interrupted: false,
      pendingTurnCount: 0,
      observedTurnLifecycle: false,
      agentEnded: false,
      queuedRequests: [],
    });
    const delegationReportState: DelegationReportState = { reported: false };

    let assistantText = "";
    let assistantErrorMessage = "";
    let toolErrorMessage = "";
    const toolActionsFromAgent = new Set<string>();
    const isRequestInterrupted = (): boolean => {
      const state = activeAgentRequestStore.get(storeKey);
      return Boolean(
        state && state.requestId === requestId && state.interrupted,
      );
    };
    const buildInterruptedMessage = (): string =>
      normalizeMediaMarkdownInText(assistantText.trim() || "已停止当前回答。");
    const finalizeQueuedRequestTurn = (
      queuedTurn: ActiveQueuedRequestTurnState | undefined,
      options?: {
        interrupted?: boolean;
        errorMessage?: string;
      },
    ): void => {
      if (!queuedTurn) return;
      const finalMessage = buildFinalAssistantMessage({
        assistantText: queuedTurn.assistantText,
        assistantErrorMessage:
          queuedTurn.assistantErrorMessage || options?.errorMessage || "",
        toolErrorMessage: queuedTurn.toolErrorMessage,
        interrupted: options?.interrupted ?? isRequestInterrupted(),
        toolOutputCount: queuedTurn.toolOutputCount,
        toolActionsCount: queuedTurn.toolActions.size,
      });
      emit({
        requestId: queuedTurn.requestId,
        sessionId: payload.sessionId,
        scope: payload.scope,
        module: payload.module,
        createdAt: nowISO(),
        type: "assistant_done",
        fullText: finalMessage,
      });
      void persistChatTurnTimeline({
        scope: payload.scope,
        sessionId: payload.sessionId,
        timeline: queuedTurn.timelineState.timeline,
        fallbackAssistantMessage: finalMessage,
        requestStartedAt:
          queuedTurn.timelineState.timeline[0]?.createdAt ?? nowISO(),
      }).catch((error) => {
        logger.warn("Persist queued chat turn failed", {
          requestId: queuedTurn.requestId,
          scope: getScopeKey(payload.scope),
          chatSessionId: payload.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    try {
      const {
        session,
        modelId,
        provider,
        api,
        modelSource,
        thinkingLevel: resolvedThinkingLevel,
      } = await createOrResumeSession(
        payload.scope,
        projectCwd,
        payload.sessionId,
        payload.model,
        payload.thinkingLevel,
        payload.capabilityMode ?? "full",
        payload.module,
        payload.contextSnapshot,
        payload.delegationContext,
        delegationReportState,
      );

      logger.info("Agent turn resolved runtime", {
        requestId,
        scope: getScopeKey(payload.scope),
        agent: getAgentLogLabel(payload.scope),
        chatSessionId: payload.sessionId,
        module: payload.module,
        modelId,
        modelSource,
        thinkingLevel: resolvedThinkingLevel,
      });

      if (isRequestInterrupted()) {
        const finalMessage = buildInterruptedMessage();
        emit({
          requestId,
          sessionId: payload.sessionId,
          scope: payload.scope,
          module: payload.module,
          createdAt: nowISO(),
          type: "assistant_done",
          fullText: finalMessage,
        });
        return {
          assistantMessage: finalMessage,
          toolActions: [...toolActionsFromAgent],
        };
      }

      let streamedLength = 0;
      let streamedThinkingLength = 0;
      const toolStartTimes = new Map<string, number>();
      let toolProgressCount = 0;
      let toolOutputCount = 0;
      let resolvePromptDone: (() => void) | undefined;
      const promptDonePromise = new Promise<void>((resolve) => {
        resolvePromptDone = resolve;
      });
      const activeState = activeAgentRequestStore.get(storeKey);
      if (activeState?.requestId === requestId) {
        activeState.resolvePromptDone = resolvePromptDone;
      }

      const emitRequestEvent = (
        targetRequestId: string,
        event: Omit<
          ChatStreamEvent,
          "requestId" | "sessionId" | "scope" | "module"
        >,
        options?: { applyToTimeline?: boolean },
      ): void => {
        const nextEvent: ChatStreamEvent = {
          requestId: targetRequestId,
          sessionId: payload.sessionId,
          scope: payload.scope,
          module: payload.module,
          ...event,
        };
        emit(nextEvent);
        if (!options?.applyToTimeline) {
          return;
        }
        const queuedTurn =
          activeAgentRequestStore.get(storeKey)?.activeQueuedRequest;
        if (!queuedTurn || queuedTurn.requestId !== targetRequestId) {
          return;
        }
        applyChatStreamEventToTimeline(queuedTurn.timelineState, nextEvent);
      };

      // Unsubscribe previous listener so stale subscriptions from earlier
      // send() calls don't fire duplicate events (e.g. tool messages sent
      // twice to Discord when the same session is reused).
      {
        const prevEntry = agentSessionStore.get(storeKey);
        if (prevEntry) {
          try {
            prevEntry.unsubscribe();
          } catch {
            /* ignore */
          }
        }
      }

      // Subscribe to agent events
      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        if (event.type === "message_start" && event.message.role === "user") {
          const state = activeAgentRequestStore.get(storeKey);
          const messageText = getUserMessageText(event.message);
          const queuedIndex =
            state?.queuedRequests.findIndex(
              (item) => item.matchText === messageText,
            ) ?? -1;
          if (queuedIndex >= 0 && state) {
            const [queuedRequest] = state.queuedRequests.splice(queuedIndex, 1);
            const previousQueuedTurn = state.activeQueuedRequest;
            const requestStartedAt = nowISO();
            state.activeQueuedRequest = {
              requestId: queuedRequest.requestId,
              timelineState: createChatTurnTimelineState(),
              assistantText: "",
              toolActions: new Set<string>(),
              toolOutputCount: 0,
              assistantErrorMessage: "",
              toolErrorMessage: "",
            };
            finalizeQueuedRequestTurn(previousQueuedTurn);
            emitRequestEvent(
              queuedRequest.requestId,
              {
                createdAt: requestStartedAt,
                type: "request_started",
              },
              { applyToTimeline: false },
            );
            void persistUserMessage({
              scope: payload.scope,
              sessionId: payload.sessionId,
              message: queuedRequest.message,
              attachments: queuedRequest.attachments,
              requestId: queuedRequest.requestId,
              createdAt: requestStartedAt,
              requestStartedAt,
            }).catch((error) => {
              logger.warn("Persist queued user message failed", {
                requestId: queuedRequest.requestId,
                scope: getScopeKey(payload.scope),
                chatSessionId: payload.sessionId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
          return;
        }

        // --- message_update: streaming text and tool call starts ---
        if (event.type === "message_update") {
          const llmEvent: AssistantMessageEvent = event.assistantMessageEvent;
          const queuedTurn =
            activeAgentRequestStore.get(storeKey)?.activeQueuedRequest;
          const targetRequestId = queuedTurn?.requestId ?? requestId;

          if (llmEvent.type === "text_delta") {
            if (queuedTurn) {
              queuedTurn.assistantText += llmEvent.delta;
            } else {
              assistantText += llmEvent.delta;
              streamedLength += llmEvent.delta.length;
            }
            emitRequestEvent(
              targetRequestId,
              {
                createdAt: nowISO(),
                type: "assistant_delta",
                delta: llmEvent.delta,
              },
              { applyToTimeline: Boolean(queuedTurn) },
            );
            return;
          }

          if (llmEvent.type === "thinking_start") {
            emitRequestEvent(
              targetRequestId,
              {
                createdAt: nowISO(),
                type: "thinking_start",
              },
              { applyToTimeline: false },
            );
            return;
          }

          if (llmEvent.type === "thinking_delta") {
            if (!queuedTurn) {
              streamedThinkingLength += llmEvent.delta.length;
            }
            emitRequestEvent(
              targetRequestId,
              {
                createdAt: nowISO(),
                type: "thinking_delta",
                delta: llmEvent.delta,
              },
              { applyToTimeline: Boolean(queuedTurn) },
            );
            return;
          }

          if (llmEvent.type === "thinking_end") {
            const thinkingContent = llmEvent.content?.trim() ?? "";
            if (thinkingContent && !queuedTurn) {
              streamedThinkingLength = Math.max(
                streamedThinkingLength,
                thinkingContent.length,
              );
            }
            emitRequestEvent(
              targetRequestId,
              {
                createdAt: nowISO(),
                type: "thinking_end",
                thinking: thinkingContent || undefined,
              },
              { applyToTimeline: Boolean(queuedTurn) },
            );
            return;
          }

          if (llmEvent.type === "toolcall_end") {
            const toolCall = llmEvent.toolCall;
            emitRequestEvent(
              targetRequestId,
              {
                createdAt: nowISO(),
                type: "tool_start",
                toolUseId: toolCall.id,
                toolName: toolCall.name,
                toolInput: safeStringifyInput(toolCall.arguments),
              },
              { applyToTimeline: Boolean(queuedTurn) },
            );
            toolStartTimes.set(toolCall.id, Date.now());
            return;
          }

          return;
        }

        // --- tool_execution_start ---
        if (event.type === "tool_execution_start") {
          const queuedTurn =
            activeAgentRequestStore.get(storeKey)?.activeQueuedRequest;
          const targetRequestId = queuedTurn?.requestId ?? requestId;
          if (!queuedTurn) {
            toolProgressCount += 1;
          }
          if (!toolStartTimes.has(event.toolCallId)) {
            // Tool was not announced via toolcall_end, emit tool_start now
            emitRequestEvent(
              targetRequestId,
              {
                createdAt: nowISO(),
                type: "tool_start",
                toolUseId: event.toolCallId,
                toolName: event.toolName,
                toolInput: safeStringifyInput(event.args),
              },
              { applyToTimeline: Boolean(queuedTurn) },
            );
            toolStartTimes.set(event.toolCallId, Date.now());
          }
          return;
        }

        // --- tool_execution_update ---
        if (event.type === "tool_execution_update") {
          const queuedTurn =
            activeAgentRequestStore.get(storeKey)?.activeQueuedRequest;
          const targetRequestId = queuedTurn?.requestId ?? requestId;
          const startTime = toolStartTimes.get(event.toolCallId) ?? Date.now();
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          emitRequestEvent(
            targetRequestId,
            {
              createdAt: nowISO(),
              type: "tool_progress",
              toolUseId: event.toolCallId,
              toolName: event.toolName,
              elapsedSeconds,
            },
            { applyToTimeline: Boolean(queuedTurn) },
          );
          return;
        }

        // --- tool_execution_end ---
        if (event.type === "tool_execution_end") {
          const queuedTurn =
            activeAgentRequestStore.get(storeKey)?.activeQueuedRequest;
          const targetRequestId = queuedTurn?.requestId ?? requestId;
          if (queuedTurn) {
            queuedTurn.toolOutputCount += 1;
          } else {
            toolOutputCount += 1;
          }
          const result = event.result;
          let outputText = "";
          if (
            result &&
            typeof result === "object" &&
            Array.isArray(result.content)
          ) {
            outputText = result.content
              .map((c: { type?: string; text?: string }) =>
                c?.type === "text" ? (c.text ?? "") : "",
              )
              .join("\n")
              .trim();
          }
          if (event.isError) {
            if (queuedTurn) {
              queuedTurn.toolErrorMessage =
                outputText || `工具执行失败：${event.toolName}`;
            } else {
              toolErrorMessage =
                outputText || `工具执行失败：${event.toolName}`;
            }
          }
          if (outputText) {
            const targetToolActions =
              queuedTurn?.toolActions ?? toolActionsFromAgent;
            targetToolActions.add(
              outputText.length > 200
                ? `${outputText.slice(0, 200)}...`
                : outputText,
            );
          }
          emitRequestEvent(
            targetRequestId,
            {
              createdAt: nowISO(),
              type: "tool_output",
              toolUseId: event.toolCallId,
              toolName: event.toolName,
              output: outputText || undefined,
            },
            { applyToTimeline: Boolean(queuedTurn) },
          );
          return;
        }

        if (event.type === "turn_start") {
          registerActiveRequestTurnStarted(storeKey, requestId);
          return;
        }

        if (event.type === "turn_end") {
          markActiveRequestTurnCompleted(storeKey, requestId);
          return;
        }

        // --- message_end: capture final text ---
        if (event.type === "message_end") {
          const msg = event.message;
          if (msg.role === "assistant" && Array.isArray(msg.content)) {
            const queuedTurn =
              activeAgentRequestStore.get(storeKey)?.activeQueuedRequest;
            const targetRequestId = queuedTurn?.requestId ?? requestId;
            const fullThinking = msg.content
              .map((c: { type?: string; thinking?: string }) =>
                c?.type === "thinking" ? (c.thinking ?? "") : "",
              )
              .join("")
              .trim();
            if (fullThinking) {
              if (queuedTurn || fullThinking.length > streamedThinkingLength) {
                emitRequestEvent(
                  targetRequestId,
                  {
                    createdAt: nowISO(),
                    type: "thinking_end",
                    thinking: fullThinking,
                  },
                  { applyToTimeline: Boolean(queuedTurn) },
                );
              }
              if (!queuedTurn) {
                streamedThinkingLength = fullThinking.length;
              }
            }
            const fullText = msg.content
              .map((c: { type?: string; text?: string }) =>
                c?.type === "text" ? (c.text ?? "") : "",
              )
              .join("")
              .trim();
            const streamedTextLength = queuedTurn
              ? queuedTurn.assistantText.length
              : streamedLength;
            if (fullText && fullText.length > streamedTextLength) {
              const remaining = fullText.slice(streamedTextLength);
              if (remaining) {
                emitRequestEvent(
                  targetRequestId,
                  {
                    createdAt: nowISO(),
                    type: "assistant_delta",
                    delta: remaining,
                  },
                  { applyToTimeline: Boolean(queuedTurn) },
                );
              }
              if (queuedTurn) {
                queuedTurn.assistantText = fullText;
              } else {
                assistantText = fullText;
                streamedLength = fullText.length;
              }
            }
            if (
              !(queuedTurn ? queuedTurn.assistantText : assistantText).trim() &&
              typeof msg.errorMessage === "string" &&
              msg.errorMessage.trim()
            ) {
              if (queuedTurn) {
                queuedTurn.assistantErrorMessage = msg.errorMessage.trim();
              } else {
                assistantErrorMessage = msg.errorMessage.trim();
              }
            }
          }
          return;
        }

        // --- agent_end: final event ---
        if (event.type === "agent_end") {
          const state = activeAgentRequestStore.get(storeKey);
          if (state?.activeQueuedRequest) {
            const activeQueuedRequest = state.activeQueuedRequest;
            state.activeQueuedRequest = undefined;
            finalizeQueuedRequestTurn(activeQueuedRequest);
          }
          if (!markActiveRequestAgentEnded(storeKey, requestId)) {
            resolvePromptDone?.();
          }
          return;
        }
      });

      // Update the stored unsubscribe function
      const entry = agentSessionStore.get(storeKey);
      if (entry) {
        entry.unsubscribe = unsubscribe;
      }

      const { fullPromptText, promptContent } = buildPromptContent({
        message: payload.message,
        messageSourceInfo: payload.messageSourceInfo,
        attachmentContent,
      });

      // Send the prompt
      logger.info("Agent prompt starting", {
        requestId,
        scope: getScopeKey(payload.scope),
        agent: getAgentLogLabel(payload.scope),
        chatSessionId: payload.sessionId,
        module: payload.module,
        modelId,
        modelSource,
        thinkingLevel: resolvedThinkingLevel,
        hasImages: attachmentContent.images.length > 0,
        hasDelegationContext: Boolean(payload.delegationContext),
      });

      attachAgentLlmRequestDebug(session.agent, () => ({
        kind: "agent",
        requestId,
        scope: getScopeKey(payload.scope),
        chatSessionId: payload.sessionId,
        module: payload.module,
        provider,
        modelId,
        modelSource,
        api,
        cwd: projectCwd,
      }));

      if (payload.delegationContext) {
        const delegationText = buildDelegationMessageContent({
          delegationId: payload.delegationContext.delegationId,
          module: payload.module === "main" ? "docs" : payload.module,
          task: fullPromptText,
        });
        const delegationContent =
          typeof promptContent === "string"
            ? delegationText
            : [
                {
                  type: "text" as const,
                  text: delegationText,
                },
                ...attachmentContent.images.map((img) => ({
                  type: "image" as const,
                  data: img.data,
                  mimeType: img.mimeType,
                })),
              ];
        await session.sendCustomMessage(
          {
            customType: "delegation_task",
            content: delegationContent,
            display: false,
            details: {
              delegationId: payload.delegationContext.delegationId,
              module: payload.module,
              source: payload.delegationContext.source,
              projectId: payload.delegationContext.projectId,
              projectName: payload.delegationContext.projectName,
            },
          },
          { triggerTurn: true },
        );
      } else if (typeof promptContent === "string") {
        await session.prompt(promptContent, {
          streamingBehavior: DEFAULT_STREAMING_BEHAVIOR,
        });
      } else {
        // For images, use sendUserMessage with structured content
        await session.sendUserMessage(
          promptContent as Array<
            | { type: "text"; text: string }
            | { type: "image"; data: string; mimeType: string }
          >,
          { deliverAs: DEFAULT_STREAMING_BEHAVIOR },
        );
      }

      // Wait for agent_end
      await promptDonePromise;

      console.log(
        `[kian-agent] stream ended: toolProgressCount=${toolProgressCount} toolOutputCount=${toolOutputCount} assistantText.length=${assistantText.length}`,
      );

      const shouldStartFreshAfterTurn = freshSessionOnNextPrompt.has(storeKey);
      const shouldRefreshAfterTurn = refreshSessionOnNextPrompt.has(storeKey);

      // Persist session ID for future resume
      const sdkSessionId = session.sessionId;
      if (sdkSessionId && !shouldStartFreshAfterTurn) {
        await repositoryService.setChatSessionSdkSessionId({
          scope: payload.scope,
          sessionId: payload.sessionId,
          sdkSessionId,
        });
        logger.info("Agent session stored for resume", {
          chatSessionId: payload.sessionId,
          sdkSessionId,
        });
      }

      const finalMessage = normalizeMediaMarkdownInText(
        assistantText.trim() ||
          (isRequestInterrupted()
            ? "已停止当前回答。"
            : assistantErrorMessage
              ? `处理失败：${assistantErrorMessage}`
              : toolErrorMessage
                ? `处理失败：${toolErrorMessage}`
                : toolOutputCount > 0 || toolActionsFromAgent.size > 0
                  ? SUCCESS_WITHOUT_TEXT_FINAL_MESSAGE
                  : EMPTY_AGENT_FINAL_MESSAGE),
      );

      emit({
        requestId,
        sessionId: payload.sessionId,
        scope: payload.scope,
        module: payload.module,
        createdAt: nowISO(),
        type: "assistant_done",
        fullText: finalMessage,
      });

      if (
        payload.scope.type === "project" &&
        payload.delegationContext &&
        !delegationReportState.reported
      ) {
        const report = buildAutomaticDelegationReport({
          reason: "completed",
          finalMessage,
          toolOutputs: [...toolActionsFromAgent],
        });
        await deliverDelegationReportToMainAgent({
          delegationContext: payload.delegationContext,
          sourceProjectId: payload.scope.projectId,
          sourceProjectName: payload.delegationContext.projectName,
          status: report.status,
          result: report.result,
          delegationReportState,
        });
      }

      if (shouldStartFreshAfterTurn) {
        clearSessionInternal(payload.scope, payload.sessionId, {
          startFreshOnNextPrompt: true,
        });
      } else if (shouldRefreshAfterTurn) {
        disposeSessionEntry(storeKey);
        refreshSessionOnNextPrompt.delete(storeKey);
      }

      logger.info("Agent prompt completed", {
        requestId,
        scope: getScopeKey(payload.scope),
        agent: getAgentLogLabel(payload.scope),
        chatSessionId: payload.sessionId,
        module: payload.module,
        modelId,
        modelSource,
        thinkingLevel: resolvedThinkingLevel,
        interrupted: isRequestInterrupted(),
        toolOutputCount,
        assistantTextLength: assistantText.length,
      });

      return {
        assistantMessage: finalMessage,
        toolActions: [...toolActionsFromAgent],
      };
    } catch (error) {
      if (isRequestInterrupted() || isAbortLikeError(error)) {
        const state = activeAgentRequestStore.get(storeKey);
        const activeQueuedRequest = state?.activeQueuedRequest;
        if (state?.activeQueuedRequest) {
          state.activeQueuedRequest = undefined;
          finalizeQueuedRequestTurn(activeQueuedRequest, {
            interrupted: true,
          });
        }
        const finalMessage = buildInterruptedMessage();
        emit({
          requestId,
          sessionId: payload.sessionId,
          scope: payload.scope,
          module: payload.module,
          createdAt: nowISO(),
          type: "assistant_done",
          fullText: finalMessage,
        });
        if (
          payload.scope.type === "project" &&
          payload.delegationContext &&
          !delegationReportState.reported
        ) {
          const report = buildAutomaticDelegationReport({
            reason: "interrupted",
            finalMessage,
            toolOutputs: [...toolActionsFromAgent],
          });
          await deliverDelegationReportToMainAgent({
            delegationContext: payload.delegationContext,
            sourceProjectId: payload.scope.projectId,
            sourceProjectName: payload.delegationContext.projectName,
            status: report.status,
            result: report.result,
            delegationReportState,
          });
        }
        return {
          assistantMessage: finalMessage,
          toolActions: [...toolActionsFromAgent],
        };
      }

      const message = error instanceof Error ? error.message : String(error);
      const state = activeAgentRequestStore.get(storeKey);
      const activeQueuedRequest = state?.activeQueuedRequest;
      if (state?.activeQueuedRequest) {
        state.activeQueuedRequest = undefined;
        finalizeQueuedRequestTurn(activeQueuedRequest, {
          errorMessage: message,
        });
      }

      // On failure, clear session so next message starts fresh
      clearSessionInternal(payload.scope, payload.sessionId, {
        startFreshOnNextPrompt: true,
      });

      if (
        payload.scope.type === "project" &&
        payload.delegationContext &&
        !delegationReportState.reported
      ) {
        const report = buildAutomaticDelegationReport({
          reason: "error",
          finalMessage: assistantText,
          errorMessage: message,
        });
        await deliverDelegationReportToMainAgent({
          delegationContext: payload.delegationContext,
          sourceProjectId: payload.scope.projectId,
          sourceProjectName: payload.delegationContext.projectName,
          status: report.status,
          result: report.result,
          delegationReportState,
        });
      }

      emit({
        requestId,
        sessionId: payload.sessionId,
        scope: payload.scope,
        module: payload.module,
        createdAt: nowISO(),
        type: "error",
        error: message,
      });

      logger.warn("Agent prompt failed", {
        requestId,
        scope: getScopeKey(payload.scope),
        agent: getAgentLogLabel(payload.scope),
        chatSessionId: payload.sessionId,
        module: payload.module,
        error: message,
      });

      throw new Error(message);
    } finally {
      const activeState = activeAgentRequestStore.get(storeKey);
      if (activeState?.requestId === requestId) {
        activeAgentRequestStore.delete(storeKey);
      }
    }
  },

  async interrupt(payload: ChatInterruptPayload): Promise<boolean> {
    const storeKey = getSessionStoreKey(payload.scope, payload.sessionId);
    const requestState = activeAgentRequestStore.get(storeKey);
    if (!requestState) {
      return false;
    }
    if (payload.requestId && payload.requestId !== requestState.requestId) {
      return false;
    }

    requestState.interrupted = true;
    requestState.queuedRequests = [];

    const entry = agentSessionStore.get(storeKey);
    if (!entry) {
      return true;
    }

    try {
      entry.session.clearQueue();
      await entry.session.abort();
      return true;
    } catch (error) {
      if (isAbortLikeError(error)) {
        return true;
      }
      throw error;
    }
  },

  async queueMessage(payload: ChatQueuePayload): Promise<boolean> {
    const storeKey = getSessionStoreKey(payload.scope, payload.sessionId);
    const requestState = activeAgentRequestStore.get(storeKey);
    const entry = agentSessionStore.get(storeKey);
    if (!requestState || !entry) {
      throw new Error("当前没有可排队的运行中的对话");
    }

    const attachmentContent = await buildAttachmentContent(
      payload.scope,
      payload.attachments,
    );
    const { fullPromptText, promptContent } = buildPromptContent({
      message: payload.message,
      messageSourceInfo: payload.messageSourceInfo,
      attachmentContent,
    });

    requestState.queuedRequests.push({
      requestId: payload.requestId,
      deliveryMode: payload.deliveryMode,
      message: payload.message,
      attachments: payload.attachments,
      matchText: fullPromptText,
      queuedAt: nowISO(),
    });

    try {
      if (typeof promptContent === "string") {
        await entry.session.prompt(promptContent, {
          streamingBehavior: payload.deliveryMode,
        });
      } else {
        await entry.session.sendUserMessage(promptContent, {
          deliverAs: payload.deliveryMode,
        });
      }
      return true;
    } catch (error) {
      requestState.queuedRequests = requestState.queuedRequests.filter(
        (item) => item.requestId !== payload.requestId,
      );
      throw error;
    }
  },

  getQueuedMessages(
    scope: ChatScope,
    sessionId: string,
  ): ChatQueuedMessageDTO[] {
    const storeKey = getSessionStoreKey(scope, sessionId);
    const requestState = activeAgentRequestStore.get(storeKey);
    if (!requestState || requestState.queuedRequests.length === 0) {
      return [];
    }

    return requestState.queuedRequests.map((item) => ({
      requestId: item.requestId,
      deliveryMode: item.deliveryMode,
      content: formatUserMessageContent({
        scope,
        message: item.message,
        attachments: item.attachments,
      }),
      queuedAt: item.queuedAt,
      persistUserMessage: true,
    }));
  },

  clearSession(scope: ChatScope, chatSessionId: string): void {
    clearSessionInternal(scope, chatSessionId, {
      startFreshOnNextPrompt: true,
    });
  },

  clearAllSessions(): void {
    for (const storeKey of Array.from(agentSessionStore.keys())) {
      disposeSessionEntry(storeKey);
      freshSessionOnNextPrompt.delete(storeKey);
      refreshSessionOnNextPrompt.delete(storeKey);
    }
  },

  refreshAllSessionsForNextPrompt(): void {
    for (const storeKey of Array.from(agentSessionStore.keys())) {
      if (activeAgentRequestStore.has(storeKey)) {
        refreshSessionOnNextPrompt.add(storeKey);
        continue;
      }
      disposeSessionEntry(storeKey);
      refreshSessionOnNextPrompt.delete(storeKey);
    }
  },

  hasSession(scope: ChatScope, chatSessionId: string): boolean {
    const storeKey = getSessionStoreKey(scope, chatSessionId);
    return agentSessionStore.has(storeKey);
  },
};
