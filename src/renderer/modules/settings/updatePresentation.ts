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
      return "正在校验更新包";
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

export const getAboutUpdatePresentation = (
  status: AppUpdateStatusDTO | null | undefined,
): AboutUpdatePresentation => {
  const stage = status?.stage ?? "idle";
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
      status?.latestVersion &&
        status.latestVersion !== status.currentVersion &&
        stage !== "idle" &&
        stage !== "checking" &&
        stage !== "upToDate",
    ),
    showProgress: Boolean(stage && PROGRESS_STAGES.has(stage)),
  };
};
