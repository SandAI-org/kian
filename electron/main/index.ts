import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  session,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions
} from 'electron';
import type { AppLanguage } from '@shared/i18n';
import {
  DEFAULT_SHORTCUT_CONFIG,
  keyboardShortcutToElectronAccelerator
} from '@shared/utils/shortcuts';
import fixPathImport from 'fix-path';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHandlers } from './ipc/registerHandlers';
import { chatChannelService } from './services/chatChannelService';
import { chatEvents } from './services/chatEvents';
import { appOperationEvents } from './services/appOperationEvents';
import { cronjobService } from './services/cronjobService';
import { logger } from './services/logger';
import { skillService } from './services/skillService';
import { taskService } from './services/taskService';
import { taskSupervisorService } from './services/taskSupervisorService';
import { resolveLocalMediaPath } from './services/localMediaPath';
import { updateEvents } from './services/updateEvents';
import { updateService } from './services/updateService';
import {
  APP_PREVIEW_PARTITION,
  appPreviewWindowService
} from './services/appPreviewWindowService';
import {
  APP_WEB_SDK_SAVE_FILE_PATH,
  injectAppWebSdkIntoHtml,
  shouldInjectAppWebSdk
} from './services/appWebSdk';
import { repositoryService } from './services/repositoryService';
import { registerAppPreviewPermissionService } from './services/appPreviewPermissionService';
import { linkOpenService } from './services/linkOpenService';
import { settingsService } from './services/settingsService';

const APP_DISPLAY_NAME = 'Kian';
const LOCAL_MEDIA_SCHEME = 'kian-local';
const FOCUS_MAIN_AGENT_SHORTCUT_CHANNEL = 'window:focus-main-agent-shortcut';
const OPEN_MAIN_AGENT_SESSION_CHANNEL = 'window:open-main-agent-session';
const QUICK_LAUNCHER_ROUTE = '/quick-launcher';
const QUICK_LAUNCHER_WIDTH = 520;
const QUICK_LAUNCHER_MIN_HEIGHT = 132;
const DEFAULT_QUICK_LAUNCHER_ACCELERATOR =
  keyboardShortcutToElectronAccelerator(
    DEFAULT_SHORTCUT_CONFIG.quickLauncher,
    process.platform,
    { preferCommandOrControl: true }
  ) ?? 'CommandOrControl+Shift+K';
const resolvedFixPath =
  typeof fixPathImport === 'function'
    ? fixPathImport
    : (fixPathImport as unknown as { default?: (() => void) | undefined }).default;

// Align PATH with the user's shell environment for GUI launches on Unix-like systems.
resolvedFixPath?.();

app.setName(APP_DISPLAY_NAME);

let quitConfirmed = false;
let quitInProgress = false;
let mainWindow: BrowserWindow | null = null;
let quickLauncherWindow: BrowserWindow | null = null;
let suppressMainWindowActivationUntil = 0;
let quickLauncherShouldHideAppOnClose = false;
let registeredQuickLauncherAccelerator: string | null = null;

