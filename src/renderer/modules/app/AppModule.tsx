import { ExportOutlined, FolderOpenOutlined, ReloadOutlined } from "@ant-design/icons";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { api } from "@renderer/lib/api";
import type { AppType, OpenAppPreviewWindowPayload } from "@shared/types";
import { formatUtcTimestampToLocal } from "@shared/utils/dateTime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Space, Typography, message } from "antd";
import React, { useEffect, useMemo } from "react";

interface AppModuleProps {
  projectId: string;
  onContextChange?: (context: unknown) => void;
}

const LOCAL_MEDIA_SCHEME_PREFIX = "kian-local://local/";
const toLocalMediaUrl = (rawPath: string): string =>
  `${LOCAL_MEDIA_SCHEME_PREFIX}${encodeURIComponent(rawPath)}`;
const APP_TYPE_TITLES: Record<AppType, string> = {
  react: "React 应用",
  vue: "Vue 应用",
  svelte: "Svelte 应用",
  nextjs: "Next.js 应用",
  nuxt: "Nuxt 应用",
  angular: "Angular 应用",
  vanilla: "Web 应用",
  unknown: "应用",
};

export const AppModule = ({ projectId, onContextChange }: AppModuleProps) => {
  const queryClient = useQueryClient();
  const [previewVersion, setPreviewVersion] = React.useState(0);
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);

  const statusQuery = useQuery({
    queryKey: ["app-workspace", projectId],
    queryFn: () => api.app.getStatus(projectId),
    enabled: Boolean(projectId),
  });

  const status = statusQuery.data;
  const hasRenderableBuild = Boolean(
    status?.hasBuild && status?.distIndexPath && status?.builtAt?.trim(),
  );

  const previewUrl = useMemo(() => {
    if (!hasRenderableBuild || !status?.distIndexPath || !status?.builtAt)
      return "";
    const base = toLocalMediaUrl(status.distIndexPath);
    const stamp = encodeURIComponent(status.builtAt);
    return `${base}?t=${stamp}&v=${previewVersion}`;
  }, [
    hasRenderableBuild,
    previewVersion,
    status?.builtAt,
    status?.distIndexPath,
  ]);

  useEffect(() => {
    onContextChange?.({
      appDir: status?.appDir,
      appType: status?.appType ?? "unknown",
      appName: status?.appName ?? "",
      initialized: status?.initialized ?? false,
      dependenciesInstalled: status?.dependenciesInstalled ?? false,
      hasBuild: status?.hasBuild ?? false,
      builtAt: status?.builtAt ?? null,
    });
  }, [
    onContextChange,
    status?.appDir,
    status?.appType,
    status?.appName,
    status?.builtAt,
    status?.dependenciesInstalled,
    status?.hasBuild,
    status?.initialized,
  ]);

  useEffect(
    () =>
      api.appOperation.subscribe((event) => {
        if (
          event.type !== "app_preview_refreshed" ||
          event.projectId !== projectId
        )
          return;
        setPreviewVersion((prev) => prev + 1);
        void queryClient.invalidateQueries({
          queryKey: ["app-workspace", projectId],
        });
      }),
    [projectId, queryClient],
  );

  useEffect(
    () =>
      api.chat.subscribeHistoryUpdated((event) => {
        if (
          event.scope.type !== "project" ||
          event.scope.projectId !== projectId ||
          event.role === "user"
        )
          return;
        void queryClient.invalidateQueries({
          queryKey: ["app-workspace", projectId],
        });
      }),
    [projectId, queryClient],
  );

  const appTitle = hasRenderableBuild
    ? status?.appName?.trim() || APP_TYPE_TITLES[status?.appType ?? "unknown"]
    : "应用预览";
  const buildTimeText =
    hasRenderableBuild && status?.builtAt
      ? formatUtcTimestampToLocal(status.builtAt)
      : null;

  const openAppDir = () => {
    if (!status?.appDir) return;
    void api.file.open(status.appDir).catch((error) => {
      message.error(error instanceof Error ? error.message : t("打开目录失败"));
    });
  };

  const openGlobalPreview = () => {
    if (!status?.distIndexPath || !status?.builtAt) return;
    const payload: OpenAppPreviewWindowPayload = {
      projectId,
      distIndexPath: status.distIndexPath,
      builtAt: status.builtAt,
      appName: status.appName,
      appType: status.appType ?? "unknown",
    };
    void api.window.openAppPreview(payload).catch((error) => {
      message.error(
        error instanceof Error ? error.message : t("打开全局预览失败"),
      );
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Typography.Text className="!font-semibold !text-slate-900">
            {appTitle}
          </Typography.Text>
          {buildTimeText ? (
            <Typography.Text className="!text-[12px] !text-slate-500">
              {t(`上次构建：${buildTimeText}`)}
            </Typography.Text>
          ) : null}
        </div>
        <Space size="small">
          <Button
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={openAppDir}
            disabled={!status?.appDir}
          >
            打开目录
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => {
              void queryClient.invalidateQueries({
                queryKey: ["app-workspace", projectId],
              });
            }}
            loading={statusQuery.isFetching}
          >
            刷新
          </Button>
          <Button
            size="small"
            icon={<ExportOutlined />}
            onClick={openGlobalPreview}
            disabled={!hasRenderableBuild}
          >
            独立窗口展示
          </Button>
        </Space>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[#dbe5f5] bg-white">
        {previewUrl ? (
          <iframe
            key={previewUrl}
            title="应用预览"
            src={previewUrl}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
            allow="camera *; microphone *; display-capture *"
          />
        ) : (
          <div className="app-empty-shell">
            <div className="app-empty-shell__glow app-empty-shell__glow--one" />
            <div className="app-empty-shell__glow app-empty-shell__glow--two" />
            <div className="app-empty-shell__icon">
              <svg
                width="120"
                height="96"
                viewBox="0 0 120 96"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="10"
                  y="12"
                  width="100"
                  height="72"
                  rx="8"
                  stroke="#b0c4de"
                  strokeWidth="1.5"
                  fill="rgba(255,255,255,0.7)"
                />
                <line
                  x1="10"
                  y1="28"
                  x2="110"
                  y2="28"
                  stroke="#c4d3eb"
                  strokeWidth="1"
                />
                <circle cx="20" cy="20" r="3" fill="#f6b0b0" />
                <circle cx="29" cy="20" r="3" fill="#f8d9a0" />
                <circle cx="38" cy="20" r="3" fill="#b7e4c7" />
                <rect
                  x="22"
                  y="38"
                  width="40"
                  height="4"
                  rx="2"
                  fill="#dbe5f5"
                />
                <rect
                  x="22"
                  y="48"
                  width="28"
                  height="4"
                  rx="2"
                  fill="#dbe5f5"
                />
                <rect
                  x="22"
                  y="58"
                  width="34"
                  height="4"
                  rx="2"
                  fill="#dbe5f5"
                />
                <rect
                  x="22"
                  y="68"
                  width="24"
                  height="4"
                  rx="2"
                  fill="#dbe5f5"
                />
                <rect
                  x="74"
                  y="38"
                  width="24"
                  height="34"
                  rx="4"
                  stroke="#c4d3eb"
                  strokeWidth="1"
                  fill="none"
                />
                <rect
                  x="78"
                  y="44"
                  width="16"
                  height="3"
                  rx="1.5"
                  fill="#e8eff9"
                />
                <rect
                  x="78"
                  y="51"
                  width="12"
                  height="3"
                  rx="1.5"
                  fill="#e8eff9"
                />
              </svg>
            </div>
            <div className="app-empty-shell__text">
              <p className="app-empty-shell__title">等待应用构建</p>
              <p className="app-empty-shell__hint">
                在对话中描述你想要的应用，构建后将在此预览
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
