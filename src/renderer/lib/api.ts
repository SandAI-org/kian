import { unwrap } from './result';
import type {
  AgentModelDTO,
  AgentProviderDTO,
  AppBuildResultDTO,
  BroadcastChannelDTO,
  ChatScope,
  CustomAgentModelConfigDTO,
  GeneralConfigDTO,
  ShortcutConfigDTO,
  McpServerDTO,
  AppOperationEvent,
  AppUpdateStatusDTO,
  AppWorkspaceStatusDTO,
  ChatAttachmentDTO,
  ChatHistoryUpdatedEvent,
  ChatInterruptPayload,
  ChatQueuedMessageDTO,
  ChatQueuePayload,
  ChatSendPayload,
  ChatThinkingLevel,
  ChatStreamEvent,
  ChatUploadFilePayload,
  CronJobDTO,
  DiscordChatChannelStatus,
  InstalledSkillDTO,
  MediaProvider,
  FeishuChatChannelStatus,
  ModuleType,
  OnboardingEnvironmentStatus,
  ModelProviderConfigStatus,
  ProjectCreationSource,
  SkillConfigDTO,
  SkillListItemDTO,
  SkillMetadataRefreshDTO,
  TaskDTO,
  TaskDetailDTO,
  OpenAppPreviewWindowPayload,
  TelegramChatChannelStatus,
  WeixinChatChannelQrSessionDTO,
  WeixinChatChannelStatus,
  WeixinQrLoginResultDTO
} from '@shared/types';

