import { BrowserWindow } from 'electron';
import type { AppLanguage } from '@shared/i18n';
import type { AppType, OpenAppPreviewWindowPayload } from '@shared/types';
import { repositoryService } from './repositoryService';
import { logger } from './logger';
import { settingsService } from './settingsService';

const LOCAL_MEDIA_SCHEME_PREFIX = 'kian-local://local/';
const APP_PREVIEW_PARTITION = 'kian-app-preview';

const APP_TYPE_TITLES: Record<AppLanguage, Record<AppType, string>> = {
  'zh-CN': {
    react: 'React 应用',
    vue: 'Vue 应用',
    svelte: 'Svelte 应用',
    nextjs: 'Next.js 应用',
    nuxt: 'Nuxt 应用',
    angular: 'Angular 应用',
    vanilla: 'Web 应用',
    unknown: '应用',
  },
  'en-US': {
    react: 'React App',
    vue: 'Vue App',
    svelte: 'Svelte App',
    nextjs: 'Next.js App',
    nuxt: 'Nuxt App',
    angular: 'Angular App',
    vanilla: 'Web App',
    unknown: 'App',
  },
  'ko-KR': {
    react: 'React 앱',
    vue: 'Vue 앱',
    svelte: 'Svelte 앱',
    nextjs: 'Next.js 앱',
    nuxt: 'Nuxt 앱',
    angular: 'Angular 앱',
    vanilla: '웹 앱',
    unknown: '앱',
  },
  'ja-JP': {
    react: 'React アプリ',
    vue: 'Vue アプリ',
    svelte: 'Svelte アプリ',
    nextjs: 'Next.js アプリ',
    nuxt: 'Nuxt アプリ',
    angular: 'Angular アプリ',
    vanilla: 'Web アプリ',
    unknown: 'アプリ',
  },
};

interface PreviewWindowState {
  window: BrowserWindow;
  projectId: string;
}

let state: PreviewWindowState | null = null;

const toLocalMediaUrl = (rawPath: string): string =>
  `${LOCAL_MEDIA_SCHEME_PREFIX}${encodeURIComponent(rawPath)}`;

const buildPreviewUrl = (
  distIndexPath: string,
  builtAt: string,
  cacheVersion: number,
  projectId?: string,
): string => {
  const base = toLocalMediaUrl(distIndexPath);
  const stamp = encodeURIComponent(builtAt);
  let url = `${base}?t=${stamp}&v=${cacheVersion}`;
  if (projectId) {
    url += `&projectId=${encodeURIComponent(projectId)}`;
  }
  return url;
};

const resolvePreviewTitle = (input: {
  appName?: string;
  appType?: AppType;
  language: AppLanguage;
}): string => {
  const appName = input.appName?.trim();
  if (appName) {
    return input.language === 'en-US'
      ? `${appName} · App Preview`
      : input.language === 'ko-KR'
        ? `${appName} · 앱 미리보기`
        : input.language === 'ja-JP'
          ? `${appName} · アプリプレビュー`
          : `${appName} · 应用预览`;
  }
  const typeTitle = APP_TYPE_TITLES[input.language][input.appType ?? 'unknown'];
  return input.language === 'en-US'
    ? `${typeTitle} · App Preview`
    : input.language === 'ko-KR'
      ? `${typeTitle} · 앱 미리보기`
      : input.language === 'ja-JP'
        ? `${typeTitle} · アプリプレビュー`
        : `${typeTitle} · 应用预览`;
};

const ensurePreviewWindow = (): BrowserWindow => {
  if (state && !state.window.isDestroyed()) {
    return state.window;
  }

  const previewWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'App Preview',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      partition: APP_PREVIEW_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  previewWindow.on('closed', () => {
    if (state?.window === previewWindow) {
      state = null;
    }
  });

  state = { window: previewWindow, projectId: '' };
  return previewWindow;
};

const loadPreviewUrl = async (
  previewWindow: BrowserWindow,
  previewUrl: string,
): Promise<void> => {
  if (previewWindow.webContents.getURL() === previewUrl) {
    previewWindow.webContents.reloadIgnoringCache();
    return;
  }
  await previewWindow.loadURL(previewUrl);
};

export const appPreviewWindowService = {
  async open(payload: OpenAppPreviewWindowPayload): Promise<boolean> {
    const language = (await settingsService.getGeneralConfig()).language;
    const previewWindow = ensurePreviewWindow();
    const previewUrl = buildPreviewUrl(
      payload.distIndexPath,
      payload.builtAt,
      Date.now(),
      payload.projectId,
    );
    const title = resolvePreviewTitle({
      appName: payload.appName,
      appType: payload.appType,
      language,
    });

    await loadPreviewUrl(previewWindow, previewUrl);
    previewWindow.setTitle(title);
    previewWindow.show();
    previewWindow.focus();

    state = {
      window: previewWindow,
      projectId: payload.projectId
    };
    return true;
  },

  async refreshForProject(projectId: string): Promise<void> {
    if (!state || state.projectId !== projectId) return;
    if (state.window.isDestroyed()) {
      state = null;
      return;
    }

    try {
      const language = (await settingsService.getGeneralConfig()).language;
      const status = await repositoryService.getAppWorkspaceStatus(projectId);
      if (!status.hasBuild || !status.distIndexPath || !status.builtAt) {
        return;
      }

      const previewUrl = buildPreviewUrl(
        status.distIndexPath,
        status.builtAt,
        Date.now(),
        projectId,
      );
      const title = resolvePreviewTitle({
        appName: status.appName,
        appType: status.appType ?? 'unknown',
        language,
      });

      await loadPreviewUrl(state.window, previewUrl);
      state.window.setTitle(title);
    } catch (error) {
      logger.warn(
        `Failed to refresh global app preview window for project ${projectId}`,
        error,
      );
    }
  }
};
