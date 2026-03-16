import type { AppUpdateStage, AppUpdateStatusDTO } from "@shared/types";

const PROGRESS_STAGES = new Set<AppUpdateStatusDTO["stage"]>([
  "downloading",
  "verifying",
  "downloaded",
]);

const clampPercent = (value: number | undefined): number =>
  Math.max(0, Math.min(100, Math.floor(value ?? 0)));

export interface AboutUpdatePresentation {
  canInstallUpdate: boolean;
  label: string | null;
  isUpdateChecking: boolean;
  isUpdateInFlight: boolean;
  progressPercent: number;
  showLatestVersion: boolean;
  showProgress: boolean;
}

const getStageLabel = (stage: AppUpdateStage): string | null => {
  switch (stage) {
    case "checking":
      return "正在检查更新";
    case "available":
      return "发现新版本";
    case "downloading":
      return "正在下载更新";
    case "verifying":
      return null;
    case "downloaded":
      return "更新已下载，可安装";
    case "upToDate":
      return "当前已是最新版本";
    case "failed":
      return "更新失败";
    default:
      return "未检查更新";
  }
};

const getEffectiveStage = (
  status: AppUpdateStatusDTO | null | undefined,
): AppUpdateStage => {
  const stage = status?.stage;
  if (!status) return "idle";
  if (stage && stage !== "idle") {
    return stage;
  }

  const hasNewerLatestVersion = Boolean(
    status.latestVersion && status.latestVersion !== status.currentVersion,
  );

  if (
    status.downloadedVersion &&
    status.downloadedVersion === status.latestVersion
  ) {
    return "downloaded";
  }

  if (typeof status.progressPercent === "number") {
    if (status.progressPercent >= 100 && hasNewerLatestVersion) {
      return "verifying";
    }
    if (status.progressPercent > 0 && hasNewerLatestVersion) {
      return "downloading";
    }
  }

  if (hasNewerLatestVersion) {
    return "available";
  }

  return "idle";
};

export const getAboutUpdatePresentation = (
  status: AppUpdateStatusDTO | null | undefined,
): AboutUpdatePresentation => {
  const stage = getEffectiveStage(status);
  const canInstallUpdate = stage === "downloaded";
  const isUpdateChecking = stage === "checking";
  const isUpdateInFlight =
    stage === "downloading" || stage === "verifying";
  const progressPercent =
    canInstallUpdate || stage === "verifying"
      ? 100
      : clampPercent(status?.progressPercent);

  return {
    canInstallUpdate,
    label: getStageLabel(stage),
    isUpdateChecking,
    isUpdateInFlight,
    progressPercent,
    showLatestVersion: Boolean(
      status?.latestVersion && status.latestVersion !== status.currentVersion,
    ),
    showProgress: Boolean(stage && PROGRESS_STAGES.has(stage)),
  };
};