const NATIVE_TRANSLATIONS: Record<AppLanguage, Record<string, string>> = {
  'zh-CN': {},
  'en-US': {
    '编辑': 'Edit',
    '视图': 'View',
    '窗口': 'Window',
    '取消': 'Cancel',
    '退出并停止任务': 'Quit and Stop Tasks',
    '确认退出 Kian': 'Quit Kian?',
    '知道了': 'OK',
    '退出失败': 'Quit Failed',
    '停止运行中的任务失败，已取消退出。':
      'Failed to stop running tasks. Quit was canceled.',
    '界面加载失败': 'Interface Failed to Load',
    '开发环境页面加载失败': 'Failed to load development page',
    '应用页面加载失败': 'Failed to load app page',
    '选择要发送的文件': 'Choose Files to Send',
    '添加': 'Add',
    '支持的文件': 'Supported Files',
    '所有文件': 'All Files',
    '应用界面加载失败。请把下面的错误信息反馈给开发者，便于定位 Windows 启动白屏问题。':
      'The app UI failed to load. Please send the error details below to the developers so they can diagnose the Windows white-screen issue.',
    '退出后会立即停止这些任务及其子进程。':
      'Quitting will immediately stop these tasks and their child processes.',
  },
  'ko-KR': {
    '编辑': '편집',
    '视图': '보기',
    '窗口': '창',
    '取消': '취소',
    '退出并停止任务': '종료 후 작업 중지',
    '确认退出 Kian': 'Kian을 종료할까요?',
    '知道了': '확인',
    '退出失败': '종료 실패',
    '停止运行中的任务失败，已取消退出。':
      '실행 중인 작업을 중지하지 못해 종료를 취소했습니다.',
    '界面加载失败': '화면을 불러오지 못했습니다',
    '开发环境页面加载失败': '개발 환경 페이지를 불러오지 못했습니다',
    '应用页面加载失败': '앱 페이지를 불러오지 못했습니다',
    '选择要发送的文件': '보낼 파일 선택',
    '添加': '추가',
    '支持的文件': '지원되는 파일',
    '所有文件': '모든 파일',
    '应用界面加载失败。请把下面的错误信息反馈给开发者，便于定位 Windows 启动白屏问题。':
      '앱 화면을 불러오지 못했습니다. 아래 오류 정보를 개발자에게 전달해 Windows 흰 화면 문제를 확인할 수 있게 해주세요.',
    '退出后会立即停止这些任务及其子进程。':
      '종료하면 이 작업들과 하위 프로세스가 즉시 중지됩니다.',
  },
  'ja-JP': {
    '编辑': '編集',
    '视图': '表示',
    '窗口': 'ウィンドウ',
    '取消': 'キャンセル',
    '退出并停止任务': '終了してタスクを停止',
    '确认退出 Kian': 'Kian を終了しますか？',
    '知道了': '了解',
    '退出失败': '終了に失敗しました',
    '停止运行中的任务失败，已取消退出。':
      '実行中のタスクを停止できなかったため、終了を取り消しました。',
    '界面加载失败': '画面の読み込みに失敗しました',
    '开发环境页面加载失败': '開発環境ページの読み込みに失敗しました',
    '应用页面加载失败': 'アプリページの読み込みに失敗しました',
    '选择要发送的文件': '送信するファイルを選択',
    '添加': '追加',
    '支持的文件': '対応ファイル',
    '所有文件': 'すべてのファイル',
    '应用界面加载失败。请把下面的错误信息反馈给开发者，便于定位 Windows 启动白屏问题。':
      'アプリ画面の読み込みに失敗しました。Windows の白画面問題を調査できるよう、以下のエラー情報を開発者へ共有してください。',
    '退出后会立即停止这些任务及其子进程。':
      '終了すると、これらのタスクと子プロセスはただちに停止します。',
  },
};

const getAppLanguage = async (): Promise<AppLanguage> => {
  try {
    return (await settingsService.getGeneralConfig()).language;
  } catch {
    return 'zh-CN';
  }
};

const translateNativeText = (language: AppLanguage, value: string): string =>
  NATIVE_TRANSLATIONS[language][value] ?? value;

