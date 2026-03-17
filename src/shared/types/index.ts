import type { AppLanguage } from "@shared/i18n";

export type ModuleType = 'docs' | 'creation' | 'assets' | 'app';
export type ChatModuleType = ModuleType | 'main';
export type AppType = 'react' | 'vue' | 'svelte' | 'nextjs' | 'nuxt' | 'angular' | 'vanilla' | 'unknown';
export type ProjectCreationSource = 'manual' | 'agent';
export type ClaudeProvider = string;
export type MediaProvider = 'fal';
export type ChatChannelProvider = 'telegram' | 'discord' | 'feishu' | 'broadcast';
export type BroadcastChannelType = 'feishu' | 'wechat';
export type McpTransportType = 'stdio' | 'sse' | 'streamable-http';
export type AppUpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'downloaded'
  | 'upToDate'
  | 'failed';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'AGENT_ERROR'
  | 'FS_ERROR'
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'UNKNOWN_ERROR';

export interface AppError {
  code: AppErrorCode;
  message: string;
  details?: unknown;
}

export interface ProjectDTO {
  id: string;
  name: string;
  description?: string | null;
  cover?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDTO {
  id: string;
  projectId: string;
  title: string;
  content: string;
  metadataJson?: string | null;
  version: number;
  updatedAt: string;
}

export interface DocExplorerEntryDTO {
  path: string;
  name: string;
  kind: 'directory' | 'file';
  isEditableText: boolean;
  isMarkdown: boolean;
}

export interface AppWorkspaceStatusDTO {
  projectId: string;
  appDir: string;
  distIndexPath: string;
  appType: AppType;
  appName: string;
  initialized: boolean;
  dependenciesInstalled: boolean;
  hasBuild: boolean;
  builtAt?: string | null;
}

export interface AppBuildResultDTO {
  projectId: string;
  appDir: string;
  distIndexPath: string;
  builtAt: string;
  installedDependencies: boolean;
}

export interface OpenAppPreviewWindowPayload {
  projectId: string;
  distIndexPath: string;
  builtAt: string;
  appName?: string;
  appType?: AppType;
}

export interface CreationShotDTO {
  id: string;
  title: string;
  prompt: string;
  notes?: string | null;
  duration?: number | null;
  order: number;
}

export interface CreationSceneDTO {
  id: string;
  title: string;
  description: string;
  order: number;
  shots: CreationShotDTO[];
}

export interface CreationBoardDTO {
  id: string;
  projectId: string;
  scenes: CreationSceneDTO[];
  updatedAt: string;
}

export interface TimelineClipDTO {
  id: string;
  trackId: string;
  assetId?: string | null;
  start: number;
  end: number;
  content?: string | null;
  metaJson?: string | null;
}

export interface TimelineTrackDTO {
  id: string;
  timelineId: string;
  type: 'video' | 'audio' | 'text' | 'effect';
  order: number;
  clips: TimelineClipDTO[];
}

export interface TimelineDTO {
  id: string;
  projectId: string;
  title: string;
  fps: number;
  duration: number;
  snapshotJson: string;
  tracks: TimelineTrackDTO[];
}

export interface AssetDTO {
  id: string;
  projectId: string;
  type: 'image' | 'video' | 'audio' | 'file';
  name: string;
  path: string;
  absolutePath?: string | null;
  duration?: number | null;
  thumbnailPath?: string | null;
  tagsJson?: string | null;
  metaJson?: string | null;
  sizeBytes?: number | null;
  createdAt: string;
}

export interface ChatSessionDTO {
  id: string;
  scopeType: 'project' | 'main';
  projectId?: string;
  module: ChatModuleType;
  title: string;
  sdkSessionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatScopeProject {
  type: 'project';
  projectId: string;
}

export interface ChatScopeMain {
  type: 'main';
}

export type ChatScope = ChatScopeProject | ChatScopeMain;

export interface DelegationContext {
  delegationId: string;
  mainSessionId: string;
  source: 'main';
  projectId: string;
  projectName: string;
}

export interface ChatMessageMetadata {
  kind: 'delegation' | 'sub_agent_report' | 'delegation_receipt' | 'thinking';
  delegationId?: string;
  sourceProjectId?: string;
  sourceProjectName?: string;
  status?: 'completed' | 'failed';
  targetProjectId?: string;
  targetProjectName?: string;
  targetSessionId?: string;
}

export interface ChatMessageDTO {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCallJson?: string | null;
  metadataJson?: string | null;
  createdAt: string;
}

export interface AppSettingDTO {
  key: string;
  value: string;
}

export type ChatThinkingLevel = 'low' | 'medium' | 'high';

export interface KeyboardShortcutDTO {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ShortcutConfigDTO {
  sendMessage: KeyboardShortcutDTO;
  insertNewline: KeyboardShortcutDTO;
  focusMainAgentInput: KeyboardShortcutDTO;
  openSettingsPage: KeyboardShortcutDTO;
  newChatSession: KeyboardShortcutDTO;
  quickLauncher: KeyboardShortcutDTO;
}

export interface ChatSendPayload {
  scope: ChatScope;
  module: ChatModuleType;
  sessionId: string;
  requestId?: string;
  message: string;
  model?: string;
  thinkingLevel?: ChatThinkingLevel;
  attachments?: ChatAttachmentDTO[];
  contextSnapshot?: unknown;
  delegationContext?: DelegationContext;
  skipUserMessagePersistence?: boolean;
}

export interface ChatInterruptPayload {
  scope: ChatScope;
  sessionId: string;
  requestId?: string;
}

export interface ChatAttachmentDTO {
  name: string;
  path: string;
  mimeType?: string;
  size: number;
}

export interface ChatUploadFilePayload {
  name: string;
  sourcePath: string;
  mimeType?: string;
  size?: number;
}

export interface ChatSendResponse {
  assistantMessage: string;
  toolActions: string[];
}

export interface ChatStreamEvent {
  requestId: string;
  sessionId: string;
  scope: ChatScope;
  module: ChatModuleType;
  createdAt?: string;
  type:
    | 'assistant_delta'
    | 'assistant_done'
    | 'thinking_start'
    | 'thinking_delta'
    | 'thinking_end'
    | 'tool_start'
    | 'tool_progress'
    | 'tool_output'
    | 'error';
  delta?: string;
  fullText?: string;
  thinking?: string;
  toolUseId?: string;
  toolName?: string;
  toolInput?: string;
  elapsedSeconds?: number;
  output?: string;
  error?: string;
}

export interface ChatHistoryUpdatedEvent {
  scope: ChatScope;
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  createdAt: string;
  sessionTitle?: string;
  sessionUpdatedAt?: string;
  sessionModule?: ChatModuleType;
}

export type AppOperationEvent =
  | {
      type: 'navigate';
      projectId: string;
      module?: ModuleType;
      documentId?: string;
    }
  | {
      type: 'app_preview_refreshed';
      projectId: string;
    };

export interface AppUpdateStatusDTO {
  stage: AppUpdateStage;
  currentVersion: string;
  latestVersion?: string;
  downloadedVersion?: string;
  downloadedFilePath?: string;
  progressPercent?: number;
  message?: string;
  lastCheckedAt?: string;
}

export interface AgentProviderDTO {
  id: string;
  name: string;
}

export interface AgentModelDTO {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

export interface ProviderConfigEntry {
  configured: boolean;
  enabled: boolean;
  apiKey: string;
  enabledModels: string[];
}

export interface EnabledModelEntry {
  provider: string;
  modelId: string;
  modelName: string;
}

export interface ClaudeConfigStatus {
  providers: Record<string, ProviderConfigEntry>;
  allEnabledModels: EnabledModelEntry[];
  lastSelectedModel?: string;
  lastSelectedThinkingLevel?: ChatThinkingLevel;
}

export interface OnboardingDependencyStatus {
  installed: boolean;
  version?: string;
}

export interface OnboardingEnvironmentStatus {
  node: OnboardingDependencyStatus;
  pnpm: OnboardingDependencyStatus;
  claudeCode: OnboardingDependencyStatus;
}

export interface ProviderModelDTO {
  modelId: string;
  modelDescription: string;
  capability: 'image' | 'video' | 'audio';
}

export interface ModelProviderConfigStatus {
  provider: MediaProvider;
  configured: boolean;
  secret: string;
  enabledModels: string[];
  models: ProviderModelDTO[];
}

export interface TelegramChatChannelStatus {
  provider: 'telegram';
  enabled: boolean;
  configured: boolean;
  botToken: string;
  userIds: string[];
}

export interface DiscordChatChannelStatus {
  provider: 'discord';
  enabled: boolean;
  configured: boolean;
  botToken: string;
  serverIds: string[];
  channelIds: string[];
}

export interface FeishuChatChannelStatus {
  provider: 'feishu';
  enabled: boolean;
  configured: boolean;
  appId: string;
  appSecret: string;
}

export type LinkOpenMode = 'builtin' | 'system';

export interface GeneralConfigDTO {
  workspaceRoot: string;
  language: AppLanguage;
  linkOpenMode: LinkOpenMode;
  mainSubModeEnabled: boolean;
  quickGuideDismissed: boolean;
  chatInputShortcutTipDismissed: boolean;
}

export interface BroadcastChannelDTO {
  id: string;
  name: string;
  type: BroadcastChannelType;
  webhook: string;
}

export interface McpServerDTO {
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

export interface CronJobDTO {
  id: string;
  cron: string;
  timeSummary: string;
  content: string;
  status: string;
  targetAgentId?: string | null;
  targetAgentName?: string | null;
}

export type TaskStatus = 'running' | 'stopped' | 'success';

export interface TaskDTO {
  id: string;
  createdAt: string;
  name: string;
  status: TaskStatus;
  command: string;
  pid: number | null;
  taskDir: string;
  stdoutLogPath: string;
}

export interface TaskDetailDTO extends TaskDTO {
  stdout: string;
  stdoutSizeBytes: number;
  stdoutTruncated: boolean;
}

export interface SkillRepositoryDTO {
  url: string;
  builtin: boolean;
}

export interface SkillConfigDTO {
  repositories: SkillRepositoryDTO[];
}

export interface InstalledSkillDTO {
  id: string;
  name: string;
  repositoryUrl: string;
  skillPath: string;
  installPath: string;
  description: string;
  installedAt: string;
  mainAgentVisible: boolean;
  projectAgentVisible: boolean;
}

export interface SkillListItemDTO {
  id: string;
  name: string;
  repositoryUrl: string;
  skillPath: string;
  description: string;
  installed: boolean;
}

export interface SkillMetadataRefreshDTO {
  updatedCount: number;
  totalCount: number;
}
