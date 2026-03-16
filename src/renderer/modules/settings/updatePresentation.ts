import type { AppUpdateStatusDTO } from "@shared/types";

const PROGRESS_STAGES = new Set<AppUpdateStatusDTO["stage"]>([
  "downloading",
  "verifying",
  "downloaded",
]);

const clampPercent = (value: number | undefined): number =>
  Math.max(0, Math.min(100, Math.floor(value ?? 0)));

export interface AboutUpdatePresentation {
  canInstallUpdate: boolean;
  isUpdateChecking: boolean;
  isUpdateInFlight: boolean;
  progressPercent: number;
  showLatestVersion: boolean;
  showProgress: boolean;
}

export const getAboutUpdatePresentation = (
  status: AppUpdateStatusDTO | null | undefined,
): AboutUpdatePresentation => {
  const stage = status?.stage;
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
    isUpdateChecking,
    isUpdateInFlight,
    progressPercent,
    showLatestVersion: Boolean(
      status?.latestVersion && status.latestVersion !== status.currentVersion,
    ),
    showProgress: Boolean(stage && PROGRESS_STAGES.has(stage)),
  };
};