const resolveAppIconPath = (): string | undefined => {
  const candidates = [
    path.join(process.resourcesPath, 'icons', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icons', 'icon.png'),
    path.join(app.getAppPath(), 'src', 'renderer', 'assets', 'kian-logo.png'),
    path.join(__dirname, '../../build/icons/icon.png'),
    path.join(__dirname, '../../src/renderer/assets/kian-logo.png')
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
};

const loadAppIconImage = () => {
  const iconPath = resolveAppIconPath();
  if (!iconPath) return undefined;
  const iconImage = nativeImage.createFromPath(iconPath);
  if (iconImage.isEmpty()) return undefined;
  return iconImage;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildWindowLoadFailureHtml = (
  input: { title: string; details: string },
  language: AppLanguage,
): string => `<!doctype html>
<html lang="${escapeHtml(language)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(APP_DISPLAY_NAME)}</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: "Segoe UI", "PingFang SC", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(47, 111, 247, 0.12), transparent 34%),
          radial-gradient(circle at bottom right, rgba(15, 23, 42, 0.08), transparent 30%),
          #eef2f7;
        color: #0f172a;
      }
      main {
        width: min(720px, 100%);
        border: 1px solid #d7e1f1;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.96);
        padding: 28px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 24px;
      }
      p {
        margin: 0;
        line-height: 1.6;
        color: #475569;
      }
      pre {
        margin: 18px 0 0;
        padding: 16px;
        overflow: auto;
        border-radius: 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        color: #0f172a;
        font-family: "SFMono-Regular", "Cascadia Code", "Consolas", monospace;
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(translateNativeText(language, '应用界面加载失败。请把下面的错误信息反馈给开发者，便于定位 Windows 启动白屏问题。'))}</p>
      <pre>${escapeHtml(input.details)}</pre>
    </main>
  </body>
</html>`;

const buildMainWindowOptions = (
  icon: Electron.NativeImage | undefined
): BrowserWindowConstructorOptions => {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  return {
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    frame: false,
    ...(isMac
      ? {
          titleBarStyle: 'hidden' as const
        }
      : isWindows
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: {
              color: '#eef2f7',
              symbolColor: '#0f172a',
              height: 44
            }
          }
        : {}),
    autoHideMenuBar: !isMac,
    title: APP_DISPLAY_NAME,
    icon,
    show: false,
    backgroundColor: '#eef2f7',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true
    }
  };
};

const buildQuickLauncherWindowOptions = (
  icon: Electron.NativeImage | undefined
): BrowserWindowConstructorOptions => {
  return {
    width: QUICK_LAUNCHER_WIDTH,
    height: QUICK_LAUNCHER_MIN_HEIGHT,
    minWidth: QUICK_LAUNCHER_WIDTH,
    minHeight: QUICK_LAUNCHER_MIN_HEIGHT,
    useContentSize: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: `${APP_DISPLAY_NAME} Quick Launcher`,
    icon,
    show: false,
    backgroundColor: '#eef2f7',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  };
};

const buildRendererRouteUrl = (route: string): string => {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!rendererUrl) {
    throw new Error('Renderer URL is only available in development.');
  }
  return `${rendererUrl.replace(/#.*$/, '')}#${route}`;
};

