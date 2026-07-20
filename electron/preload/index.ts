import type {
  AgentModelDTO,
  AgentGroupDTO,
  AgentGroupMessageDTO,
  AgentGroupMessagePageDTO,
  AgentGroupTypingStateDTO,
  AgentProviderDTO,
  AppBuildResultDTO,
  BroadcastChannelDTO,
  ChatScope,
  McpServerDTO,
  AppUpdateStatusDTO,
  AppOperationEvent,
  AppWorkspaceStatusDTO,
  ChatAttachmentDTO,
  ChatContinueInNewSessionPayload,
  ChatEditMessagePayload,
  ChatHistoryUpdatedEvent,
  ChatInterruptPayload,
  ChatQueuedMessageDTO,
  ChatQueueUpdatedEvent,
  ChatMessageDTO,
  ChatQueuePayload,
  ChatSendPayload,
  ChatSendDispatchResponse,
  ChatSessionDTO,
  ChatStreamEvent,
  ChatUploadFilePayload,
  SavePastedUploadFilePayload,
  ClaudeConfigStatus,
  CronJobDTO,
  CreationBoardDTO,
  DiscordChatChannelStatus,
  DocExplorerEntryDTO,
  DocImportFilePayload,
  DocumentDTO,
  FeishuChatChannelStatus,
  GeneralConfigDTO,
  InstalledSkillContentDTO,
  ShortcutConfigDTO,
  InstalledSkillDTO,
  MediaProvider,
  ModelProviderConfigStatus,
  ModuleType,
  OpenAppPreviewWindowPayload,
  OnboardingEnvironmentStatus,
  ProjectCreationSource,
  ProjectDTO,
  Result,
  SkillConfigDTO,
  SkillFileContentDTO,
  SkillListItemDTO,
  SkillMetadataRefreshDTO,
  TaskDTO,
  TaskDetailDTO,
  TelegramChatChannelStatus,
  WeixinChatChannelQrSessionDTO,
  WeixinChatChannelStatus,
  WeixinQrLoginResultDTO,
} from "@shared/types";
import { clipboard, contextBridge, ipcRenderer, nativeImage, webUtils } from "electron";

const invoke = <T>(channel: string, payload?: unknown): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, payload ?? {});
const FOCUS_MAIN_AGENT_SHORTCUT_CHANNEL = "window:focus-main-agent-shortcut";
const OPEN_MAIN_AGENT_SESSION_CHANNEL = "window:open-main-agent-session";

