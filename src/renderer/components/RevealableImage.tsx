import { FileImageOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { api } from "@renderer/lib/api";
import { isMacPlatform } from "@renderer/lib/shortcuts";
import { message } from "antd";
import { useEffect, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";

interface RevealableImageProps {
  src: string;
  alt: string;
  filePath?: string | null;
  projectId?: string;
  documentPath?: string;
  className?: string;
  imageClassName?: string;
  style?: CSSProperties;
  loading?: "eager" | "lazy";
}

const isWindowsPlatform = (): boolean =>
  typeof navigator !== "undefined" && /win/i.test(navigator.platform);

const joinClassName = (...values: Array<string | undefined | false>): string =>
  values.filter(Boolean).join(" ");

export const RevealableImage = ({
  src,
  alt,
  filePath,
  projectId,
  documentPath,
  className,
  imageClassName,
  style,
  loading = "lazy",
}: RevealableImageProps) => {
  const { language } = useAppI18n();
  const [loadFailed, setLoadFailed] = useState(false);
  const revealLabel = translateUiText(
    language,
    isMacPlatform()
      ? "在 Finder 中显示"
      : isWindowsPlatform()
        ? "在资源管理器中显示"
        : "在文件管理器中显示",
  );
  const missingImageLabel = translateUiText(language, "图片不可用");

  useEffect(() => {
    setLoadFailed(false);
  }, [src]);

  const handleShowInFinder = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();

    const targetPath = filePath?.trim();
    if (!targetPath) {
      return;
    }

    void api.file.showInFinder(targetPath, projectId, documentPath).catch(() => {
      message.error(translateUiText(language, "显示文件位置失败"));
    });
  };

  return (
    <div
      className={joinClassName(
        "group/reveal relative overflow-hidden",
        className,
      )}
      style={style}
    >
      {loadFailed ? (
        <div
          className={joinClassName(
            "flex h-full min-h-[72px] w-full flex-col items-center justify-center gap-2 bg-[linear-gradient(135deg,#f7f9fd_0%,#eef3fb_100%)] px-4 py-3 text-slate-400",
            imageClassName,
          )}
          aria-label={missingImageLabel}
          title={missingImageLabel}
        >
          <FileImageOutlined className="text-[22px] text-slate-400" />
          <span className="text-[11px] font-medium leading-none text-slate-500">
            {missingImageLabel}
          </span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={joinClassName("block", imageClassName)}
          loading={loading}
          onError={() => setLoadFailed(true)}
        />
      )}
      {filePath?.trim() && !loadFailed ? (
        <button
          type="button"
          className="absolute right-2 top-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-[15px] text-white opacity-0 backdrop-blur-sm transition-[opacity,background-color] hover:bg-black/68 focus:opacity-100 group-hover/reveal:opacity-100"
          title={revealLabel}
          aria-label={revealLabel}
          onClick={handleShowInFinder}
        >
          <FolderOpenOutlined />
        </button>
      ) : null}
    </div>
  );
};