const showWindowLoadFailure = async (
  win: BrowserWindow,
  input: { title: string; details: string }
): Promise<void> => {
  const html = buildWindowLoadFailureHtml(input, await getAppLanguage());
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  if (!win.isVisible()) {
    win.show();
  }
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

const handleSaveFileToAssets = async (request: Request, parsed: URL): Promise<Response> => {
  const projectId = parsed.searchParams.get('projectId')?.trim();
  const fileName = parsed.searchParams.get('fileName')?.trim();
  if (!projectId || !fileName) {
    return new Response('Missing projectId or fileName', { status: 400 });
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length === 0) {
    return new Response('Empty file data', { status: 400 });
  }

  const asset = await repositoryService.saveFileToAssets({
    projectId,
    fileName,
    data: buffer
  });
  return new Response(JSON.stringify(asset), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

const registerLocalMediaProtocol = (): void => {
  const handler = async (request: Request): Promise<Response> => {
    try {
      const parsed = new URL(request.url);
      if (parsed.hostname !== 'local') {
        return new Response('Not Found', { status: 404 });
      }

      const encodedPath = parsed.pathname.replace(/^\/+/, '');
      if (!encodedPath) {
        return new Response('Bad Request', { status: 400 });
      }

      if (request.method === 'POST' && encodedPath === APP_WEB_SDK_SAVE_FILE_PATH) {
        return handleSaveFileToAssets(request, parsed);
      }

      const projectId = parsed.searchParams.get('projectId')?.trim() || undefined;
      const documentPath = parsed.searchParams.get('documentPath')?.trim() || undefined;
      const resolvedPath = resolveLocalMediaPath(encodedPath, {
        projectId,
        documentPath,
      });
      if (!resolvedPath) {
        return new Response('Bad Request', { status: 400 });
      }

      if (shouldInjectAppWebSdk(resolvedPath)) {
        const html = await fs.promises.readFile(resolvedPath, 'utf8');
        const htmlWithSdk = injectAppWebSdkIntoHtml(html, projectId);
        return new Response(htmlWithSdk, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      }

      const fileUrl = pathToFileURL(resolvedPath).toString();
      return net.fetch(fileUrl, { headers: request.headers });
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
  };

  const targetSessions = Array.from(
    new Set(
      [session.defaultSession, session.fromPartition(APP_PREVIEW_PARTITION)].filter(
        (value): value is Electron.Session => Boolean(value),
      ),
    ),
  );

  for (const targetSession of targetSessions) {
    targetSession.protocol.handle(LOCAL_MEDIA_SCHEME, handler);
  }
};

const createApplicationMenu = async (): Promise<void> => {
  const isMac = process.platform === 'darwin';
  const language = await getAppLanguage();
  const template: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: APP_DISPLAY_NAME,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        {
          label: translateNativeText(language, '编辑'),
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
          ]
        },
        {
          label: translateNativeText(language, '视图'),
          submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
          ]
        },
        {
          label: translateNativeText(language, '窗口'),
          submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        }
      ]
    : [
        {
          label:
            language === 'zh-CN'
              ? '文件'
              : language === 'ko-KR'
                ? '파일'
                : language === 'ja-JP'
                  ? 'ファイル'
                  : 'File',
          submenu: [{ role: 'quit' }],
        },
        {
          label:
            language === 'ko-KR'
              ? '편집'
              : language === 'ja-JP'
                ? '編集'
                : language === 'zh-CN'
                  ? '编辑'
                  : 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
          ]
        },
        {
          label:
            language === 'ko-KR'
              ? '보기'
              : language === 'ja-JP'
                ? '表示'
                : language === 'zh-CN'
                  ? '视图'
                  : 'View',
          submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
          ]
        },
        {
          label:
            language === 'ko-KR'
              ? '창'
              : language === 'ja-JP'
                ? 'ウィンドウ'
                : language === 'zh-CN'
                  ? '窗口'
                  : 'Window',
          submenu: [{ role: 'minimize' }, { role: 'close' }],
        }
      ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const getQuitDialogWindow = (
  preferredWindow?: BrowserWindow | null
): BrowserWindow | undefined => {
  if (preferredWindow && !preferredWindow.isDestroyed()) {
    return preferredWindow;
  }

  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
};

const showAppDialog = async (
  options: Electron.MessageBoxOptions,
  preferredWindow?: BrowserWindow | null
) => {
  const dialogWindow = getQuitDialogWindow(preferredWindow);
  if (dialogWindow) {
    return dialog.showMessageBox(dialogWindow, options);
  }
  return dialog.showMessageBox(options);
};

const buildRunningTasksDetail = (
  taskNames: string[],
  language: AppLanguage,
): string => {
  const preview = taskNames.slice(0, 5).map((name) => `• ${name}`);
  const extraCount = taskNames.length - preview.length;
  if (extraCount > 0) {
    preview.push(
      language === 'en-US'
        ? `• and ${extraCount} more tasks`
        : language === 'ko-KR'
          ? `• 그 외 ${extraCount}개의 작업`
          : language === 'ja-JP'
            ? `• ほかに ${extraCount} 件のタスク`
            : `• 以及另外 ${extraCount} 个任务`,
    );
  }
  preview.push('', translateNativeText(language, '退出后会立即停止这些任务及其子进程。'));
  return preview.join('\n');
};

const parseNavigationUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

const shouldDelegateExternalNavigation = (
  targetUrl: string,
  currentUrl: string
): boolean => {
  const parsedTargetUrl = parseNavigationUrl(targetUrl);
  if (!parsedTargetUrl) {
    return false;
  }

  if (parsedTargetUrl.protocol !== 'http:' && parsedTargetUrl.protocol !== 'https:') {
    return false;
  }

  const parsedCurrentUrl = parseNavigationUrl(currentUrl);
  if (!parsedCurrentUrl) {
    return true;
  }

  if (
    (parsedCurrentUrl.protocol === 'http:' || parsedCurrentUrl.protocol === 'https:') &&
    parsedCurrentUrl.origin === parsedTargetUrl.origin
  ) {
    return false;
  }

  return true;
};

const registerExternalNavigationHandlers = (
  contents: Electron.WebContents,
): void => {
  contents.setWindowOpenHandler(({ url }) => {
    if (shouldDelegateExternalNavigation(url, contents.getURL())) {
      void linkOpenService.open(url);
      return { action: 'deny' };
    }

    return { action: 'allow' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!shouldDelegateExternalNavigation(url, contents.getURL())) {
      return;
    }

    event.preventDefault();
    void linkOpenService.open(url);
  });
};

const registerAppPreviewWebviewHandlers = (
  win: BrowserWindow,
): void => {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = typeof params.src === 'string' ? params.src : '';
    const parsedSrc = parseNavigationUrl(src);
    const isLocalPreview =
      parsedSrc?.protocol === `${LOCAL_MEDIA_SCHEME}:` &&
      parsedSrc.hostname === 'local';
    if (!isLocalPreview) {
      event.preventDefault();
      return;
    }

    if (params.partition !== APP_PREVIEW_PARTITION) {
      params.partition = APP_PREVIEW_PARTITION;
    }

    delete webPreferences.preload;
    delete params.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });

  win.webContents.on('did-attach-webview', (_event, guestContents) => {
    registerExternalNavigationHandlers(guestContents);

    guestContents.on('render-process-gone', (_guestEvent, details) => {
      logger.warn('App preview webview renderer exited unexpectedly', details);
    });

    guestContents.on('unresponsive', () => {
      logger.warn('App preview webview became unresponsive');
    });
  });
};