const api = {
  cronjob: {
    list: () => invoke<CronJobDTO[]>("cronjob:list"),
    listWithLastExecution: () =>
      invoke<CronJobDTO[]>("cronjob:listWithLastExecution"),
    setStatus: (payload: { id: string; status: "active" | "paused" }) =>
      invoke<CronJobDTO>("cronjob:setStatus", payload),
  },
  task: {
    list: () => invoke<TaskDTO[]>("task:list"),
    view: (id: string) => invoke<TaskDetailDTO>("task:view", { id }),
    delete: (id: string) => invoke<boolean>("task:delete", { id }),
    start: (id: string) => invoke<TaskDTO>("task:start", { id }),
    stop: (id: string) => invoke<TaskDTO>("task:stop", { id }),
    update: (payload: {
      id?: string;
      name?: string;
      command?: string;
      status?: "running" | "stopped" | "success";
    }) => invoke<TaskDTO>("task:update", payload),
  },
  onboarding: {
    getEnvironmentStatus: () =>
      invoke<OnboardingEnvironmentStatus>("onboarding:getEnvironmentStatus"),
  },
  project: {
    list: () => invoke<ProjectDTO[]>("project:list"),
    getById: (id: string) =>
      invoke<ProjectDTO | null>("project:getById", { id }),
    create: (payload: {
      name?: string;
      description?: string;
      cover?: string;
      source?: ProjectCreationSource;
    }) =>
      invoke<ProjectDTO>("project:create", payload),
    update: (payload: {
      id: string;
      name?: string;
      description?: string | null;
      cover?: string | null;
    }) => invoke<ProjectDTO>("project:update", payload),
    delete: (id: string) => invoke<boolean>("project:delete", { id }),
  },
  agentGroup: {
    list: () => invoke<AgentGroupDTO[]>("agentGroup:list"),
    create: (payload: {
      name: string;
      description?: string;
      memberProjectIds?: string[];
    }) =>
      invoke<AgentGroupDTO>("agentGroup:create", payload),
    update: (payload: {
      id: string;
      name?: string;
      description?: string | null;
    }) => invoke<AgentGroupDTO>("agentGroup:update", payload),
    delete: (id: string) => invoke<boolean>("agentGroup:delete", { id }),
    addMembers: (payload: { groupId: string; projectIds: string[] }) =>
      invoke<AgentGroupDTO>("agentGroup:addMembers", payload),
    removeMember: (payload: { groupId: string; projectIds: string[] }) =>
      invoke<AgentGroupDTO>("agentGroup:removeMember", payload),
  },
  agentGroupMessage: {
    list: (payload: {
      groupId: string;
      limit?: number;
      beforeCursor?: string | null;
    }) => invoke<AgentGroupMessagePageDTO>("agentGroupMessage:list", payload),
    getTypingState: (payload: { groupId: string }) =>
      invoke<AgentGroupTypingStateDTO>("agentGroupMessage:getTypingState", payload),
    sendUserMessage: (payload: { groupId: string; content: string }) =>
      invoke<AgentGroupMessageDTO>("agentGroupMessage:sendUserMessage", payload),
    subscribeUpdated: (
      handler: (event: { groupId: string; message: AgentGroupMessageDTO }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { groupId: string; message: AgentGroupMessageDTO },
      ): void => {
        handler(payload);
      };
      ipcRenderer.on("agentGroupMessage:updated", listener);
      return (): void => {
        ipcRenderer.removeListener("agentGroupMessage:updated", listener);
      };
    },
    subscribeTypingUpdated: (
      handler: (event: AgentGroupTypingStateDTO) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: AgentGroupTypingStateDTO,
      ): void => {
        handler(payload);
      };
      ipcRenderer.on("agentGroupMessage:typingUpdated", listener);
      return (): void => {
        ipcRenderer.removeListener("agentGroupMessage:typingUpdated", listener);
      };
    },
  },
  docs: {
    list: (projectId: string) =>
      invoke<DocumentDTO[]>("docs:list", { projectId }),
    explorer: (projectId: string) =>
      invoke<DocExplorerEntryDTO[]>("docs:explorer", { projectId }),
    create: (payload: { projectId: string; title: string; content: string }) =>
      invoke<DocumentDTO>("docs:create", payload),
    createFolder: (payload: { projectId: string; path: string }) =>
      invoke<DocExplorerEntryDTO>("docs:createFolder", payload),
    renameFile: (payload: { projectId: string; path: string; name: string }) =>
      invoke<DocExplorerEntryDTO>("docs:renameFile", payload),
    importFiles: (payload: { projectId: string; files: DocImportFilePayload[] }) =>
      invoke<DocExplorerEntryDTO[]>("docs:importFiles", payload),
    renameFolder: (payload: { projectId: string; path: string; name: string }) =>
      invoke<DocExplorerEntryDTO>("docs:renameFolder", payload),
    deleteFolder: (payload: { projectId: string; path: string }) =>
      invoke<boolean>("docs:deleteFolder", payload),
    update: (payload: {
      projectId: string;
      id: string;
      title?: string;
      content?: string;
      metadataJson?: string | null;
    }) => invoke<DocumentDTO>("docs:update", payload),
    delete: (projectId: string, id: string) =>
      invoke<boolean>("docs:delete", { projectId, id }),
  },
  app: {
    getStatus: (projectId: string) =>
      invoke<AppWorkspaceStatusDTO>("app:getStatus", { projectId }),
    init: (projectId: string) =>
      invoke<AppWorkspaceStatusDTO>("app:init", { projectId }),
    build: (projectId: string) =>
      invoke<AppBuildResultDTO>("app:build", { projectId }),
    saveBuildToDocs: (projectId: string) =>
      invoke<DocumentDTO>("app:saveBuildToDocs", { projectId }),
  },
  creation: {
    getBoard: (projectId: string) =>
      invoke<CreationBoardDTO>("creation:getBoard", { projectId }),
    replaceBoard: (payload: {
      projectId: string;
      scenes: Record<string, unknown>[];
    }) => invoke<CreationBoardDTO>("creation:replaceBoard", payload),
  },
  chat: {
    createSession: (payload: {
      scope: ChatScope;
      module: ModuleType | "main";
      title: string;
      kind?: "normal" | "digital_avatar" | "channel_runtime" | "group_runtime";
      hidden?: boolean;
      metadataJson?: string | null;
    }) => invoke<ChatSessionDTO>("chat:createSession", payload),
    getDigitalAvatarSession: (scope: ChatScope) =>
      invoke<ChatSessionDTO>("chat:getDigitalAvatarSession", { scope }),
    getSessions: (
      scope: ChatScope,
      options?: {
        kinds?: ("normal" | "digital_avatar" | "channel_runtime" | "group_runtime")[];
        includeHidden?: boolean;
      },
    ) =>
      invoke<ChatSessionDTO[]>("chat:getSessions", {
        scope,
        kinds: options?.kinds,
        includeHidden: options?.includeHidden,
      }),
    getMessages: (scope: ChatScope, sessionId: string) =>
      invoke<ChatMessageDTO[]>("chat:getMessages", { scope, sessionId }),
    getQueuedMessages: (scope: ChatScope, sessionId: string) =>
      invoke<ChatQueuedMessageDTO[]>("chat:getQueuedMessages", {
        scope,
        sessionId,
      }),
    sendMessage: (payload: ChatSendPayload) =>
      invoke<ChatSendDispatchResponse>("chat:sendMessage", payload),
    queueMessage: (payload: ChatQueuePayload) =>
      invoke<boolean>("chat:queueMessage", payload),
    interrupt: (payload: ChatInterruptPayload) =>
      invoke<boolean>("chat:interrupt", payload),
    editMessage: (payload: ChatEditMessagePayload) =>
      invoke<ChatSendDispatchResponse>("chat:editMessage", payload),
    continueInNewSession: (payload: ChatContinueInNewSessionPayload) =>
      invoke<ChatSessionDTO>("chat:continueInNewSession", payload),
    uploadFiles: (payload: {
      scope: ChatScope;
      files: ChatUploadFilePayload[];
    }) => invoke<ChatAttachmentDTO[]>("chat:uploadFiles", payload),
    deleteSession: (payload: { scope: ChatScope; sessionId: string }) =>
      invoke<void>("chat:deleteSession", payload),
    updateSessionTitle: (payload: {
      scope: ChatScope;
      sessionId: string;
      title: string;
    }) => invoke<void>("chat:updateSessionTitle", payload),
    subscribeStream: (handler: (event: ChatStreamEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: ChatStreamEvent,
      ): void => {
        handler(payload);
      };
      ipcRenderer.on("chat:stream", listener);
      return (): void => {
        ipcRenderer.removeListener("chat:stream", listener);
      };
    },
    subscribeHistoryUpdated: (
      handler: (event: ChatHistoryUpdatedEvent) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: ChatHistoryUpdatedEvent,
      ): void => {
        handler(payload);
      };
      ipcRenderer.on("chat:historyUpdated", listener);
      return (): void => {
        ipcRenderer.removeListener("chat:historyUpdated", listener);
      };
    },
    subscribeQueueUpdated: (
      handler: (event: ChatQueueUpdatedEvent) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: ChatQueueUpdatedEvent,
      ): void => {
        handler(payload);
      };
      ipcRenderer.on("chat:queueUpdated", listener);
      return (): void => {
        ipcRenderer.removeListener("chat:queueUpdated", listener);
      };
    },
  },
  appOperation: {
    subscribe: (handler: (event: AppOperationEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: AppOperationEvent,
      ): void => {
        handler(payload);
      };
      ipcRenderer.on("app:operation", listener);
      return (): void => {
        ipcRenderer.removeListener("app:operation", listener);
      };
    },
  },
  update: {
    getStatus: () => invoke<AppUpdateStatusDTO>("update:getStatus"),
    check: (payload?: { force?: boolean }) =>
      invoke<AppUpdateStatusDTO>("update:check", payload ?? {}),
    quitAndInstall: () => invoke<boolean>("update:quitAndInstall"),
    debugSetStatus: (payload: {
      stage: AppUpdateStatusDTO["stage"];
      latestVersion?: string;
      releaseNotes?: string;
      progressPercent?: number;
      message?: string;
    }) => invoke<AppUpdateStatusDTO>("update:debugSetStatus", payload),
    subscribeStatus: (handler: (event: AppUpdateStatusDTO) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: AppUpdateStatusDTO,
      ): void => {
        handler(payload);
      };
      ipcRenderer.on("update:status", listener);
      return (): void => {
        ipcRenderer.removeListener("update:status", listener);
      };
    },
  },
  file: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    pickForUpload: () => invoke<ChatUploadFilePayload[]>("file:pickForUpload"),
    savePastedUpload: (payload: SavePastedUploadFilePayload) =>
      invoke<ChatUploadFilePayload>("file:savePastedUpload", payload),
    showInFinder: (
      filePath: string,
      projectId?: string,
      documentPath?: string,
    ) => invoke<boolean>("file:showInFinder", { filePath, projectId, documentPath }),
    open: (
      filePath: string,
      projectId?: string,
      documentPath?: string,
    ) => invoke<boolean>("file:open", { filePath, projectId, documentPath }),
    savePng: (payload: { defaultFileName: string; dataUrl: string }) =>
      invoke<string | null>("file:savePng", payload),
    saveAs: (payload: {
      filePath: string;
      projectId?: string;
      documentPath?: string;
      defaultFileName?: string;
    }) => invoke<string | null>("file:saveAs", payload),
  },
  clipboard: {
    writeText: (text: string) => {
      clipboard.writeText(text);
      return true;
    },
    writePng: (dataUrl: string) => {
      const image = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(image);
      return true;
    },
  },
  settings: {
    get: (scope: ChatScope) => invoke<ClaudeConfigStatus>("settings:get", { scope }),
    setLastSelectedModel: (scope: ChatScope, model: string) =>
      invoke<boolean>("settings:setLastSelectedModel", { scope, model }),
    setLastSelectedThinkingLevel: (
      scope: ChatScope,
      level: "low" | "medium" | "high",
    ) => invoke<boolean>("settings:setLastSelectedThinkingLevel", { scope, level }),
    getShortcutConfig: () =>
      invoke<ShortcutConfigDTO>("settings:getShortcutConfig"),
    saveShortcutConfig: (payload: ShortcutConfigDTO) =>
      invoke<boolean>("settings:saveShortcutConfig", payload),
    setClaudeConfigStatus: (configured: boolean) =>
      invoke<boolean>("settings:setClaudeConfigStatus", { configured }),
    saveClaudeApiKey: (payload: {
      provider: string;
      displayName?: string;
      enabled: boolean;
      secret?: string;
      baseUrl?: string;
      api?: string;
      customModels: Array<{
        id: string;
        name?: string;
        reasoning: boolean;
        input: Array<"text" | "image">;
        contextWindow: number;
        maxTokens: number;
      }>;
      enabledModels: string[];
    }) => invoke<boolean>("settings:saveClaudeApiKey", payload),
    getAvailableProviders: () =>
      invoke<AgentProviderDTO[]>("settings:getAvailableProviders"),
    getAvailableModels: (provider: string) =>
      invoke<AgentModelDTO[]>("settings:getAvailableModels", { provider }),
    getModelProviderStatus: (provider: MediaProvider) =>
      invoke<ModelProviderConfigStatus>("settings:getModelProviderStatus", {
        provider,
      }),
    saveModelProviderConfig: (payload: {
      provider: MediaProvider;
      secret?: string;
      enabledModels?: string[];
    }) => invoke<boolean>("settings:saveModelProviderConfig", payload),
    getTelegramChatChannelStatus: () =>
      invoke<TelegramChatChannelStatus>(
        "settings:getTelegramChatChannelStatus",
      ),
    saveTelegramChatChannelConfig: (payload: {
      enabled: boolean;
      botToken?: string;
      ownerUserIds: string[];
    }) => invoke<boolean>("settings:saveTelegramChatChannelConfig", payload),
    getDiscordChatChannelStatus: () =>
      invoke<DiscordChatChannelStatus>("settings:getDiscordChatChannelStatus"),
    saveDiscordChatChannelConfig: (payload: {
      enabled: boolean;
      botToken?: string;
      ownerUserIds: string[];
      serverIds: string[];
      channelIds: string[];
    }) => invoke<boolean>("settings:saveDiscordChatChannelConfig", payload),
    getFeishuChatChannelStatus: () =>
      invoke<FeishuChatChannelStatus>("settings:getFeishuChatChannelStatus"),
    saveFeishuChatChannelConfig: (payload: {
      enabled: boolean;
      appId?: string;
      appSecret?: string;
      ownerUserIds: string[];
    }) => invoke<boolean>("settings:saveFeishuChatChannelConfig", payload),
    getWeixinChatChannelStatus: () =>
      invoke<WeixinChatChannelStatus>("settings:getWeixinChatChannelStatus"),
    saveWeixinChatChannelConfig: (payload: {
      enabled: boolean;
      accountId?: string;
    }) => invoke<boolean>("settings:saveWeixinChatChannelConfig", payload),
    startWeixinQrLogin: (payload?: {
      forceRefresh?: boolean;
    }) =>
      invoke<WeixinChatChannelQrSessionDTO>("settings:startWeixinQrLogin", payload),
    waitForWeixinQrLogin: (payload: {
      sessionKey: string;
      timeoutMs?: number;
    }) =>
      invoke<WeixinQrLoginResultDTO>("settings:waitForWeixinQrLogin", payload),
    removeWeixinAccount: (payload: { accountId: string }) =>
      invoke<boolean>("settings:removeWeixinAccount", payload),
    getBroadcastChannels: () =>
      invoke<BroadcastChannelDTO[]>("settings:getBroadcastChannels"),
    saveBroadcastChannelsConfig: (payload: {
      channels: Array<{
        id?: string;
        name: string;
        type?: string;
        webhook: string;
      }>;
    }) => invoke<BroadcastChannelDTO[]>("settings:saveBroadcastChannelsConfig", payload),
    getMcpServers: () => invoke<McpServerDTO[]>("settings:getMcpServers"),
    addMcpServer: (payload: {
      name: string;
      transport: "stdio" | "sse" | "streamable-http";
      enabled?: boolean;
      command?: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    }) => invoke<McpServerDTO>("settings:addMcpServer", payload),
    updateMcpServer: (payload: {
      id: string;
      name: string;
      transport: "stdio" | "sse" | "streamable-http";
      enabled?: boolean;
      command?: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    }) => invoke<McpServerDTO>("settings:updateMcpServer", payload),
    setMcpServerEnabled: (payload: { id: string; enabled: boolean }) =>
      invoke<McpServerDTO>("settings:setMcpServerEnabled", payload),
    getGeneralConfig: () =>
      invoke<GeneralConfigDTO>("settings:getGeneralConfig"),
    saveGeneralConfig: (payload: GeneralConfigDTO) =>
      invoke<boolean>("settings:saveGeneralConfig", payload),
  },
  skills: {
    getConfig: () => invoke<SkillConfigDTO>("skills:getConfig"),
    addRepository: (repositoryUrl: string) =>
      invoke<SkillConfigDTO>("skills:addRepository", { repositoryUrl }),
    listInstalled: () => invoke<InstalledSkillDTO[]>("skills:listInstalled"),
    getContent: (payload: { skillId: string }) =>
      invoke<InstalledSkillContentDTO>("skills:getContent", payload),
    getFileContent: (payload: { skillId: string; path: string }) =>
      invoke<SkillFileContentDTO>("skills:getFileContent", payload),
    listRepositorySkills: (repositoryUrl: string) =>
      invoke<SkillListItemDTO[]>("skills:listRepositorySkills", {
        repositoryUrl,
      }),
    refreshRepositoryMetadata: (repositoryUrl: string) =>
      invoke<SkillMetadataRefreshDTO>("skills:refreshRepositoryMetadata", {
        repositoryUrl,
      }),
    install: (payload: { repositoryUrl: string; skillPath: string }) =>
      invoke<InstalledSkillDTO>("skills:install", payload),
    pickLocalSources: () =>
      invoke<string[]>("skills:pickLocalSources"),
    installLocalSources: (payload: { sourcePaths: string[] }) =>
      invoke<InstalledSkillDTO[]>("skills:installLocalSources", payload),
    installFromMarkdown: (payload: { markdown: string }) =>
      invoke<InstalledSkillDTO>("skills:installFromMarkdown", payload),
    installFromClawHub: (payload: { input: string }) =>
      invoke<InstalledSkillDTO[]>("skills:installFromClawHub", payload),
    updateVisibility: (payload: {
      skillId: string;
      mainAgentVisible: boolean;
      projectAgentVisible: boolean;
    }) => invoke<InstalledSkillDTO>("skills:updateVisibility", payload),
    uninstall: (payload: { skillId: string }) =>
      invoke<boolean>("skills:uninstall", payload),
  },
  window: {
    close: () => invoke<boolean>("window:close"),
    hide: () => invoke<boolean>("window:hide"),
    restartApp: () => invoke<boolean>("window:restartApp"),
    dismissQuickLauncher: () => invoke<boolean>("window:dismissQuickLauncher"),
    toggleMaximize: () => invoke<boolean>("window:toggleMaximize"),
    openUrl: (url: string) => invoke<boolean>("window:openUrl", { url }),
    openMainAgentSession: (sessionId: string) =>
      invoke<boolean>("window:openMainAgentSession", { sessionId }),
    openAppPreview: (payload: OpenAppPreviewWindowPayload) =>
      invoke<boolean>("window:openAppPreview", payload),
    resizeQuickLauncher: (height: number) =>
      invoke<boolean>("window:resizeQuickLauncher", { height }),
    setQuickLauncherResizable: (resizable: boolean) =>
      invoke<boolean>("window:setQuickLauncherResizable", { resizable }),
    subscribeFocusMainAgentShortcut: (handler: () => void) => {
      const listener = (): void => {
        handler();
      };
      ipcRenderer.on(FOCUS_MAIN_AGENT_SHORTCUT_CHANNEL, listener);
      return (): void => {
        ipcRenderer.removeListener(FOCUS_MAIN_AGENT_SHORTCUT_CHANNEL, listener);
      };
    },
    subscribeOpenMainAgentSession: (handler: (sessionId: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        sessionId: string,
      ): void => {
        handler(sessionId);
      };
      ipcRenderer.on(OPEN_MAIN_AGENT_SESSION_CHANNEL, listener);
      return (): void => {
        ipcRenderer.removeListener(OPEN_MAIN_AGENT_SESSION_CHANNEL, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("api", api);

export type API = typeof api;
