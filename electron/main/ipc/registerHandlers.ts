import { dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { handle } from './handlerUtils';
import {
  assetImportSchema,
  chatSendSchema,
  chatScopeSchema,
  chatInterruptSchema,
  chatUploadFilesSchema,
  creationReplaceSchema,
  cronjobSetStatusSchema,
  docCreateSchema,
  docCreateFolderSchema,
  docDeleteFolderSchema,
  docRenameFileSchema,
  docRenameFolderSchema,
  docUpdateSchema,
  fileOpenSchema,
  filePickForUploadSchema,
  fileShowInFinderSchema,
  getAvailableModelsSchema,
  projectCreateSchema,
  projectUpdateSchema,
  skillInstallSchema,
  skillRepositorySchema,
  skillUninstallSchema,
  skillVisibilityUpdateSchema,
  saveApiKeySchema,
  saveGeneralConfigSchema,
  saveShortcutConfigSchema,
  addMcpServerSchema,
  saveBroadcastChannelConfigSchema,
  saveDiscordChatChannelConfigSchema,
  saveFeishuChatChannelConfigSchema,
  saveModelProviderConfigSchema,
  setMcpServerEnabledSchema,
  updateMcpServerSchema,
  updateCheckSchema,
  updateQuitAndInstallSchema,
  saveTelegramChatChannelConfigSchema,
  sessionCreateSchema,
  windowOpenAppPreviewSchema,
  windowOpenUrlSchema,
  taskDeleteSchema,
  taskStartSchema,
  taskStopSchema,
  taskUpdateSchema,
  taskViewSchema
} from '@shared/validators/ipc';
import { repositoryService } from '../services/repositoryService';
import { chatService } from '../services/chatService';
import { settingsService } from '../services/settingsService';
import { skillService } from '../services/skillService';
import { chatChannelService } from '../services/chatChannelService';
import { chatEvents } from '../services/chatEvents';
import { err, ok } from '@shared/utils/result';
import { logger } from '../services/logger';
import { taskService } from '../services/taskService';
import { onboardingService } from '../services/onboardingService';
import { updateService } from '../services/updateService';
import { appPreviewWindowService } from '../services/appPreviewWindowService';
import { agentService } from '../services/agentService';
import { linkOpenService } from '../services/linkOpenService';
import { resolveLocalMediaPath } from '../services/localMediaPath';

interface RegisterHandlersOptions {
  onShortcutConfigSaved?: () => Promise<void> | void;
}

const UPLOAD_DIALOG_EXTENSIONS = [
  'pdf', 'docx', 'csv', 'xlsx',
  'txt', 'json', 'yaml', 'yml', 'js', 'jsx', 'ts', 'tsx', 'md', 'markdown',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif',
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus',
  'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'flv', 'wmv', 'm3u8'
];
const translateDialogText = (
  language: import('@shared/i18n').AppLanguage,
  value: string,
): string => {
  switch (language) {
    case 'en-US':
      return ({
        '选择要发送的文件': 'Choose Files to Send',
        '添加': 'Add',
        '支持的文件': 'Supported Files',
        '所有文件': 'All Files',
      } as Record<string, string>)[value] ?? value;
    case 'ko-KR':
      return ({
        '选择要发送的文件': '보낼 파일 선택',
        '添加': '추가',
        '支持的文件': '지원되는 파일',
        '所有文件': '모든 파일',
      } as Record<string, string>)[value] ?? value;
    case 'ja-JP':
      return ({
        '选择要发送的文件': '送信するファイルを選択',
        '添加': '追加',
        '支持的文件': '対応ファイル',
        '所有文件': 'すべてのファイル',
      } as Record<string, string>)[value] ?? value;
    default:
      return value;
  }
};

const resolveFileTargetPath = (input: {
  filePath: string;
  projectId?: string;
  documentPath?: string;
}): string => {
  const trimmedInput = input.filePath.trim();
  if (!trimmedInput) {
    throw new Error('文件路径不能为空');
  }

  const resolved = resolveLocalMediaPath(encodeURIComponent(trimmedInput), {
    projectId: input.projectId,
    documentPath: input.documentPath,
  });
  if (!resolved) {
    throw new Error('路径超出 Agent 工作区目录范围');
  }
  return resolved;
};

export const registerHandlers = (options?: RegisterHandlersOptions): void => {
  const refreshChatChannel = async (): Promise<void> => {
    await chatChannelService.refresh();
  };

  handle('cronjob:list', z.object({}).optional(), async () => repositoryService.listCronJobs());
  handle('cronjob:setStatus', cronjobSetStatusSchema, async (input) =>
    repositoryService.setCronJobStatus(input)
  );
  handle('task:list', z.object({}).optional(), async () => taskService.listTasks());
  handle('task:view', taskViewSchema, async (input) => taskService.viewTask(input.id));
  handle('task:delete', taskDeleteSchema, async (input) => taskService.deleteTask(input.id));
  handle('task:start', taskStartSchema, async (input) => taskService.startTask(input.id));
  handle('task:stop', taskStopSchema, async (input) => taskService.stopTask(input.id));
  handle('task:update', taskUpdateSchema, async (input) => taskService.updateTask(input));
  handle('onboarding:getEnvironmentStatus', z.object({}).optional(), async () =>
    onboardingService.getEnvironmentStatus()
  );
  handle('update:getStatus', z.object({}).optional(), async () => updateService.getStatus());
  handle('update:check', updateCheckSchema, async (input) =>
    updateService.checkForUpdates({ force: Boolean(input?.force) })
  );
  handle('update:quitAndInstall', updateQuitAndInstallSchema, async () =>
    updateService.quitAndInstall()
  );

  handle('project:list', z.object({}).optional(), async () => repositoryService.listProjects());

  handle('project:getById', z.object({ id: z.string() }), async (input) =>
    repositoryService.getProjectById(input.id)
  );

  handle('project:create', projectCreateSchema, async (input) => {
    const project = await repositoryService.createProject(input);
    await refreshChatChannel();
    return project;
  });

  handle('project:update', projectUpdateSchema, async (input) => {
    const project = await repositoryService.updateProject(input);
    await refreshChatChannel();
    return project;
  });

  handle('project:delete', z.object({ id: z.string() }), async (input) => {
    await repositoryService.deleteProject(input.id);
    await refreshChatChannel();
    return true;
  });

  handle('docs:list', z.object({ projectId: z.string() }), async (input) =>
    repositoryService.listDocuments(input.projectId)
  );
  handle('docs:explorer', z.object({ projectId: z.string() }), async (input) =>
    repositoryService.listDocumentExplorer(input.projectId)
  );
  handle('docs:create', docCreateSchema, async (input) => repositoryService.createDocument(input));
  handle('docs:createFolder', docCreateFolderSchema, async (input) =>
    repositoryService.createDocumentDirectory(input)
  );
  handle('docs:renameFile', docRenameFileSchema, async (input) =>
    repositoryService.renameDocumentFile(input)
  );
  handle('docs:renameFolder', docRenameFolderSchema, async (input) =>
    repositoryService.renameDocumentDirectory(input)
  );
  handle('docs:deleteFolder', docDeleteFolderSchema, async (input) => {
    await repositoryService.deleteDocumentDirectory(input);
    return true;
  });
  handle('docs:update', docUpdateSchema, async (input) => repositoryService.updateDocument(input));
  handle('docs:delete', z.object({ projectId: z.string(), id: z.string() }), async (input) => {
    await repositoryService.deleteDocument(input.projectId, input.id);
    return true;
  });

  handle('app:getStatus', z.object({ projectId: z.string() }), async (input) =>
    repositoryService.getAppWorkspaceStatus(input.projectId)
  );
  handle('app:init', z.object({ projectId: z.string() }), async (input) =>
    repositoryService.initializeAppWorkspace(input.projectId)
  );
  handle('app:build', z.object({ projectId: z.string() }), async (input) =>
    repositoryService.buildAppWorkspace(input.projectId)
  );

  handle('creation:getBoard', z.object({ projectId: z.string() }), async (input) =>
    repositoryService.getCreationBoard(input.projectId)
  );

  handle('creation:replaceBoard', creationReplaceSchema, async (input) =>
    repositoryService.replaceCreationBoard(input.projectId, input.scenes)
  );

  handle(
    'assets:list',
    z.object({ projectId: z.string(), search: z.string().optional(), tags: z.array(z.string()).optional() }),
    async (input) =>
      repositoryService.listAssets(input.projectId, {
        search: input.search,
        tags: input.tags
      })
  );
  handle('assets:import', assetImportSchema, async (input) => repositoryService.importAsset(input));
  handle('assets:delete', z.object({ id: z.string() }), async (input) => {
    await repositoryService.deleteAsset(input.id);
    return true;
  });
  handle(
    'assets:search',
    z.object({ projectId: z.string(), keyword: z.string().optional(), tags: z.array(z.string()).optional() }),
    async (input) =>
      repositoryService.listAssets(input.projectId, {
        search: input.keyword,
        tags: input.tags
      })
  );
  handle(
    'assets:generateByAgent',
    z.object({ projectId: z.string(), prompt: z.string() }),
    async (input) => ({
      prompt: input.prompt,
      suggestions: [`建议镜头素材：${input.prompt}`, '建议补充氛围音效', '建议过场 B-roll']
    })
  );

  handle('chat:createSession', sessionCreateSchema, async (input) => repositoryService.createChatSession(input));
  handle(
    'chat:getSessions',
    z.object({ scope: chatScopeSchema }),
    async (input) => repositoryService.listChatSessions(input.scope)
  );
  handle('chat:getMessages', z.object({ scope: chatScopeSchema, sessionId: z.string() }), async (input) =>
    repositoryService.listMessages(input.scope, input.sessionId)
  );
  ipcMain.handle('chat:sendMessage', async (_event, payload) => {
    try {
      const input = chatSendSchema.parse(payload);
      const result = await chatService.send(input, (streamEvent) => {
        chatEvents.emitStream(streamEvent);
      });
      return ok(result);
    } catch (error) {
      logger.error('IPC failed: chat:sendMessage', error);
      if (error instanceof Error && error.name === 'ZodError') {
        return err('VALIDATION_ERROR', error.message);
      }
      return err('UNKNOWN_ERROR', error instanceof Error ? error.message : 'unknown error');
    }
  });
  handle('chat:interrupt', chatInterruptSchema, async (input) =>
    agentService.interrupt(input)
  );
  handle('chat:uploadFiles', chatUploadFilesSchema, async (input) =>
    repositoryService.uploadChatFiles(input)
  );
  handle(
    'chat:deleteSession',
    z.object({ scope: chatScopeSchema, sessionId: z.string() }),
    async (input) => repositoryService.deleteChatSession(input)
  );
  handle(
    'chat:updateSessionTitle',
    z.object({ scope: chatScopeSchema, sessionId: z.string(), title: z.string() }),
    async (input) => repositoryService.updateChatSessionTitle(input)
  );
  handle('file:pickForUpload', filePickForUploadSchema, async () => {
    const language = (await settingsService.getGeneralConfig()).language;
    const result = await dialog.showOpenDialog({
      title: translateDialogText(language, '选择要发送的文件'),
      buttonLabel: translateDialogText(language, '添加'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: translateDialogText(language, '支持的文件'),
          extensions: UPLOAD_DIALOG_EXTENSIONS,
        },
        { name: translateDialogText(language, '所有文件'), extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    const filePaths = Array.from(new Set(result.filePaths)).slice(0, 20);
    const files: Array<{ name: string; sourcePath: string; size: number }> = [];
    for (const filePath of filePaths) {
      const normalized = path.resolve(filePath);
      const stats = await fs.stat(normalized).catch(() => null);
      if (!stats?.isFile()) {
        continue;
      }
      files.push({
        name: path.basename(normalized) || 'file',
        sourcePath: normalized,
        size: stats.size
      });
    }
    return files;
  });
  handle('file:showInFinder', fileShowInFinderSchema, async (input) => {
    const targetPath = resolveFileTargetPath(input);
    await fs.access(targetPath);
    shell.showItemInFolder(targetPath);
    return true;
  });
  handle('file:open', fileOpenSchema, async (input) => {
    const targetPath = resolveFileTargetPath(input);
    await fs.access(targetPath);
    const result = await shell.openPath(targetPath);
    if (result) {
      throw new Error(`系统预览打开失败: ${result}`);
    }
    return true;
  });
  handle('window:openAppPreview', windowOpenAppPreviewSchema, async (input) =>
    appPreviewWindowService.open(input)
  );
  handle('window:openUrl', windowOpenUrlSchema, async (input) =>
    linkOpenService.open(input.url)
  );

  handle(
    'settings:get',
    z.object({ scope: chatScopeSchema }).optional(),
    async (input) => settingsService.getClaudeStatus(input?.scope ?? { type: 'main' })
  );
  handle('settings:setLastSelectedModel', z.object({ scope: chatScopeSchema, model: z.string().min(1) }), async (input) => {
    await settingsService.setLastSelectedModel(input.scope, input.model);
    return true;
  });
  handle(
    'settings:setLastSelectedThinkingLevel',
    z.object({ scope: chatScopeSchema, level: z.enum(['low', 'medium', 'high']) }),
    async (input) => {
      await settingsService.setLastSelectedThinkingLevel(input.scope, input.level);
      return true;
    }
  );
  handle('settings:getShortcutConfig', z.object({}).optional(), async () =>
    settingsService.getShortcutConfig()
  );
  handle('settings:saveShortcutConfig', saveShortcutConfigSchema, async (input) => {
    await settingsService.saveShortcutConfig(input);
    await options?.onShortcutConfigSaved?.();
    return true;
  });
  handle('settings:getClaudeSecret', z.object({ provider: z.string().min(1) }), async (input) =>
    settingsService.getClaudeSecret(input.provider)
  );
  handle('settings:setClaudeConfigStatus', z.object({ configured: z.boolean() }), async () => true);
  handle('settings:saveClaudeApiKey', saveApiKeySchema, async (input) => {
    await settingsService.saveClaudeConfig({
      provider: input.provider,
      enabled: input.enabled,
      secret: input.secret,
      baseUrl: input.baseUrl,
      api: input.api,
      customModels: input.customModels,
      enabledModels: input.enabledModels
    });
    return true;
  });
  handle('settings:getAvailableProviders', z.object({}).optional(), async () =>
    settingsService.getAvailableProviders()
  );
  handle('settings:getAvailableModels', getAvailableModelsSchema, async (input) =>
    settingsService.getAvailableModels(input.provider)
  );
  handle('settings:getModelProviderStatus', z.object({ provider: z.enum(['fal']) }), async (input) =>
    settingsService.getModelProviderStatus(input.provider)
  );
  handle('settings:getModelProviderSecret', z.object({ provider: z.enum(['fal']) }), async (input) =>
    settingsService.getModelProviderSecret(input.provider)
  );
  handle('settings:saveModelProviderConfig', saveModelProviderConfigSchema, async (input) => {
    await settingsService.saveModelProviderConfig({
      provider: input.provider,
      secret: input.secret,
      enabledModels: input.enabledModels
    });
    return true;
  });
  handle('settings:getTelegramChatChannelStatus', z.object({}).optional(), async () =>
    settingsService.getTelegramChatChannelStatus()
  );
  handle('settings:getTelegramChatChannelSecret', z.object({}).optional(), async () => {
    const runtime = await settingsService.getTelegramChatChannelRuntime();
    return runtime.secret;
  });
  handle('settings:saveTelegramChatChannelConfig', saveTelegramChatChannelConfigSchema, async (input) => {
    await settingsService.saveTelegramChatChannelConfig({
      enabled: input.enabled,
      botToken: input.botToken,
      userIds: input.userIds
    });
    await refreshChatChannel();
    return true;
  });
  handle('settings:getDiscordChatChannelStatus', z.object({}).optional(), async () =>
    settingsService.getDiscordChatChannelStatus()
  );
  handle('settings:getDiscordChatChannelSecret', z.object({}).optional(), async () => {
    const runtime = await settingsService.getDiscordChatChannelRuntime();
    return runtime.secret;
  });
  handle('settings:saveDiscordChatChannelConfig', saveDiscordChatChannelConfigSchema, async (input) => {
    await settingsService.saveDiscordChatChannelConfig({
      enabled: input.enabled,
      botToken: input.botToken,
      serverIds: input.serverIds,
      channelIds: input.channelIds
    });
    await refreshChatChannel();
    return true;
  });
  handle('settings:getFeishuChatChannelStatus', z.object({}).optional(), async () =>
    settingsService.getFeishuChatChannelStatus()
  );
  handle('settings:getFeishuChatChannelCredentials', z.object({}).optional(), async () => {
    const runtime = await settingsService.getFeishuChatChannelRuntime();
    return {
      appId: runtime.appId,
      appSecret: runtime.appSecret
    };
  });
  handle('settings:saveFeishuChatChannelConfig', saveFeishuChatChannelConfigSchema, async (input) => {
    await settingsService.saveFeishuChatChannelConfig({
      enabled: input.enabled,
      appId: input.appId,
      appSecret: input.appSecret
    });
    await refreshChatChannel();
    return true;
  });
  handle('settings:getBroadcastChannels', z.object({}).optional(), async () =>
    settingsService.getBroadcastChannels()
  );
  handle('settings:saveBroadcastChannelsConfig', saveBroadcastChannelConfigSchema, async (input) => {
    return settingsService.saveBroadcastChannelsConfig({
      channels: input.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        webhook: channel.webhook
      }))
    });
  });
  handle('settings:getMcpServers', z.object({}).optional(), async () =>
    settingsService.getMcpServers()
  );
  handle('settings:addMcpServer', addMcpServerSchema, async (input) =>
    settingsService.addMcpServer(input)
  );
  handle('settings:updateMcpServer', updateMcpServerSchema, async (input) =>
    settingsService.updateMcpServer(input)
  );
  handle('settings:setMcpServerEnabled', setMcpServerEnabledSchema, async (input) =>
    settingsService.setMcpServerEnabled(input)
  );

  handle('settings:getGeneralConfig', z.object({}).optional(), async () =>
    settingsService.getGeneralConfig()
  );
  handle(
    'settings:saveGeneralConfig',
    saveGeneralConfigSchema,
    async (input) => {
      await settingsService.saveGeneralConfig({
        workspaceRoot: input.workspaceRoot,
        language: input.language,
        linkOpenMode: input.linkOpenMode,
        mainSubModeEnabled: true,
        quickGuideDismissed: input.quickGuideDismissed,
        chatInputShortcutTipDismissed: input.chatInputShortcutTipDismissed
      });
      return true;
    }
  );

  handle('skills:getConfig', z.object({}).optional(), async () => skillService.getConfig());
  handle('skills:addRepository', skillRepositorySchema, async (input) =>
    skillService.addRepository({ repositoryUrl: input.repositoryUrl })
  );
  handle('skills:listInstalled', z.object({}).optional(), async () => skillService.listInstalledSkills());
  handle('skills:listRepositorySkills', skillRepositorySchema, async (input) =>
    skillService.listRepositorySkills(input.repositoryUrl)
  );
  handle('skills:refreshRepositoryMetadata', skillRepositorySchema, async (input) =>
    skillService.refreshRepositoryMetadata(input.repositoryUrl)
  );
  handle('skills:install', skillInstallSchema, async (input) => {
    const skill = await skillService.installSkill({
      repositoryUrl: input.repositoryUrl,
      skillPath: input.skillPath
    });
    agentService.clearAllSessions();
    return skill;
  });
  handle('skills:updateVisibility', skillVisibilityUpdateSchema, async (input) => {
    const skill = await skillService.updateInstalledSkillVisibility({
      skillId: input.skillId,
      mainAgentVisible: input.mainAgentVisible,
      projectAgentVisible: input.projectAgentVisible
    });
    agentService.clearAllSessions();
    return skill;
  });
  handle('skills:uninstall', skillUninstallSchema, async (input) => {
    const result = await skillService.uninstallSkill({
      skillId: input.skillId
    });
    agentService.clearAllSessions();
    return result;
  });
};