const focusWindow = (window: BrowserWindow): void => {
  if (window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }
  window.focus();
};

const focusQuickLauncherWindow = (): void => {
  const win = ensureQuickLauncherWindow();
  if (mainWindow && !mainWindow.isDestroyed() && quickLauncherShouldHideAppOnClose) {
    mainWindow.hide();
  }
  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }
  win.focus();
};

const hideQuickLauncherWindow = (window: BrowserWindow): boolean => {
  if (window.isDestroyed()) {
    return false;
  }

  suppressMainWindowActivationUntil = Date.now() + 1000;
  if (window.isVisible()) {
    window.hide();
  }

  if (process.platform === 'darwin' && quickLauncherShouldHideAppOnClose) {
    app.hide();
    return true;
  }

  return true;
};

const dismissQuickLauncherWindow = (window: BrowserWindow): boolean => {
  if (window.isDestroyed()) {
    return false;
  }

  suppressMainWindowActivationUntil = Date.now() + 1000;
  if (window.isVisible()) {
    window.hide();
  }

  return true;
};

const loadRendererRoute = async (
  window: BrowserWindow,
  route: string
): Promise<void> => {
  if (process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(buildRendererRouteUrl(route));
    return;
  }

  const rendererPath = path.join(__dirname, '../renderer/index.html');
  await window.loadFile(rendererPath, { hash: route });
};

const sendToMainWindow = (channel: string, payload?: string): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (payload === undefined) {
    mainWindow.webContents.send(channel);
    return;
  }
  mainWindow.webContents.send(channel, payload);
};

const stopBackgroundServices = (): void => {
  cronjobService.stop();
  chatChannelService.stop();
  updateService.stop();
};