export const api = {
  onboarding: {
    getEnvironmentStatus: async (): Promise<OnboardingEnvironmentStatus> =>
      unwrap(await window.api.onboarding.getEnvironmentStatus())
  },
  cronjob: {
    list: async (): Promise<CronJobDTO[]> => unwrap(await window.api.cronjob.list()),
    setStatus: async (payload: { id: string; status: 'active' | 'paused' }): Promise<CronJobDTO> =>
      unwrap(await window.api.cronjob.setStatus(payload))
  },
  task: {
    list: async (): Promise<TaskDTO[]> => unwrap(await window.api.task.list()),
    view: async (id: string): Promise<TaskDetailDTO> => unwrap(await window.api.task.view(id)),
    delete: async (id: string): Promise<boolean> => unwrap(await window.api.task.delete(id)),
    start: async (id: string): Promise<TaskDTO> => unwrap(await window.api.task.start(id)),
    stop: async (id: string): Promise<TaskDTO> => unwrap(await window.api.task.stop(id)),
    update: async (payload: {
      id?: string;
      name?: string;
      command?: string;
      status?: 'running' | 'stopped' | 'success';
    }): Promise<TaskDTO> => unwrap(await window.api.task.update(payload))
  },
  project: {
    list: async () => unwrap(await window.api.project.list()),
    getById: async (id: string) => unwrap(await window.api.project.getById(id)),
    create: async (payload: {
      name?: string;
      description?: string;
      cover?: string;
      source?: ProjectCreationSource;
    }) =>
      unwrap(await window.api.project.create(payload)),
    update: async (payload: { id: string; name?: string; description?: string | null; cover?: string | null }) =>
      unwrap(await window.api.project.update(payload)),
    delete: async (id: string) => unwrap(await window.api.project.delete(id))
  },
  docs: {
    list: async (projectId: string) => unwrap(await window.api.docs.list(projectId)),
    explorer: async (projectId: string) => unwrap(await window.api.docs.explorer(projectId)),
    create: async (payload: { projectId: string; title: string; content: string }) =>
      unwrap(await window.api.docs.create(payload)),
    createFolder: async (payload: { projectId: string; path: string }) =>
      unwrap(await window.api.docs.createFolder(payload)),
    renameFile: async (payload: { projectId: string; path: string; name: string }) =>
      unwrap(await window.api.docs.renameFile(payload)),
    renameFolder: async (payload: { projectId: string; path: string; name: string }) =>
      unwrap(await window.api.docs.renameFolder(payload)),
    deleteFolder: async (payload: { projectId: string; path: string }) =>
      unwrap(await window.api.docs.deleteFolder(payload)),
    update: async (payload: {
      projectId: string;
      id: string;
      title?: string;
      content?: string;
      metadataJson?: string | null;
    }) => unwrap(await window.api.docs.update(payload)),
    delete: async (projectId: string, id: string) => unwrap(await window.api.docs.delete(projectId, id))
  },
  app: {
    getStatus: async (projectId: string): Promise<AppWorkspaceStatusDTO> =>
      unwrap(await window.api.app.getStatus(projectId)),
    init: async (projectId: string): Promise<AppWorkspaceStatusDTO> =>
      unwrap(await window.api.app.init(projectId)),
    build: async (projectId: string): Promise<AppBuildResultDTO> =>
      unwrap(await window.api.app.build(projectId))
  },
  creation: {
    getBoard: async (projectId: string) => unwrap(await window.api.creation.getBoard(projectId)),
    replaceBoard: async (payload: { projectId: string; scenes: Record<string, unknown>[] }) =>
      unwrap(await window.api.creation.replaceBoard(payload))
  },
  assets: {
    list: async (projectId: string, options?: { search?: string; tags?: string[] }) =>
      unwrap(await window.api.assets.list(projectId, options)),
    import: async (payload: {
      projectId: string;
      type: 'image' | 'video' | 'audio';
      name: string;
      path: string;
      duration?: number;
      thumbnailPath?: string;
      tags?: string[];
    }) => unwrap(await window.api.assets.import(payload)),
    delete: async (id: string) => unwrap(await window.api.assets.delete(id)),
    generateByAgent: async (payload: { projectId: string; prompt: string }) =>
      unwrap(await window.api.assets.generateByAgent(payload))
  },
  chat: {
    createSession: async (payload: { scope: ChatScope; module: ModuleType | 'main'; title: string }) =>
      unwrap(await window.api.chat.createSession(payload)),
    getSessions: async (scope: ChatScope) =>
      unwrap(await window.api.chat.getSessions(scope)),
    getMessages: async (scope: ChatScope, sessionId: string) =>
      unwrap(await window.api.chat.getMessages(scope, sessionId)),
    getQueuedMessages: async (
      scope: ChatScope,
      sessionId: string,
    ): Promise<ChatQueuedMessageDTO[]> =>
      unwrap(await window.api.chat.getQueuedMessages(scope, sessionId)),
    uploadFiles: async (payload: { scope: ChatScope; files: ChatUploadFilePayload[] }): Promise<ChatAttachmentDTO[]> =>
      unwrap(await window.api.chat.uploadFiles(payload)),
    sendMessage: async (payload: ChatSendPayload) =>
      unwrap(await window.api.chat.sendMessage(payload)),
    queueMessage: async (payload: ChatQueuePayload): Promise<boolean> =>
      unwrap(await window.api.chat.queueMessage(payload)),
    interrupt: async (payload: ChatInterruptPayload): Promise<boolean> =>
      unwrap(await window.api.chat.interrupt(payload)),
    deleteSession: async (scope: ChatScope, sessionId: string) =>
      unwrap(await window.api.chat.deleteSession({ scope, sessionId })),
    updateSessionTitle: async (scope: ChatScope, sessionId: string, title: string) =>
      unwrap(await window.api.chat.updateSessionTitle({ scope, sessionId, title })),
    subscribeStream: (handler: (event: ChatStreamEvent) => void) => window.api.chat.subscribeStream(handler),
    subscribeHistoryUpdated: (handler: (event: ChatHistoryUpdatedEvent) => void) =>
      window.api.chat.subscribeHistoryUpdated(handler)
  },
  appOperation: {
    subscribe: (handler: (event: AppOperationEvent) => void) => window.api.appOperation.subscribe(handler)
  },
  update: {
    getStatus: async (): Promise<AppUpdateStatusDTO> => unwrap(await window.api.update.getStatus()),
    check: async (payload?: { force?: boolean }): Promise<AppUpdateStatusDTO> =>
      unwrap(await window.api.update.check(payload)),
    quitAndInstall: async (): Promise<boolean> => unwrap(await window.api.update.quitAndInstall()),
    subscribeStatus: (handler: (event: AppUpdateStatusDTO) => void) => window.api.update.subscribeStatus(handler)
  },
  file: {
    getPathForFile: (file: File): string => window.api.file.getPathForFile(file),
    pickForUpload: async (): Promise<ChatUploadFilePayload[]> =>
      unwrap(await window.api.file.pickForUpload()),
    showInFinder: async (
      filePath: string,
      projectId?: string,
      documentPath?: string,
    ): Promise<boolean> =>
      unwrap(await window.api.file.showInFinder(filePath, projectId, documentPath)),
    open: async (
      filePath: string,
      projectId?: string,
      documentPath?: string,
    ): Promise<boolean> =>
      unwrap(await window.api.file.open(filePath, projectId, documentPath))
  },
  clipboard: {
    writeText: async (text: string): Promise<boolean> => window.api.clipboard.writeText(text)
  },
  settings: {
    get: async (scope: ChatScope) => unwrap(await window.api.settings.get(scope)),
    setLastSelectedModel: async (scope: ChatScope, model: string) =>
      unwrap(await window.api.settings.setLastSelectedModel(scope, model)),
    setLastSelectedThinkingLevel: async (
      scope: ChatScope,
      level: ChatThinkingLevel,
    ) => unwrap(await window.api.settings.setLastSelectedThinkingLevel(scope, level)),
    getShortcutConfig: async (): Promise<ShortcutConfigDTO> =>
      unwrap(await window.api.settings.getShortcutConfig()),
    saveShortcutConfig: async (payload: ShortcutConfigDTO) =>
      unwrap(await window.api.settings.saveShortcutConfig(payload)),
    saveClaudeApiKey: async (payload: {
      provider: string;
      displayName?: string;
      enabled: boolean;
      secret?: string;
      baseUrl?: string;
      api?: string;
      customModels: CustomAgentModelConfigDTO[];
      enabledModels: string[];
    }) =>
      unwrap(await window.api.settings.saveClaudeApiKey(payload)),
    getAvailableProviders: async (): Promise<AgentProviderDTO[]> =>
      unwrap(await window.api.settings.getAvailableProviders()),
    getAvailableModels: async (provider: string): Promise<AgentModelDTO[]> =>
      unwrap(await window.api.settings.getAvailableModels(provider)),
    getModelProviderStatus: async (provider: MediaProvider): Promise<ModelProviderConfigStatus> =>
      unwrap(await window.api.settings.getModelProviderStatus(provider)),
    saveModelProviderConfig: async (payload: {
      provider: MediaProvider;
      secret?: string;
      enabledModels?: string[];
    }) => unwrap(await window.api.settings.saveModelProviderConfig(payload)),
    getTelegramChatChannelStatus: async (): Promise<TelegramChatChannelStatus> =>
      unwrap(await window.api.settings.getTelegramChatChannelStatus()),
    saveTelegramChatChannelConfig: async (payload: {
      enabled: boolean;
      botToken?: string;
      userIds: string[];
    }) => unwrap(await window.api.settings.saveTelegramChatChannelConfig(payload)),
    getDiscordChatChannelStatus: async (): Promise<DiscordChatChannelStatus> =>
      unwrap(await window.api.settings.getDiscordChatChannelStatus()),
    saveDiscordChatChannelConfig: async (payload: {
      enabled: boolean;
      botToken?: string;
      serverIds: string[];
      channelIds: string[];
    }) => unwrap(await window.api.settings.saveDiscordChatChannelConfig(payload)),
    getFeishuChatChannelStatus: async (): Promise<FeishuChatChannelStatus> =>
      unwrap(await window.api.settings.getFeishuChatChannelStatus()),
    saveFeishuChatChannelConfig: async (payload: {
      enabled: boolean;
      appId?: string;
      appSecret?: string;
    }) => unwrap(await window.api.settings.saveFeishuChatChannelConfig(payload)),
    getWeixinChatChannelStatus: async (): Promise<WeixinChatChannelStatus> =>
      unwrap(await window.api.settings.getWeixinChatChannelStatus()),
    saveWeixinChatChannelConfig: async (payload: {
      enabled: boolean;
      accountId?: string;
    }) => unwrap(await window.api.settings.saveWeixinChatChannelConfig(payload)),
    startWeixinQrLogin: async (payload?: {
      forceRefresh?: boolean;
    }): Promise<WeixinChatChannelQrSessionDTO> =>
      unwrap(await window.api.settings.startWeixinQrLogin(payload)),
    waitForWeixinQrLogin: async (payload: {
      sessionKey: string;
      timeoutMs?: number;
    }): Promise<WeixinQrLoginResultDTO> =>
      unwrap(await window.api.settings.waitForWeixinQrLogin(payload)),
    removeWeixinAccount: async (payload: {
      accountId: string;
    }): Promise<boolean> =>
      unwrap(await window.api.settings.removeWeixinAccount(payload)),
    getBroadcastChannels: async (): Promise<BroadcastChannelDTO[]> =>
      unwrap(await window.api.settings.getBroadcastChannels()),
    saveBroadcastChannelsConfig: async (payload: {
      channels: Array<{
        id?: string;
        name: string;
        type?: string;
        webhook: string;
      }>;
    }) => unwrap(await window.api.settings.saveBroadcastChannelsConfig(payload)),
    getMcpServers: async (): Promise<McpServerDTO[]> =>
      unwrap(await window.api.settings.getMcpServers()),
    addMcpServer: async (payload: {
      name: string;
      transport: "stdio" | "sse" | "streamable-http";
      enabled?: boolean;
      command?: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    }): Promise<McpServerDTO> => unwrap(await window.api.settings.addMcpServer(payload)),
    updateMcpServer: async (payload: {
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
    }): Promise<McpServerDTO> => unwrap(await window.api.settings.updateMcpServer(payload)),
    setMcpServerEnabled: async (payload: { id: string; enabled: boolean }): Promise<McpServerDTO> =>
      unwrap(await window.api.settings.setMcpServerEnabled(payload)),
    getGeneralConfig: async (): Promise<GeneralConfigDTO> =>
      unwrap(await window.api.settings.getGeneralConfig()),
    saveGeneralConfig: async (payload: GeneralConfigDTO) =>
      unwrap(await window.api.settings.saveGeneralConfig(payload))
  },
  skills: {
    getConfig: async (): Promise<SkillConfigDTO> => unwrap(await window.api.skills.getConfig()),
    addRepository: async (repositoryUrl: string): Promise<SkillConfigDTO> =>
      unwrap(await window.api.skills.addRepository(repositoryUrl)),
    listInstalled: async (): Promise<InstalledSkillDTO[]> => unwrap(await window.api.skills.listInstalled()),
    listRepositorySkills: async (repositoryUrl: string): Promise<SkillListItemDTO[]> =>
      unwrap(await window.api.skills.listRepositorySkills(repositoryUrl)),
    refreshRepositoryMetadata: async (repositoryUrl: string): Promise<SkillMetadataRefreshDTO> =>
      unwrap(await window.api.skills.refreshRepositoryMetadata(repositoryUrl)),
    install: async (payload: { repositoryUrl: string; skillPath: string }): Promise<InstalledSkillDTO> =>
      unwrap(await window.api.skills.install(payload)),
    updateVisibility: async (payload: {
      skillId: string;
      mainAgentVisible: boolean;
      projectAgentVisible: boolean;
    }): Promise<InstalledSkillDTO> => unwrap(await window.api.skills.updateVisibility(payload)),
    uninstall: async (payload: { skillId: string }): Promise<boolean> =>
      unwrap(await window.api.skills.uninstall(payload))
  },
  window: {
    close: async () => unwrap(await window.api.window.close()),
    hide: async () => unwrap(await window.api.window.hide()),
    dismissQuickLauncher: async () => unwrap(await window.api.window.dismissQuickLauncher()),
    toggleMaximize: async (): Promise<boolean> => unwrap(await window.api.window.toggleMaximize()),
    openUrl: async (url: string): Promise<boolean> => unwrap(await window.api.window.openUrl(url)),
    openMainAgentSession: async (sessionId: string): Promise<boolean> =>
      unwrap(await window.api.window.openMainAgentSession(sessionId)),
    openAppPreview: async (payload: OpenAppPreviewWindowPayload): Promise<boolean> =>
      unwrap(await window.api.window.openAppPreview(payload)),
    resizeQuickLauncher: async (height: number): Promise<boolean> =>
      unwrap(await window.api.window.resizeQuickLauncher(height)),
    setQuickLauncherResizable: async (resizable: boolean): Promise<boolean> =>
      unwrap(await window.api.window.setQuickLauncherResizable(resizable)),
    subscribeFocusMainAgentShortcut: (handler: () => void) =>
      window.api.window.subscribeFocusMainAgentShortcut(handler),
    subscribeOpenMainAgentSession: (handler: (sessionId: string) => void) =>
      window.api.window.subscribeOpenMainAgentSession(handler)
  }
};
