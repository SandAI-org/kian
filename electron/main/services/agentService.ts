import {
  Type,
  type AssistantMessageEvent,
} from "@mariozechner/pi-ai";
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
  ClaudeConfigStatus,
  ChatInterruptPayload,
  ChatMessageDTO,
  ChatMessageMetadata,
  ChatModuleType,
  ChatScope,
  ChatSendPayload,
  ChatSendResponse,
  ChatStreamEvent,
  ChatThinkingLevel,
  DelegationContext,
  ModuleType,
} from "@shared/types";
import { app } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildSessionSystemPrompt,
  type SessionContextFile,
} from "./agentPrompt";
import { createAppOperationTools } from "./appOperationMcpServer";
import { createBuiltinTools } from "./builtinMcpServer";
import { chatEvents } from "./chatEvents";
import { buildContextSnapshotSection } from "./contextSnapshotFormatter";
import { toToolDefinition, type CustomToolDef } from "./customTools";
import { logger } from "./logger";
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
let appDeveloperMetadataCache: DeveloperMetadata | null | undefined = undefined;
const isDevelopmentMode =
  !app.isPackaged || process.env.NODE_ENV === "development";
const DEFAULT_CHAT_THINKING_LEVEL: ChatThinkingLevel = "low";
const DEFAULT_STREAMING_BEHAVIOR = "steer" as const;
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