const requestApplicationQuit = async (preferredWindow?: BrowserWindow | null): Promise<void> => {
  if (quitConfirmed || quitInProgress) {
    return;
  }

  quitInProgress = true;
  try {
    const language = await getAppLanguage();
    const runningTasks = await taskService.listActiveTasks();
    if (runningTasks.length > 0) {
      const result = await showAppDialog({
        type: 'warning',
        buttons: [
          translateNativeText(language, '退出并停止任务'),
          translateNativeText(language, '取消'),
        ],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: translateNativeText(language, '确认退出 Kian'),
        message:
          language === 'en-US'
            ? `${runningTasks.length} tasks are still running`
            : language === 'ko-KR'
              ? `현재 ${runningTasks.length}개의 작업이 실행 중입니다`
              : language === 'ja-JP'
                ? `現在 ${runningTasks.length} 件のタスクが実行中です`
                : `当前有 ${runningTasks.length} 个任务仍在运行`,
        detail: buildRunningTasksDetail(
          runningTasks.map((task) => task.name),
          language,
        )
      }, preferredWindow);

      if (result.response !== 0) {
        return;
      }
    }

    taskSupervisorService.stop();
    await taskService.shutdownRunningTasks();
    stopBackgroundServices();
    quitConfirmed = true;
    app.quit();
  } catch (error) {
    taskSupervisorService.start();
    logger.error('Failed to shut down running tasks before quit', error);
    const language = await getAppLanguage();
    await showAppDialog({
      type: 'error',
      buttons: [translateNativeText(language, '知道了')],
      defaultId: 0,
      noLink: true,
      title: translateNativeText(language, '退出失败'),
      message: translateNativeText(language, '停止运行中的任务失败，已取消退出。'),
      detail: error instanceof Error ? error.message : String(error)
    }, preferredWindow);
  } finally {
    quitInProgress = false;
  }
};

const createMainWindow = (): BrowserWindow => {
  const appIconImage = loadAppIconImage();
  const win = new BrowserWindow(buildMainWindowOptions(appIconImage));
  let displayedFallback = false;
  mainWindow = win;

  win.on('close', (event) => {
    if (quitConfirmed || process.platform === 'darwin') {
      return;
    }

    event.preventDefault();
    void requestApplicationQuit(win);
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  registerExternalNavigationHandlers(win.webContents);
  registerAppPreviewWebviewHandlers(win);

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || displayedFallback || win.isDestroyed()) return;
    displayedFallback = true;
    logger.error('Main window failed to load', {
      errorCode,
      errorDescription,
      validatedURL
    });
    void (async () => {
      const language = await getAppLanguage();
      await showWindowLoadFailure(win, {
        title: translateNativeText(language, '界面加载失败'),
        details: [
          `errorCode: ${errorCode}`,
          `errorDescription: ${errorDescription}`,
          `url: ${validatedURL || 'unknown'}`
        ].join('\n')
      });
    })().catch((error) => {
      logger.error('Failed to show window load fallback', error);
    });
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('Renderer process exited unexpectedly', details);
  });

  if (process.platform === 'darwin') {
    win.webContents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        input.meta &&
        !input.control &&
        !input.alt &&
        !input.shift &&
        input.code === 'KeyH'
      ) {
        event.preventDefault();
        win.webContents.send(FOCUS_MAIN_AGENT_SHORTCUT_CHANNEL);
      }
    });
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    void loadRendererRoute(win, '/').catch((error) => {
      logger.error('Failed to load renderer URL', error);
      if (displayedFallback || win.isDestroyed()) return;
      displayedFallback = true;
      void (async () => {
        const language = await getAppLanguage();
        await showWindowLoadFailure(win, {
          title: translateNativeText(language, '开发环境页面加载失败'),
          details: error instanceof Error ? error.stack ?? error.message : String(error)
        });
      })().catch((fallbackError) => {
        logger.error('Failed to show dev load fallback', fallbackError);
      });
    });
  } else {
    const rendererPath = path.join(__dirname, '../renderer/index.html');
    void loadRendererRoute(win, '/').catch((error) => {
      logger.error('Failed to load renderer entry file', {
        rendererPath,
        error
      });
      if (displayedFallback || win.isDestroyed()) return;
      displayedFallback = true;
      void (async () => {
        const language = await getAppLanguage();
        await showWindowLoadFailure(win, {
          title: translateNativeText(language, '应用页面加载失败'),
          details: [
            `rendererPath: ${rendererPath}`,
            error instanceof Error ? error.stack ?? error.message : String(error)
          ].join('\n\n')
        });
      })().catch((fallbackError) => {
        logger.error('Failed to show production load fallback', fallbackError);
      });
    });
  }

  return win;
};

const ensureMainWindow = (): BrowserWindow => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  return createMainWindow();
};

