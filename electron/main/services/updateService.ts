import type { AppUpdateStatusDTO } from "@shared/types";
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { logger } from "./logger";
import { updateEvents } from "./updateEvents";
import { compareVersions, normalizeVersion } from "./updateVersion";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 15 * 1000;

interface CheckOptions {
  force?: boolean;
}

class UpdateService {
  private status: AppUpdateStatusDTO = {
    stage: "idle",
    currentVersion: normalizeVersion(app.getVersion()),
  };

  private checkPromise: Promise<AppUpdateStatusDTO> | null = null;
  private nextCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private updaterInitialized = false;

  getStatus(): AppUpdateStatusDTO {
    return { ...this.status };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.initUpdater();
    this.scheduleNextCheck(INITIAL_CHECK_DELAY_MS);
  }

  stop(): void {
    this.started = false;
    if (this.nextCheckTimer) {
      clearTimeout(this.nextCheckTimer);
      this.nextCheckTimer = null;
    }
  }

  async checkForUpdates(options?: CheckOptions): Promise<AppUpdateStatusDTO> {
    this.initUpdater();
    const force = Boolean(options?.force);
    if (this.checkPromise) {
      return this.checkPromise;
    }
    if (
      (this.status.stage === "checking" ||
        this.status.stage === "downloading") &&
      !force
    ) {
      return this.getStatus();
    }

    this.checkPromise = this.performCheck(force)
      .catch((error) => {
        logger.error("Auto update check failed", error);
        this.setStatus({
          stage: "failed",
          message: error instanceof Error ? error.message : "检查更新失败",
        });
        return this.getStatus();
      })
      .finally(() => {
        this.checkPromise = null;
        if (this.started) {
          this.scheduleNextCheck(CHECK_INTERVAL_MS);
        }
      });

    return this.checkPromise;
  }

  async quitAndInstall(): Promise<boolean> {
    this.initUpdater();
    if (this.status.stage !== "downloaded") {
      throw new Error("更新尚未下载完成");
    }

    try {
      autoUpdater.quitAndInstall(false, true);
      return true;
    } catch (error) {
      this.setStatus({
        stage: "failed",
        message: error instanceof Error ? error.message : "安装更新失败",
      });
      throw error;
    }
  }

  private scheduleNextCheck(delayMs: number): void {
    if (!this.started) return;
    if (this.nextCheckTimer) {
      clearTimeout(this.nextCheckTimer);
    }
    this.nextCheckTimer = setTimeout(() => {
      void this.checkForUpdates();
    }, delayMs);
  }

  private setStatus(patch: Partial<AppUpdateStatusDTO>): void {
    this.status = {
      ...this.status,
      ...patch,
      currentVersion: normalizeVersion(app.getVersion()),
    };
    updateEvents.emit({ ...this.status });
  }

  private beginChecking(): void {
    this.setStatus({
      stage: "checking",
      latestVersion: undefined,
      downloadedVersion: undefined,
      downloadedFilePath: undefined,
      progressPercent: undefined,
      message: undefined,
      lastCheckedAt: new Date().toISOString(),
    });
  }

  private initUpdater(): void {
    if (this.updaterInitialized) return;
    this.updaterInitialized = true;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = logger;

    autoUpdater.on("checking-for-update", () => {
      this.beginChecking();
    });

    autoUpdater.on("update-available", (info) => {
      this.setStatus({
        stage: "available",
        latestVersion: normalizeVersion(info.version),
        downloadedVersion: undefined,
        downloadedFilePath: undefined,
        progressPercent: 0,
        message: undefined,
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.max(
        0,
        Math.min(100, Math.floor(progress.percent ?? 0)),
      );
      this.setStatus({
        stage: "downloading",
        latestVersion: this.status.latestVersion,
        progressPercent: percent,
        message: undefined,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.markDownloaded(
        normalizeVersion(info.version),
        info.downloadedFile,
      );
    });

    autoUpdater.on("update-not-available", (info) => {
      this.setStatus({
        stage: "upToDate",
        latestVersion: info?.version
          ? normalizeVersion(info.version)
          : undefined,
        downloadedVersion: undefined,
        downloadedFilePath: undefined,
        progressPercent: undefined,
        message: undefined,
      });
    });

    autoUpdater.on("error", (error) => {
      logger.error("Auto updater failed", error);
      this.setStatus({
        stage: "failed",
        message: error instanceof Error ? error.message : "更新失败",
      });
    });
  }

  private markDownloaded(version: string, downloadedFilePath?: string): void {
    this.setStatus({
      stage: "downloaded",
      latestVersion: version,
      downloadedVersion: version,
      downloadedFilePath,
      progressPercent: 100,
      message: "新版本已下载完成，可以安装",
    });
  }

  private async performCheck(force: boolean): Promise<AppUpdateStatusDTO> {
    this.beginChecking();
    const result = await autoUpdater.checkForUpdates();
    const nextVersion = result?.updateInfo?.version
      ? normalizeVersion(result.updateInfo.version)
      : null;
    const currentVersion = normalizeVersion(app.getVersion());
    const shouldTreatAsNewerVersion = Boolean(
      nextVersion && compareVersions(nextVersion, currentVersion) > 0,
    );

    if (
      shouldTreatAsNewerVersion &&
      (this.status.stage === "checking" || this.status.stage === "upToDate")
    ) {
      this.setStatus({
        stage: "available",
        latestVersion: nextVersion ?? undefined,
        downloadedVersion: undefined,
        downloadedFilePath: undefined,
        progressPercent: 0,
        message: undefined,
      });
    }

    if (!shouldTreatAsNewerVersion && this.status.stage === "checking") {
      this.setStatus({
        stage: "upToDate",
        latestVersion: nextVersion ?? currentVersion,
        downloadedVersion: undefined,
        downloadedFilePath: undefined,
        progressPercent: undefined,
        message: undefined,
      });
    }

    const downloadPromise =
      result?.downloadPromise ??
      (shouldTreatAsNewerVersion ? autoUpdater.downloadUpdate() : undefined);

    await downloadPromise;
    if (force && this.status.stage === "downloaded") {
      this.setStatus({
        message: "已准备好安装最新版本",
      });
    }
    return this.getStatus();
  }
}

export const updateService = new UpdateService();
