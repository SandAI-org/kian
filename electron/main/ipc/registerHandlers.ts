import { dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { handle } from './handlerUtils';
import {
  agentGroupCreateSchema,
  agentGroupMembersSchema,
  agentGroupMessageListSchema,
  agentGroupUpdateSchema,
  agentGroupUserMessageSendSchema,
  chatQueueSchema,
  chatQueuedMessagesSchema,
  chatListSessionsSchema,
  chatSendSchema,
  chatScopeSchema,
  chatInterruptSchema,
  chatUploadFilesSchema,
  creationReplaceSchema,
  cronjobSetStatusSchema,
  docCreateSchema,
  docCreateFolderSchema,
  docDeleteFolderSchema,
  docImportFilesSchema,
  docRenameFileSchema,
  docRenameFolderSchema,
  docUpdateSchema,
  fileOpenSchema,
  filePickForUploadSchema,
  fileSaveAsSchema,
  fileSavePastedUploadSchema,
  fileSavePngSchema,
  fileShowInFinderSchema,
  getAvailableModelsSchema,
  projectCreateSchema,
  projectUpdateSchema,
  skillContentSchema,
  skillFileContentSchema,
  skillInstallSchema,
  skillClawHubInstallSchema,
  skillLocalSourcesInstallSchema,
  skillMarkdownInstallSchema,
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
  saveWeixinChatChannelConfigSchema,
  removeWeixinAccountSchema,
  startWeixinQrLoginSchema,
  setMcpServerEnabledSchema,
  updateMcpServerSchema,
  updateCheckSchema,
  updateDebugStatusSchema,
  updateQuitAndInstallSchema,
  saveTelegramChatChannelConfigSchema,
  waitForWeixinQrLoginSchema,
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
import { err, ok } from '@shared/utils/result';
import { logger } from '../services/logger';
import { taskService } from '../services/taskService';
import { onboardingService } from '../services/onboardingService';
import { updateService } from '../services/updateService';
import { appPreviewWindowService } from '../services/appPreviewWindowService';
import { agentService } from '../services/agentService';
import { agentGroupService } from '../services/agentGroupService';
import { linkOpenService } from '../services/linkOpenService';
import { resolveLocalMediaPath } from '../services/localMediaPath';
import { settingsRuntimeService } from '../services/settingsRuntimeService';
import { weixinChannelService } from '../services/chatChannel/weixinChannelService';
import { INTERNAL_ROOT } from '../services/workspacePaths';

const UPLOAD_DIALOG_EXTENSIONS = [
  'pdf', 'docx', 'csv', 'xlsx',
  'txt', 'json', 'yaml', 'yml', 'js', 'jsx', 'ts', 'tsx', 'md', 'markdown',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif',
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus',
  'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'flv', 'wmv', 'm3u8'
];
const PASTED_UPLOADS_DIR = path.join(INTERNAL_ROOT, 'pasted-uploads');
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/pdf': '.pdf',
};

const sanitizePastedUploadFileName = (name: string, mimeType?: string): string => {
  const baseName = path.basename(name.trim()).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  const fallbackExtension = mimeType ? MIME_EXTENSION_MAP[mimeType.toLowerCase()] : undefined;
  const normalized = baseName || `pasted-file${fallbackExtension ?? ''}`;
  const withExtension = path.extname(normalized) || !fallbackExtension
    ? normalized
    : `${normalized}${fallbackExtension}`;
  if (withExtension.length <= 160) {
    return withExtension;
  }
  const extension = path.extname(withExtension);
  const nameOnly = extension ? withExtension.slice(0, -extension.length) : withExtension;
  return `${nameOnly.slice(0, 160 - extension.length)}${extension}`;
};
const translateDialogText = (
  language: import('@shared/i18n').AppLanguage,
  value: string,
): string => {
  switch (language) {
    case 'en-US':
      return ({
        '选择要发送的文件': 'Choose Files to Send',
        '保存消息图片': 'Save Message Image',
        '另存为': 'Save As',
        '保存文件': 'Save File',
        '保存': 'Save',
        '选择': 'Choose',
        'PNG 图片': 'PNG Image',
        '添加': 'Add',
        '选择技能文件或目录': 'Choose Skill File or Folder',
        '支持的文件': 'Supported Files',
        '所有文件': 'All Files',
      } as Record<string, string>)[value] ?? value;
    case 'ko-KR':
      return ({
        '选择要发送的文件': '보낼 파일 선택',
        '保存消息图片': '메시지 이미지 저장',
        '另存为': '다른 이름으로 저장',
        '保存文件': '파일 저장',
        '保存': '저장',
        '选择': '선택',
        'PNG 图片': 'PNG 이미지',
        '添加': '추가',
        '选择技能文件或目录': '스킬 파일 또는 폴더 선택',
        '支持的文件': '지원되는 파일',
        '所有文件': '모든 파일',
      } as Record<string, string>)[value] ?? value;
    case 'ja-JP':
      return ({
        '选择要发送的文件': '送信するファイルを選択',
        '保存消息图片': 'メッセージ画像を保存',
        '另存为': '名前を付けて保存',
        '保存文件': 'ファイルを保存',
        '保存': '保存',
        '选择': '選択',
        'PNG 图片': 'PNG 画像',
        '添加': '追加',
        '选择技能文件或目录': 'スキルファイルまたはフォルダーを選択',
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

const settingsReloadTargets = {
  shortcut: ['renderer', 'quickLauncherShortcut'] as const,
  agentRuntime: ['renderer', 'agentSessions'] as const,
  chatChannels: ['renderer', 'chatChannels', 'agentSessions'] as const,
  general: ['renderer', 'appPreviewWindow'] as const
};

export const registerHandlers = (): void => {
  const refreshChatChannel = async (): Promise<void> => {
    await chatChannelService.refresh();
  };

  handle('cronjob:list', z.object({}).optional(), async () => repositoryService.listCronJobs());
  handle('cronjob:listWithLastExecution', z.object({}).optional(), async () =>
    repositoryService.listCronJobsWithLastExecution()
  );
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
  handle('update:debugSetStatus', updateDebugStatusSchema, async (input) => {
    const current = updateService.getStatus();
    const latestVersion =
      input.latestVersion ??
      (input.stage === 'idle' || input.stage === 'upToDate'
        ? current.currentVersion
        : '9.9.9');
    return updateService.debugSetStatus({
      stage: input.stage,
      currentVersion: current.currentVersion,
      latestVersion:
        input.stage === 'idle' ? undefined : latestVersion,
      downloadedVersion:
        input.stage === 'downloaded' ? latestVersion : undefined,
      releaseNotes: input.releaseNotes,
      progressPercent:
        input.progressPercent ??
        (input.stage === 'downloaded'
          ? 100
          : input.stage === 'downloading'
            ? 48
            : undefined),
      message: input.message,
    });
  });

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

  handle('agentGroup:list', z.object({}).optional(), async () =>
    agentGroupService.listGroups()
  );

  handle('agentGroup:create', agentGroupCreateSchema, async (input) =>
    agentGroupService.createGroup(input)
  );

  handle('agentGroup:update', agentGroupUpdateSchema, async (input) =>
    agentGroupService.updateGroup(input)
  );

  handle('agentGroup:delete', z.object({ id: z.string().min(1) }), async (input) => {
    await agentGroupService.deleteGroup(input.id);
    return true;
  });

  handle('agentGroup:addMembers', agentGroupMembersSchema, async (input) =>
    agentGroupService.addMembers(input)
  );

  handle('agentGroup:removeMember', agentGroupMembersSchema, async (input) =>
    agentGroupService.removeMember(input)
  );

  handle('agentGroupMessage:list', agentGroupMessageListSchema, async (input) =>
    agentGroupService.listMessages(input)
  );

  handle('agentGroupMessage:getTypingState', z.object({ groupId: z.string().min(1) }), async (input) =>
    agentGroupService.getTypingState(input.groupId)
  );

  handle('agentGroupMessage:sendUserMessage', agentGroupUserMessageSendSchema, async (input) =>
    agentGroupService.sendUserMessage(input)
  );

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
  handle('docs:importFiles', docImportFilesSchema, async (input) =>
    repositoryService.importDocumentFiles(input)
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
  handle('app:saveBuildToDocs', z.object({ projectId: z.string() }), async (input) =>
    repositoryService.saveAppBuildToDocument(input.projectId)
  );

  handle('creation:getBoard', z.object({ projectId: z.string() }), async (input) =>
    repositoryService.getCreationBoard(input.projectId)
  );

  handle('creation:replaceBoard', creationReplaceSchema, async (input) =>
    repositoryService.replaceCreationBoard(input.projectId, input.scenes)
  );

  handle('chat:createSession', sessionCreateSchema, async (input) => repositoryService.createChatSession(input));
  handle(
    'chat:getDigitalAvatarSession',
    z.object({ scope: chatScopeSchema }),
    async (input) => repositoryService.getOrCreateDigitalAvatarSession(input.scope)
  );
  handle(
    'chat:getSessions',
    chatListSessionsSchema,
    async (input) =>
      repositoryService.listChatSessions(input.scope, {
        kinds: input.kinds,
        includeHidden: input.includeHidden,
      })
  );
  handle('chat:getMessages', z.object({ scope: chatScopeSchema, sessionId: z.string() }), async (input) =>
    repositoryService.listMessages(input.scope, input.sessionId)
  );
  ipcMain.handle('chat:sendMessage', async (_event, payload) => {
    try {
      const input = chatSendSchema.parse(payload);
      const result = await chatService.sendFromRenderer(input);
      return ok(result);
    } catch (error) {
      logger.error('IPC failed: chat:sendMessage', error);
      if (error instanceof Error && error.name === 'ZodError') {
        return err('VALIDATION_ERROR', '输入校验失败，请检查填写内容', error.message);
      }
      return err('UNKNOWN_ERROR', error instanceof Error ? error.message : 'unknown error');
    }
  });
  handle('chat:queueMessage', chatQueueSchema, async (input) =>
    chatService.queueMessage(input)
  );
  handle('chat:getQueuedMessages', chatQueuedMessagesSchema, async (input) =>
    chatService.getQueuedMessages(input.scope, input.sessionId)
  );
  handle('chat:interrupt', chatInterruptSchema, async (input) =>
    chatService.interrupt(input)
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
  handle('file:savePastedUpload', fileSavePastedUploadSchema, async (input) => {
    await fs.mkdir(PASTED_UPLOADS_DIR, { recursive: true });
    const safeName = sanitizePastedUploadFileName(input.name, input.mimeType);
    const targetPath = path.join(PASTED_UPLOADS_DIR, `${Date.now()}-${randomUUID()}-${safeName}`);
    const buffer = Buffer.from(input.dataBase64, 'base64');
    await fs.writeFile(targetPath, buffer);
    return {
      name: safeName,
      sourcePath: targetPath,
      mimeType: input.mimeType,
      size: buffer.byteLength
    };
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
  handle('file:saveAs', fileSaveAsSchema, async (input) => {
    const targetPath = resolveFileTargetPath(input);
    await fs.access(targetPath);
    const language = (await settingsService.getGeneralConfig()).language;
    const result = await dialog.showSaveDialog({
      title: translateDialogText(language, '另存为'),
      buttonLabel: translateDialogText(language, '保存'),
      defaultPath: input.defaultFileName ?? path.basename(targetPath),
      filters: [
        { name: translateDialogText(language, '保存文件'), extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    if (path.resolve(result.filePath) !== path.resolve(targetPath)) {
      await fs.copyFile(targetPath, result.filePath);
    }
    return result.filePath;
  });
  handle('file:savePng', fileSavePngSchema, async (input) => {
    const language = (await settingsService.getGeneralConfig()).language;
    const result = await dialog.showSaveDialog({
      title: translateDialogText(language, '保存消息图片'),
      buttonLabel: translateDialogText(language, '保存'),
      defaultPath: input.defaultFileName,
      filters: [
        {
          name: translateDialogText(language, 'PNG 图片'),
          extensions: ['png'],
        },
      ],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }

    const base64 = input.dataUrl.replace(/^data:image\/png;base64,/, '');
    await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'));
    return result.filePath;
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
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.shortcut]
    });
    return true;
  });
  handle('settings:getClaudeSecret', z.object({ provider: z.string().min(1) }), async (input) =>
    settingsService.getClaudeSecret(input.provider)
  );
  handle('settings:setClaudeConfigStatus', z.object({ configured: z.boolean() }), async () => true);
  handle('settings:saveClaudeApiKey', saveApiKeySchema, async (input) => {
    await settingsService.saveClaudeConfig({
      provider: input.provider,
      displayName: input.displayName,
      enabled: input.enabled,
      secret: input.secret,
      baseUrl: input.baseUrl,
      api: input.api,
      customModels: input.customModels,
      enabledModels: input.enabledModels
    });
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.agentRuntime]
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
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.agentRuntime]
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
      ownerUserIds: input.ownerUserIds
    });
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.chatChannels]
    });
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
      ownerUserIds: input.ownerUserIds,
      serverIds: input.serverIds,
      channelIds: input.channelIds
    });
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.chatChannels]
    });
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
      appSecret: input.appSecret,
      ownerUserIds: input.ownerUserIds
    });
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.chatChannels]
    });
    return true;
  });
  handle('settings:getWeixinChatChannelStatus', z.object({}).optional(), async () =>
    weixinChannelService.getStatus()
  );
  handle('settings:saveWeixinChatChannelConfig', saveWeixinChatChannelConfigSchema, async (input) => {
    await settingsService.saveWeixinChatChannelConfig({
      enabled: input.enabled,
      accountId: input.accountId
    });
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.chatChannels]
    });
    return true;
  });
  handle('settings:startWeixinQrLogin', startWeixinQrLoginSchema, async (input) =>
    weixinChannelService.startQrLogin({
      forceRefresh: input?.forceRefresh
    })
  );
  handle('settings:waitForWeixinQrLogin', waitForWeixinQrLoginSchema, async (input) => {
    const result = await weixinChannelService.waitForQrLogin({
      sessionKey: input.sessionKey,
      timeoutMs: input.timeoutMs
    });
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.chatChannels]
    });
    return result;
  });
  handle('settings:removeWeixinAccount', removeWeixinAccountSchema, async (input) => {
    await weixinChannelService.removeAccount({
      accountId: input.accountId
    });
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.chatChannels]
    });
    return true;
  });
  handle('settings:getBroadcastChannels', z.object({}).optional(), async () =>
    settingsService.getBroadcastChannels()
  );
  handle('settings:saveBroadcastChannelsConfig', saveBroadcastChannelConfigSchema, async (input) => {
    const result = await settingsService.saveBroadcastChannelsConfig({
      channels: input.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        webhook: channel.webhook
      }))
    });
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.chatChannels]
    });
    return result;
  });
  handle('settings:getMcpServers', z.object({}).optional(), async () =>
    settingsService.getMcpServers()
  );
  handle('settings:addMcpServer', addMcpServerSchema, async (input) => {
    const result = await settingsService.addMcpServer(input);
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.agentRuntime]
    });
    return result;
  });
  handle('settings:updateMcpServer', updateMcpServerSchema, async (input) => {
    const result = await settingsService.updateMcpServer(input);
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.agentRuntime]
    });
    return result;
  });
  handle('settings:setMcpServerEnabled', setMcpServerEnabledSchema, async (input) => {
    const result = await settingsService.setMcpServerEnabled(input);
    await settingsRuntimeService.reload({
      targets: [...settingsReloadTargets.agentRuntime]
    });
    return result;
  });

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
        themeMode: input.themeMode,
        linkOpenMode: input.linkOpenMode,
        mainSubModeEnabled: true,
        quickGuideDismissed: input.quickGuideDismissed,
        chatInputShortcutTipDismissed: input.chatInputShortcutTipDismissed,
        showHiddenSessions: input.showHiddenSessions
      });
      await settingsRuntimeService.reload({
        targets: [...settingsReloadTargets.general]
      });
      return true;
    }
  );

  handle('skills:getConfig', z.object({}).optional(), async () => skillService.getConfig());
  handle('skills:addRepository', skillRepositorySchema, async (input) =>
    skillService.addRepository({ repositoryUrl: input.repositoryUrl })
  );
  handle('skills:listInstalled', z.object({}).optional(), async () => skillService.listInstalledSkills());
  handle('skills:getContent', skillContentSchema, async (input) =>
    skillService.getInstalledSkillContent({ skillId: input.skillId })
  );
  handle('skills:getFileContent', skillFileContentSchema, async (input) =>
    skillService.getInstalledSkillFileContent({
      skillId: input.skillId,
      filePath: input.path
    })
  );
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
  handle('skills:pickLocalSources', z.object({}).optional(), async () => {
    const language = (await settingsService.getGeneralConfig()).language;
    const result = await dialog.showOpenDialog({
      title: translateDialogText(language, '选择技能文件或目录'),
      buttonLabel: translateDialogText(language, '选择'),
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        {
          name: 'SKILL.md',
          extensions: ['md'],
        },
        { name: translateDialogText(language, '所有文件'), extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return Array.from(
      new Set(result.filePaths.map((filePath) => path.resolve(filePath))),
    );
  });
  handle(
    'skills:installLocalSources',
    skillLocalSourcesInstallSchema,
    async (input) => {
      const skills = await skillService.installLocalSkillSources({
        sourcePaths: input.sourcePaths
      });
      agentService.clearAllSessions();
      return skills;
    }
  );
  handle(
    'skills:installFromMarkdown',
    skillMarkdownInstallSchema,
    async (input) => {
      const skill = await skillService.installSkillFromMarkdown({
        markdown: input.markdown
      });
      agentService.clearAllSessions();
      return skill;
    }
  );
  handle(
    'skills:installFromClawHub',
    skillClawHubInstallSchema,
    async (input) => {
      const skills = await skillService.installClawHubSkill({
        input: input.input
      });
      agentService.clearAllSessions();
      return skills;
    }
  );
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