const createQuickLauncherWindow = (): BrowserWindow => {
  const appIconImage = loadAppIconImage();
  const win = new BrowserWindow(buildQuickLauncherWindowOptions(appIconImage));
  quickLauncherWindow = win;

  win.on('closed', () => {
    if (quickLauncherWindow === win) {
      quickLauncherWindow = null;
    }
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldDelegateExternalNavigation(url, win.webContents.getURL())) {
      void linkOpenService.open(url);
      return { action: 'deny' };
    }

    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!shouldDelegateExternalNavigation(url, win.webContents.getURL())) {
      return;
    }

    event.preventDefault();
    void linkOpenService.open(url);
  });

  void loadRendererRoute(win, QUICK_LAUNCHER_ROUTE).catch((error) => {
    logger.error('Failed to load quick launcher route', error);
    win.close();
  });

  return win;
};

const ensureQuickLauncherWindow = (): BrowserWindow => {
  if (quickLauncherWindow && !quickLauncherWindow.isDestroyed()) {
    return quickLauncherWindow;
  }
  return createQuickLauncherWindow();
};

const showQuickLauncherWindow = (): void => {
  suppressMainWindowActivationUntil = Date.now() + 1000;
  quickLauncherShouldHideAppOnClose =
    BrowserWindow.getFocusedWindow() !== mainWindow;
  focusQuickLauncherWindow();
};

const applyQuickLauncherShortcutRegistration = (accelerator: string): boolean => {
  if (
    registeredQuickLauncherAccelerator === accelerator &&
    globalShortcut.isRegistered(accelerator)
  ) {
    return true;
  }

  if (registeredQuickLauncherAccelerator) {
    globalShortcut.unregister(registeredQuickLauncherAccelerator);
    registeredQuickLauncherAccelerator = null;
  }

  if (!globalShortcut.register(accelerator, showQuickLauncherWindow)) {
    return false;
  }

  registeredQuickLauncherAccelerator = accelerator;
  return true;
};

const refreshQuickLauncherShortcutRegistration = async (): Promise<void> => {
  const shortcutConfig = await settingsService
    .getShortcutConfig()
    .catch(() => DEFAULT_SHORTCUT_CONFIG);
  const configuredAccelerator = keyboardShortcutToElectronAccelerator(
    shortcutConfig.quickLauncher,
    process.platform,
    { preferCommandOrControl: true }
  );
  const accelerator = configuredAccelerator ?? DEFAULT_QUICK_LAUNCHER_ACCELERATOR;

  if (!configuredAccelerator) {
    logger.warn('Quick launcher shortcut is not supported, falling back to default', {
      shortcut: shortcutConfig.quickLauncher,
      fallback: DEFAULT_QUICK_LAUNCHER_ACCELERATOR
    });
  }

  if (applyQuickLauncherShortcutRegistration(accelerator)) {
    return;
  }

  logger.warn('Failed to register quick launcher global shortcut', {
    shortcut: accelerator
  });

  if (
    accelerator !== DEFAULT_QUICK_LAUNCHER_ACCELERATOR &&
    applyQuickLauncherShortcutRegistration(DEFAULT_QUICK_LAUNCHER_ACCELERATOR)
  ) {
    logger.warn('Quick launcher global shortcut fell back to default shortcut', {
      shortcut: DEFAULT_QUICK_LAUNCHER_ACCELERATOR
    });
  }
};

const openMainAgentSession = (sessionId: string): void => {
  const win = ensureMainWindow();
  focusWindow(win);
  const dispatch = () => {
    sendToMainWindow(OPEN_MAIN_AGENT_SESSION_CHANNEL, sessionId);
  };

  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', dispatch);
    return;
  }

  dispatch();
};