export const getSessionSummaryDir = (
  scope: ChatScope,
  agentCwd: string,
): string =>
  scope.type === "main"
    ? path.join(agentCwd, "sessions")
    : path.join(agentCwd, "docs", "sessions");

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const normalizeSemanticFileNameSegment = (
  input: string,
  fallback: string,
  maxLength = 40,
): string => {
  const normalized = input
    .normalize("NFKC")
    .replace(/[“”‘’"'`]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]+/gu, " ")
    .replace(/[\s_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) return fallback;
  const safe = [...normalized].slice(0, maxLength).join("").replace(/-+$/g, "");
  return safe || fallback;
};

const resolveUniqueSummaryFilePath = async (
  summaryDir: string,
  baseName: string,
): Promise<string> => {
  let candidate = path.join(summaryDir, `${baseName}.md`);
  let suffix = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(summaryDir, `${baseName}-${suffix}.md`);
    suffix += 1;
  }
  return candidate;
};

const truncateText = (input: string, maxLength: number): string => {
  const compact = input.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength)}...`;
};

const getRoleLabel = (role: ChatMessageDTO["role"]): string => {
  if (role === "user") return "用户";
  if (role === "assistant") return "助手";
  if (role === "tool") return "工具";
  return "系统";
};

const buildFallbackSessionSummary = (messages: ChatMessageDTO[]): string => {
  const recent = messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-8)
    .map(
      (item) =>
        `${getRoleLabel(item.role)}：${truncateText(item.content, 140)}`,
    );
  if (recent.length === 0) {
    return "暂无可用历史消息，无法自动提炼总结。";
  }
  return `自动摘要（最近 ${recent.length} 条用户/助手消息）：\n${recent.join("\n")}`;
};

const toStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 20);
};

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

const writeSessionSummaryFile = async (input: {
  scope: ChatScope;
  chatSessionId: string;
  agentCwd: string;
  fileTitle: string;
  summary: string;
  keyPoints: string[];
  nextActions: string[];
}): Promise<{ filePath: string; messageCount: number }> => {
  const messages = await repositoryService.listMessages(
    input.scope,
    input.chatSessionId,
  );
  const now = new Date();
  const isoTime = now.toISOString();
  const dayStamp = isoTime.slice(0, 10);
  const summaryDir = getSessionSummaryDir(input.scope, input.agentCwd);
  await mkdir(summaryDir, { recursive: true });
  const semanticTitle = normalizeSemanticFileNameSegment(
    input.fileTitle,
    "session-summary",
  );
  const fileBaseName = `${dayStamp}-${semanticTitle}`;
  const filePath = await resolveUniqueSummaryFilePath(summaryDir, fileBaseName);
  const scopeTypeLabel = input.scope.type === "main" ? "主 Agent" : "子智能体";
  const scopeIdLabel =
    input.scope.type === "main" ? MAIN_AGENT_ID : input.scope.projectId;

  const summaryText =
    input.summary.trim() || buildFallbackSessionSummary(messages);
  const lines: string[] = [
    "# Session Summary",
    "",
    `- 时间：${isoTime}`,
    `- 会话归属：${scopeTypeLabel}`,
    `- 标识：${scopeIdLabel}`,
    `- Chat Session：${input.chatSessionId}`,
    `- 历史消息数：${messages.length}`,
    "",
    "## 会话总结",
    summaryText,
  ];

  if (input.keyPoints.length > 0) {
    lines.push(
      "",
      "## 关键要点",
      ...input.keyPoints.map((item) => `- ${item}`),
    );
  }

  if (input.nextActions.length > 0) {
    lines.push(
      "",
      "## 下一步",
      ...input.nextActions.map((item) => `- ${item}`),
    );
  }

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return { filePath, messageCount: messages.length };
};

const buildNewSessionTool = (input: {
  scope: ChatScope;
  chatSessionId: string;
  agentCwd: string;
  description: string;
  reloadHint: string;
}): CustomToolDef => ({
  name: "NewSession",
  label: "NewSession",
  description: input.description,
  parameters: Type.Object({
    file_title: Type.String({
      description:
        "归档文件标题（必填）。由你基于会话内容生成，使用用户语言，简短且语义明确；不要带日期和扩展名。",
    }),
    summary: Type.String({
      description:
        "当前会话的总结（必填，建议包含目标、结论、约束、未完成事项）",
    }),
    key_points: Type.Optional(
      Type.Array(Type.String({ description: "关键要点" })),
    ),
    next_actions: Type.Optional(
      Type.Array(Type.String({ description: "后续建议动作" })),
    ),
  }),
  async handler(params) {
    try {
      const fileTitle =
        typeof params.file_title === "string" ? params.file_title.trim() : "";
      const summary =
        typeof params.summary === "string" ? params.summary.trim() : "";
      if (!fileTitle) {
        return {
          text: `NewSession failed: file_title 不能为空，需先生成归档文件标题。`,
          isError: true,
        };
      }
      if (!summary) {
        return {
          text: `NewSession failed: summary 不能为空，调用前请先给出会话总结。`,
          isError: true,
        };
      }

      const keyPoints = toStringList(params.key_points);
      const nextActions = toStringList(params.next_actions);
      const storeKey = getSessionStoreKey(input.scope, input.chatSessionId);

      const { filePath, messageCount } = await writeSessionSummaryFile({
        scope: input.scope,
        chatSessionId: input.chatSessionId,
        agentCwd: input.agentCwd,
        fileTitle,
        summary,
        keyPoints,
        nextActions,
      });

      freshSessionOnNextPrompt.add(storeKey);

      return {
        text: [
          `会话总结已写入：${filePath}`,
          `已归档历史消息：${messageCount} 条。`,
          input.reloadHint,
        ].join("\n"),
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
  agentCwd: string;
}): CustomToolDef[] => {
  const sessionSummaryPathLabel =
    input.scope.type === "main"
      ? "当前 Agent 目录下的 sessions"
      : "docs/sessions";

  return [
    buildNewSessionTool({
      scope: input.scope,
      chatSessionId: input.chatSessionId,
      agentCwd: input.agentCwd,
      description: `
        结束当前 Agent 会话，并在下次用户消息时启动一个全新的当前 Agent 会话。调用前必须总结当前上下文，并提供一个由你生成的、与用户语言一致的语义化文件标题；工具会把总结写入 ${sessionSummaryPathLabel}。
        当用户明确要求开启当前 Agent 新会话，或者当前 Agent 工作区 docs 目录中的设定（docs/IDENTITY.md / docs/SOUL.md / docs/USER.md）发生变更时，执行该工具。
      `.trim(),
      reloadHint:
        "当前 Agent 会话将在本轮结束后关闭；下一次对话将启动新会话并重新加载当前 Agent 工作区 docs 目录中的 IDENTITY.md / SOUL.md / USER.md。",
    }),
  ];
};

const describeProject = (projectId: string, projectName: string): string =>
  projectName === projectId ? projectId : `${projectName} (${projectId})`;

const buildChatMessageMetadataJson = (metadata: ChatMessageMetadata): string =>
  JSON.stringify(metadata);

const parseChatMessageMetadata = (
  raw: string | null | undefined,
): ChatMessageMetadata | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as ChatMessageMetadata;
  } catch {
    return null;
  }
};

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
  const mainMessages = await repositoryService.listMessages(
    { type: "main" },
    input.mainSessionId,
  );

  for (let index = mainMessages.length - 1; index >= 0; index -= 1) {
    const message = mainMessages[index];
    const metadata = parseChatMessageMetadata(message?.metadataJson);
    if (metadata?.kind !== "delegation_receipt") {
      continue;
    }
    if (metadata.targetProjectId !== input.targetProjectId) {
      continue;
    }

    const targetSessionId = metadata.targetSessionId?.trim();
    if (!targetSessionId) {
      continue;
    }

    const session = await repositoryService.getChatSession(
      { type: "project", projectId: input.targetProjectId },
      targetSessionId,
    );
    if (session) {
      return { id: session.id };
    }
  }

  return null;
};

const appendSubAgentReport = async (input: {
  delegationContext: DelegationContext;
  sourceProjectId: string;
  sourceProjectName: string;
  status: "completed" | "failed";
  result: string;
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
    metadataJson: buildChatMessageMetadataJson({
      kind: "sub_agent_report",
      delegationId: input.delegationContext.delegationId,
      sourceProjectId: input.sourceProjectId,
      sourceProjectName: input.sourceProjectName,
      status: input.status,
    }),
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
  const storeKey = getSessionStoreKey(
    mainScope,
    input.delegationContext.mainSessionId,
  );
  const reportPrompt = [
    `子智能体 ${describeProject(input.sourceProjectId, input.sourceProjectName)} 收到任务回报。`,
    `委派编号：${input.delegationContext.delegationId}`,
    `状态：${input.status === "completed" ? "completed" : "failed"}`,
    "",
    "请基于这条回报继续处理当前用户任务，并在需要时决定是否继续委派或直接给出答复。",
    "",
    input.result.trim(),
  ].join("\n");

  const activeRequest = activeAgentRequestStore.get(storeKey);
  const entry = agentSessionStore.get(storeKey);

  if (activeRequest && entry) {
    await entry.session.followUp(reportPrompt);
    return;
  }

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
  const result = await chatService.send(
    {
      scope: mainScope,
      module: "main",
      sessionId: input.delegationContext.mainSessionId,
      requestId: `main-report-${input.delegationContext.delegationId}`,
      message: reportPrompt,
      skipUserMessagePersistence: true,
    },
    (event) => {
      chatEvents.emitStream(event);
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

  if (!existingReport) {
    await appendSubAgentReport({
      delegationContext: input.delegationContext,
      sourceProjectId: input.sourceProjectId,
      sourceProjectName: input.sourceProjectName,
      status: effectiveReport.status,
      result: effectiveReport.result,
    });
    if (input.delegationReportState) {
      input.delegationReportState.appendedReport = effectiveReport;
    }
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

          await repositoryService.appendMessage({
            scope: { type: "main" },
            sessionId: input.runtime.chatSessionId,
            role: "system",
            content: `已委派给：**${project.name}**`,
            metadataJson: buildChatMessageMetadataJson({
              kind: "delegation_receipt",
              delegationId,
              targetProjectId: project.id,
              targetProjectName: project.name,
              targetSessionId: session.id,
            }),
          });

          void (async () => {
            try {
              const { chatService } = await import("./chatService");
              await chatService.send(
                {
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
                },
                (event) => {
                  chatEvents.emitStream(event);
                },
              );
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
  if (input.scope.type === "main") {
    return [
      "## 主从模式说明",
      "你是主 Agent，负责与用户对话，并将具体工作区执行任务优先委派给子智能体。",
      "当任务明确落在某个 Agent 上时，优先使用 callSubAgent；如果现有 Agent 都不合适，先创建新 Agent；不要假装已经在对应工作区内执行。",
    ].join("\n");
  }
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
  moduleName?: ChatModuleType,
  contextSnapshot?: unknown,
  delegationContext?: DelegationContext,
  delegationReportState?: DelegationReportState,
): Promise<{
  session: AgentSession;
  unsubscribe: () => void;
  modelId: string;
  modelSource:
    | "payload.model"
    | "settings.lastSelectedModel"
    | "settings.firstEnabledModel";
  thinkingLevel: ChatThinkingLevel;
}> => {
  const storeKey = getSessionStoreKey(scope, chatSessionId);
  const scopeKey = getScopeKey(scope);
  const agentRuntimeDir = getScopeAgentRuntimeDir(scope);
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
    throw new Error(`Model not found: ${effectiveProvider}:${effectiveModelId}`);
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

  if (startFreshRequested || refreshRequested) {
    disposeSessionEntry(storeKey);
  }

  const delegationToolRuntime: DelegationToolRuntime = {
    chatSessionId,
    delegationContext,
    delegationReportState,
  };

  const existing = agentSessionStore.get(storeKey);
  if (existing) {
    if (
      existing.modelId !== compositeModelKey ||
      existing.modelConfigSignature !== currentModelConfigSignature ||
      existing.mcpSignature !== mcpSignature
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

  // Create coding tools configured for the project directory
  const tools = createCodingTools(projectCwd);
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
  const builtinTools = createBuiltinTools(projectCwd, scope.type).map(
    toToolDefinition,
  );
  const appOperationTools = createAppOperationTools(
    scope.type === "project" ? scope.projectId : MAIN_AGENT_ID,
    scope.type,
  ).map(toToolDefinition);
  const sessionControlTools = createSessionControlTools({
    scope,
    chatSessionId,
    agentCwd: projectCwd,
  }).map(toToolDefinition);
  const delegationTools = createDelegationTools({
    scope,
    runtime: delegationToolRuntime,
  }).map(toToolDefinition);
  const customTools = [
    ...builtinTools,
    ...appOperationTools,
    ...sessionControlTools,
    ...delegationTools,
    ...mcpRuntime.tools,
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
    toolCount: toolNames.length,
    toolNames,
    reusedSession: false,
  });

  const resumedSessionManager = startFreshRequested
    ? undefined
    : SessionManager.continueRecent(projectCwd, sessionDir);
  const previousContextModel =
    resumedSessionManager?.buildSessionContext().model;
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
      skillService.listActiveSkillsForScope({
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
  const fallbackSystemPrompt = await settingsService.getAgentSystemPrompt(
    scope.type,
  );
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
        });
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
    const {
      provider: effectiveProvider,
      modelId: effectiveModelId,
    } = resolveEffectiveAgentModelSelection(status, payload.model);
    const resolvedModel = await settingsService.resolveAgentModel(
      effectiveProvider,
      effectiveModelId,
    );
    if (!resolvedModel) {
      throw new Error(`Model not found: ${effectiveProvider}:${effectiveModelId}`);
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

    try {
      const {
        session,
        modelId,
        modelSource,
        thinkingLevel: resolvedThinkingLevel,
      } = await createOrResumeSession(
        payload.scope,
        projectCwd,
        payload.sessionId,
        payload.model,
        payload.thinkingLevel,
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
        // --- message_update: streaming text and tool call starts ---
        if (event.type === "message_update") {
          const llmEvent: AssistantMessageEvent = event.assistantMessageEvent;

          if (llmEvent.type === "text_delta") {
            assistantText += llmEvent.delta;
            streamedLength += llmEvent.delta.length;
            emit({
              requestId,
              sessionId: payload.sessionId,
              scope: payload.scope,
              module: payload.module,
              createdAt: nowISO(),
              type: "assistant_delta",
              delta: llmEvent.delta,
            });
            return;
          }

          if (llmEvent.type === "thinking_start") {
            emit({
              requestId,
              sessionId: payload.sessionId,
              scope: payload.scope,
              module: payload.module,
              createdAt: nowISO(),
              type: "thinking_start",
            });
            return;
          }

          if (llmEvent.type === "thinking_delta") {
            streamedThinkingLength += llmEvent.delta.length;
            emit({
              requestId,
              sessionId: payload.sessionId,
              scope: payload.scope,
              module: payload.module,
              createdAt: nowISO(),
              type: "thinking_delta",
              delta: llmEvent.delta,
            });
            return;
          }

          if (llmEvent.type === "thinking_end") {
            const thinkingContent = llmEvent.content?.trim() ?? "";
            if (thinkingContent) {
              streamedThinkingLength = Math.max(
                streamedThinkingLength,
                thinkingContent.length,
              );
            }
            emit({
              requestId,
              sessionId: payload.sessionId,
              scope: payload.scope,
              module: payload.module,
              createdAt: nowISO(),
              type: "thinking_end",
              thinking: thinkingContent || undefined,
            });
            return;
          }

          if (llmEvent.type === "toolcall_end") {
            const toolCall = llmEvent.toolCall;
            emit({
              requestId,
              sessionId: payload.sessionId,
              scope: payload.scope,
              module: payload.module,
              createdAt: nowISO(),
              type: "tool_start",
              toolUseId: toolCall.id,
              toolName: toolCall.name,
              toolInput: safeStringifyInput(toolCall.arguments),
            });
            toolStartTimes.set(toolCall.id, Date.now());
            return;
          }

          return;
        }

        // --- tool_execution_start ---
        if (event.type === "tool_execution_start") {
          toolProgressCount += 1;
          if (!toolStartTimes.has(event.toolCallId)) {
            // Tool was not announced via toolcall_end, emit tool_start now
            emit({
              requestId,
              sessionId: payload.sessionId,
              scope: payload.scope,
              module: payload.module,
              createdAt: nowISO(),
              type: "tool_start",
              toolUseId: event.toolCallId,
              toolName: event.toolName,
              toolInput: safeStringifyInput(event.args),
            });
            toolStartTimes.set(event.toolCallId, Date.now());
          }
          return;
        }

        // --- tool_execution_update ---
        if (event.type === "tool_execution_update") {
          const startTime = toolStartTimes.get(event.toolCallId) ?? Date.now();
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          emit({
            requestId,
            sessionId: payload.sessionId,
            scope: payload.scope,
            module: payload.module,
            createdAt: nowISO(),
            type: "tool_progress",
            toolUseId: event.toolCallId,
            toolName: event.toolName,
            elapsedSeconds,
          });
          return;
        }

        // --- tool_execution_end ---
        if (event.type === "tool_execution_end") {
          toolOutputCount += 1;
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
            toolErrorMessage = outputText || `工具执行失败：${event.toolName}`;
          }
          if (outputText) {
            toolActionsFromAgent.add(
              outputText.length > 200
                ? `${outputText.slice(0, 200)}...`
                : outputText,
            );
          }
          emit({
            requestId,
            sessionId: payload.sessionId,
            scope: payload.scope,
            module: payload.module,
            createdAt: nowISO(),
            type: "tool_output",
            toolUseId: event.toolCallId,
            toolName: event.toolName,
            output: outputText || undefined,
          });
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
            const fullThinking = msg.content
              .map((c: { type?: string; thinking?: string }) =>
                c?.type === "thinking" ? (c.thinking ?? "") : "",
              )
              .join("")
              .trim();
            if (fullThinking && fullThinking.length > streamedThinkingLength) {
              emit({
                requestId,
                sessionId: payload.sessionId,
                scope: payload.scope,
                module: payload.module,
                createdAt: nowISO(),
                type: "thinking_end",
                thinking: fullThinking,
              });
              streamedThinkingLength = fullThinking.length;
            }
            const fullText = msg.content
              .map((c: { type?: string; text?: string }) =>
                c?.type === "text" ? (c.text ?? "") : "",
              )
              .join("")
              .trim();
            if (fullText && fullText.length > streamedLength) {
              const remaining = fullText.slice(streamedLength);
              if (remaining) {
                emit({
                  requestId,
                  sessionId: payload.sessionId,
                  scope: payload.scope,
                  module: payload.module,
                  createdAt: nowISO(),
                  type: "assistant_delta",
                  delta: remaining,
                });
              }
              assistantText = fullText;
              streamedLength = fullText.length;
            }
            if (
              !assistantText.trim() &&
              typeof msg.errorMessage === "string" &&
              msg.errorMessage.trim()
            ) {
              assistantErrorMessage = msg.errorMessage.trim();
            }
          }
          return;
        }

        // --- agent_end: final event ---
        if (event.type === "agent_end") {
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

      // Build the prompt content
      let promptContent:
        | string
        | {
            type: "text" | "image";
            text?: string;
            data?: string;
            mimeType?: string;
          }[];
      const messageText = payload.message.trim();
      const fullPromptText = attachmentContent.promptText
        ? `${messageText}\n\n${attachmentContent.promptText}`
        : messageText;

      if (attachmentContent.images.length > 0) {
        // Build content array with text + images
        const contentParts: {
          type: "text" | "image";
          text?: string;
          data?: string;
          mimeType?: string;
        }[] = [{ type: "text", text: fullPromptText }];
        for (const img of attachmentContent.images) {
          contentParts.push({
            type: "image",
            data: img.data,
            mimeType: img.mimeType,
          });
        }
        promptContent = contentParts;
      } else {
        promptContent = fullPromptText;
      }

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

      // On failure, clear session so next message starts fresh
      clearSessionInternal(payload.scope, payload.sessionId, {
        startFreshOnNextPrompt: true,
      });

      const message = error instanceof Error ? error.message : String(error);
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

    const entry = agentSessionStore.get(storeKey);
    if (!entry) {
      return true;
    }

    try {
      await entry.session.abort();
      return true;
    } catch (error) {
      if (isAbortLikeError(error)) {
        return true;
      }
      throw error;
    }
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
