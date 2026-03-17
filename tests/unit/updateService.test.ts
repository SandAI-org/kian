import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  appVersion: '1.2.3',
  quit: vi.fn(),
  listeners: new Map<string, Array<(...args: any[]) => void>>(),
  checkForUpdates: vi.fn<() => Promise<unknown>>(),
  downloadUpdate: vi.fn<() => Promise<unknown>>(),
  quitAndInstall: vi.fn()
}));
const loggerState = vi.hoisted(() => ({
  error: vi.fn()
}));
const validatorState = vi.hoisted(() => ({
  validateDownloadedMacUpdate: vi.fn<(downloadedFilePath: string) => Promise<void>>()
}));

const emitUpdaterEvent = (event: string, ...args: unknown[]): void => {
  for (const listener of state.listeners.get(event) ?? []) {
    listener(...args);
  }
};

vi.mock('electron', () => ({
  app: {
    getVersion: () => state.appVersion,
    getPath: () => '/tmp',
    quit: state.quit
  }
}));
vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: (event: string, listener: (...args: any[]) => void) => {
      const previous = state.listeners.get(event) ?? [];
      state.listeners.set(event, [...previous, listener]);
      return true;
    },
    checkForUpdates: (...args: []) => state.checkForUpdates(...args),
    downloadUpdate: (...args: []) => state.downloadUpdate(...args),
    quitAndInstall: (...args: [boolean?, boolean?]) => state.quitAndInstall(...args)
  }
}));
vi.mock('../../electron/main/services/logger', () => ({
  logger: {
    error: loggerState.error,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));
vi.mock('../../electron/main/services/updatePackageValidator', () => ({
  validateDownloadedMacUpdate: (downloadedFilePath: string) =>
    validatorState.validateDownloadedMacUpdate(downloadedFilePath)
}));

describe('updateService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    state.quit.mockReset();
    state.listeners.clear();
    state.checkForUpdates.mockReset();
    state.downloadUpdate.mockReset();
    state.quitAndInstall.mockReset();
    loggerState.error.mockReset();
    validatorState.validateDownloadedMacUpdate.mockReset();
    validatorState.validateDownloadedMacUpdate.mockResolvedValue();
    state.downloadUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    state.listeners.clear();
  });

  it('marks up-to-date when latest version is not newer', async () => {
    state.appVersion = '1.2.3';
    state.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent('checking-for-update');
      emitUpdaterEvent('update-not-available', { version: '1.2.3' });
      return { updateInfo: { version: '1.2.3' } };
    });

    const { updateService } = await import('../../electron/main/services/updateService');
    const status = await updateService.checkForUpdates({ force: true });

    expect(status.stage).toBe('upToDate');
    expect(status.latestVersion).toBe('1.2.3');
    expect(status.currentVersion).toBe('1.2.3');
  });

  it('downloads update and marks downloaded when update package is ready', async () => {
    state.appVersion = '1.2.2';
    state.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent('checking-for-update');
      emitUpdaterEvent('update-available', { version: '1.2.3' });
      const downloadPromise = Promise.resolve().then(() => {
        emitUpdaterEvent('download-progress', { percent: 56.4 });
        emitUpdaterEvent('update-downloaded', {
          version: '1.2.3',
          downloadedFile: '/tmp/Kian-1.2.3.zip'
        });
      });
      return { updateInfo: { version: '1.2.3' }, downloadPromise };
    });

    const { updateService } = await import('../../electron/main/services/updateService');
    const status = await updateService.checkForUpdates({ force: true });

    expect(status.stage).toBe('downloaded');
    expect(status.latestVersion).toBe('1.2.3');
    expect(status.downloadedVersion).toBe('1.2.3');
    expect(status.progressPercent).toBe(100);
    expect(status.message).toContain('已准备好安装');
    expect(status.downloadedFilePath).toBe('/tmp/Kian-1.2.3.zip');
  });

  it('does not report up to date when updater returns a newer version in updateInfo', async () => {
    state.appVersion = '1.2.2';
    state.downloadUpdate.mockImplementation(async () => {
      emitUpdaterEvent('download-progress', { percent: 56.4 });
      emitUpdaterEvent('update-downloaded', {
        version: '1.2.3',
        downloadedFile: '/tmp/Kian-1.2.3.zip'
      });
    });
    state.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent('checking-for-update');
      emitUpdaterEvent('update-not-available', { version: '1.2.3' });
      return { updateInfo: { version: '1.2.3' } };
    });

    const { updateService } = await import('../../electron/main/services/updateService');
    const status = await updateService.checkForUpdates({ force: true });

    expect(state.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(status.stage).toBe('downloaded');
    expect(status.latestVersion).toBe('1.2.3');
  });

  it('fails update check when updater throws', async () => {
    state.appVersion = '1.2.2';
    state.checkForUpdates.mockRejectedValue(new Error('network unavailable'));

    const { updateService } = await import('../../electron/main/services/updateService');
    const status = await updateService.checkForUpdates({ force: true });

    expect(status.stage).toBe('failed');
    expect(status.message).toContain('network unavailable');
  });

  it('falls back to up-to-date when updater returns the current version without events', async () => {
    state.appVersion = '1.2.3';
    state.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '1.2.3' }
    });

    const { updateService } = await import('../../electron/main/services/updateService');
    const status = await updateService.checkForUpdates({ force: true });

    expect(status.stage).toBe('upToDate');
    expect(status.latestVersion).toBe('1.2.3');
    expect(status.progressPercent).toBeUndefined();
  });

  it('falls back to available and starts download when updater returns a newer version without events', async () => {
    state.appVersion = '1.2.2';
    state.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '1.2.3' }
    });

    const { updateService } = await import('../../electron/main/services/updateService');
    const status = await updateService.checkForUpdates({ force: true });

    expect(state.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(status.stage).toBe('available');
    expect(status.latestVersion).toBe('1.2.3');
    expect(status.progressPercent).toBe(0);
  });

  it('calls autoUpdater.quitAndInstall after update is downloaded', async () => {
    state.appVersion = '1.2.2';
    state.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent('checking-for-update');
      emitUpdaterEvent('update-available', { version: '1.2.3' });
      const downloadPromise = Promise.resolve().then(() => {
        emitUpdaterEvent('update-downloaded', {
          version: '1.2.3',
          downloadedFile: '/tmp/Kian-1.2.3.zip'
        });
      });
      return { updateInfo: { version: '1.2.3' }, downloadPromise };
    });

    const { updateService } = await import('../../electron/main/services/updateService');
    await updateService.checkForUpdates({ force: true });

    const result = await updateService.quitAndInstall();

    expect(result).toBe(true);
    expect(state.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('marks update as failed when mac package signature validation fails', async () => {
    state.appVersion = '1.2.2';
    validatorState.validateDownloadedMacUpdate.mockRejectedValue(
      new Error('更新包签名身份与当前安装版本不一致（OLDTEAM -> NEWTEAM），请手动下载安装最新版。')
    );
    state.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent('checking-for-update');
      emitUpdaterEvent('update-available', { version: '1.2.3' });
      const downloadPromise = Promise.resolve().then(() => {
        emitUpdaterEvent('update-downloaded', {
          version: '1.2.3',
          downloadedFile: '/tmp/Kian-1.2.3.zip'
        });
      });
      return { updateInfo: { version: '1.2.3' }, downloadPromise };
    });

    const { updateService } = await import('../../electron/main/services/updateService');
    const status = await updateService.checkForUpdates({ force: true });

    expect(status.stage).toBe('failed');
    expect(status.message).toContain('签名身份与当前安装版本不一致');
    await expect(updateService.quitAndInstall()).rejects.toThrow('更新尚未下载完成');
  });

  it('schedules automatic checks on startup and repeats after the interval', async () => {
    vi.useFakeTimers();
    state.appVersion = '1.2.3';
    state.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '1.2.3' }
    });

    const { updateService } = await import('../../electron/main/services/updateService');
    updateService.start();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(state.checkForUpdates).toHaveBeenCalledTimes(2);

    updateService.stop();
  });
});