app
  .whenReady()
  .then(async () => {
    const appIconImage = loadAppIconImage();
    if (process.platform === 'darwin' && appIconImage) {
      try {
        app.dock?.setIcon(appIconImage);
      } catch (error) {
        logger.warn('Failed to set dock icon', error);
      }
    }
    await createApplicationMenu();

    chatEvents.onStream((payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        window.webContents.send('chat:stream', payload);
      }
    });

    chatEvents.onHistoryUpdated((payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        window.webContents.send('chat:historyUpdated', payload);
      }
    });

    appOperationEvents.on((payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        window.webContents.send('app:operation', payload);
      }
      if (payload.type === 'app_preview_refreshed') {
        void appPreviewWindowService.refreshForProject(payload.projectId);
      }
    });

    updateEvents.on((payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        window.webContents.send('update:status', payload);
      }
    });

    registerLocalMediaProtocol();
    registerAppPreviewPermissionService();
    registerHandlers({
      onShortcutConfigSaved: async () => {
        await refreshQuickLauncherShortcutRegistration().catch((error) => {
          logger.error('Failed to refresh quick launcher shortcut after settings save', error);
        });
      }
    });
    await skillService.syncBuiltinSkillsOnStartup().catch((error) => {
      logger.error('Failed to sync builtin skills on startup', error);
    });
    cronjobService.start();
    taskSupervisorService.start();
    updateService.start();
    ipcMain.handle('window:close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && quickLauncherWindow === win && !win.isDestroyed()) {
        hideQuickLauncherWindow(win);
        return { ok: true, data: true };
      }
      win?.close();
      return { ok: true, data: true };
    });
    ipcMain.handle('window:hide', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && quickLauncherWindow === win && !win.isDestroyed()) {
        hideQuickLauncherWindow(win);
        return { ok: true, data: true };
      }
      win?.hide();
      return { ok: true, data: true };
    });
    ipcMain.handle('window:dismissQuickLauncher', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && quickLauncherWindow === win && !win.isDestroyed()) {
        dismissQuickLauncherWindow(win);
        return { ok: true, data: true };
      }
      win?.hide();
      return { ok: true, data: true };
    });
    ipcMain.handle('window:toggleMaximize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return { ok: true, data: false };
      }
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return { ok: true, data: true };
    });
    ipcMain.handle('window:openMainAgentSession', async (_event, payload) => {
      const sessionId =
        typeof payload === 'object' &&
        payload &&
        'sessionId' in payload &&
        typeof payload.sessionId === 'string'
          ? payload.sessionId.trim()
          : '';
      if (!sessionId) {
        return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'sessionId is required' } };
      }
      openMainAgentSession(sessionId);
      return { ok: true, data: true };
    });
    ipcMain.handle('window:resizeQuickLauncher', (event, payload) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) {
        return { ok: true, data: false };
      }

      const requestedHeight =
        typeof payload === 'object' &&
        payload &&
        'height' in payload &&
        typeof payload.height === 'number'
          ? payload.height
          : NaN;
      if (!Number.isFinite(requestedHeight)) {
        return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'height must be a number' } };
      }

      const nextHeight = Math.max(QUICK_LAUNCHER_MIN_HEIGHT, Math.round(requestedHeight));
      const [contentWidth, contentHeight] = win.getContentSize();
      if (contentHeight !== nextHeight) {
        win.setContentSize(contentWidth, nextHeight, true);
      }
      return { ok: true, data: true };
    });
    ipcMain.handle('window:setQuickLauncherResizable', (event, payload) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) {
        return { ok: true, data: false };
      }

      const resizable =
        typeof payload === 'object' &&
        payload &&
        'resizable' in payload &&
        typeof payload.resizable === 'boolean'
          ? payload.resizable
          : null;
      if (resizable === null) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'resizable must be a boolean' }
        };
      }

      if (win.isResizable() !== resizable) {
        win.setResizable(resizable);
      }
      return { ok: true, data: true };
    });
    createMainWindow();
    await refreshQuickLauncherShortcutRegistration();

    // Non-blocking: initialize chat channels after window is visible
    chatChannelService.refresh().catch((error) => {
      logger.error('Failed to initialize chat channel service', error);
    });

    app.on('activate', () => {
      if (Date.now() < suppressMainWindowActivationUntil) {
        return;
      }
      if (!mainWindow || mainWindow.isDestroyed()) {
        createMainWindow();
        return;
      }
      focusWindow(mainWindow);
    });
  })
  .catch((error) => {
    logger.error('App initialization failed', error);
  });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', (event) => {
  if (quitConfirmed) {
    taskSupervisorService.stop();
    stopBackgroundServices();
    return;
  }

  event.preventDefault();
  void requestApplicationQuit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
