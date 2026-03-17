import {
  ArrowUpOutlined,
  CheckCircleOutlined,
  FileOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  PushpinOutlined,
} from "@ant-design/icons";
import {
  CHAT_THINKING_LEVEL_VALUES,
  ChatComposer,
  type LocalChatFile,
} from "@renderer/modules/chat/ChatComposer";
import { MarkdownPreBlock } from "@renderer/components/MarkdownPreBlock";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { RevealableImage } from "@renderer/components/RevealableImage";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { api } from "@renderer/lib/api";
import { openUrl } from "@renderer/lib/openUrl";
import {
  MAIN_AGENT_INPUT_FOCUS_EVENT,
  formatKeyboardShortcut,
  matchesKeyboardShortcut,
} from "@renderer/lib/shortcuts";
import { useChatStreamStore } from "@renderer/store/chatStreamStore";
import type {
  ChatAttachmentDTO,
  ChatHistoryUpdatedEvent,
  ChatMessageDTO,
  ChatMessageMetadata,
  ChatModuleType,
  ChatScope,
  ChatThinkingLevel,
} from "@shared/types";
import {
  buildUserRequestMetadataJson,
  hasPersistedPendingUserMessage,
} from "@shared/utils/chatPendingMessage";
import {
  detectMarkdownMediaKindFromSource,
  rewriteBareRemoteMediaUrlsInMarkdown,
  type MarkdownMediaKind,
} from "@shared/utils/markdownMedia";
import { DEFAULT_SHORTCUT_CONFIG } from "@shared/utils/shortcuts";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Tag, message } from "antd";
import {
  ChangeEvent,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import {
  formatToolDisplayName,
  normalizeToolDetailText,
  type ToolCallInfo,
} from "./streamingState";

// ---------------------------------------------------------------------------
// Props & Internal Types
// ---------------------------------------------------------------------------

interface ModuleChatPaneProps {
  projectId?: string;
  scope?: ChatScope;
  module: ChatModuleType;
  chatVariant?: "project" | "main";
  acceptMainInputFocusEvents?: boolean;
  contextSnapshot?: unknown;
  hideBorder?: boolean;
  sessionId?: string;
  onSessionCreated?: (sessionId: string) => void;
  layoutMode?: "fill" | "auto";
  emptyStateMode?: "default" | "hidden";
  timelineMaxHeight?: number;
  composerVariant?: "default" | "embedded";
  sessionBootstrapMode?: "default" | "lazy-new";
}

interface SendPayload {
  sessionId: string;
  text: string;
  requestId: string;
  files: LocalChatFile[];
}

interface QueuedSendPayload extends SendPayload {
  pendingMessage: ChatMessageDTO;
}

type MessageBlock =
  | {
      type: "message";
      key: string;
      createdAt: string;
      message: ChatMessageDTO;
    }
  | {
      type: "streaming-thinking";
      key: string;
      createdAt: string;
      content: string;
    }
  | {
      type: "streaming-assistant";
      key: string;
      createdAt: string;
      content: string;
    }
  | {
      type: "tool-group";
      key: string;
      createdAt: string;
      tools: ToolCallInfo[];
    };

type TimelineItem =
  | {
      type: "message";
      key: string;
      createdAt: string;
      sortOrder: number;
      message: ChatMessageDTO;
    }
  | {
      type: "streaming-thinking";
      key: string;
      createdAt: string;
      sortOrder: number;
      content: string;
    }
  | {
      type: "streaming-assistant";
      key: string;
      createdAt: string;
      sortOrder: number;
      content: string;
    }
  | {
      type: "tool";
      key: string;
      createdAt: string;
      sortOrder: number;
      tool: ToolCallInfo;
    };

const TOOL_OUTPUT_PREVIEW_MAX_LINES = 10;

const SUPPORTED_FILE_ACCEPT = [
  ".pdf",
  ".docx",
  ".csv",
  ".xlsx",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".md",
  ".markdown",
  "image/*",
  "audio/*",
  "video/*",
].join(",");
const IMAGE_FILE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".heic",
  ".heif",
]);
const VIDEO_FILE_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".avi",
  ".mkv",
  ".flv",
  ".wmv",
  ".m3u8",
]);
const AUDIO_FILE_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
]);
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 56;
const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".config",
  ".xml",
  ".csv",
  ".tsv",
  ".log",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".java",
  ".kt",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".sh",
  ".zsh",
  ".bash",
  ".sql",
  ".env",
]);
const EXTENDED_MEDIA_PATTERN =
  /@\[(image|video|audio|file|attachment)(?:\|([^\]]*))?\]\(([^)\n]+)\)/gi;
const CORRUPTED_NESTED_MEDIA_PATTERN =
  /([^\s()[\]]+)@\[(image|video|audio)\]\((\/[^)\n]+)\)/gi;
const KIAN_MEDIA_PREFIX = "kian-media://";
const LOCAL_MEDIA_SCHEME_PREFIX = "kian-local://local/";
const MAIN_AGENT_SCOPE_ID = "main-agent";
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const UNSAFE_URL_PATTERN = /^(?:javascript|vbscript):/i;
const TEXT_PREVIEW_MAX_BYTES = 64 * 1024;
const TEXT_PREVIEW_MAX_CHARS = 6_000;
const TEXT_PREVIEW_MAX_LINES = 80;
const LEGACY_CHAT_INPUT_SHORTCUT_TIP_DISMISSED_STORAGE_KEY =
  "kian.chat.input-shortcut-tip.dismissed";
type ExtendedMarkdownKind = MarkdownMediaKind | "file" | "attachment";

const isChatThinkingLevel = (value: string): value is ChatThinkingLevel =>
  value === "low" || value === "medium" || value === "high";

const stripProviderPrefixFromModelName = (modelName: string): string => {
  const trimmed = modelName.trim();
  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex <= 0) {
    return trimmed;
  }
  const nameOnly = trimmed.slice(separatorIndex + 1).trim();
  return nameOnly || trimmed;
};

const getScopeKey = (scope: ChatScope): string =>
  scope.type === "main" ? "main" : scope.projectId;

const isSameScope = (left: ChatScope, right: ChatScope): boolean =>
  left.type === right.type &&
  (left.type === "main"
    ? true
    : right.type === "project" && left.projectId === right.projectId);

const stripWrappedPath = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const getFileExtension = (fileName: string): string => {
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index === fileName.length - 1) {
    return "";
  }
  return fileName.slice(index).toLowerCase();
};

const detectMediaKind = (
  fileName: string,
  mimeType?: string,
  extension?: string,
): MarkdownMediaKind | null => {
  if (mimeType?.startsWith("image/")) {
    return "image";
  }
  if (mimeType?.startsWith("video/")) {
    return "video";
  }
  if (mimeType?.startsWith("audio/")) {
    return "audio";
  }

  const ext = extension || getFileExtension(fileName);
  if (IMAGE_FILE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_FILE_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_FILE_EXTENSIONS.has(ext)) return "audio";
  return null;
};

const isImageFile = (fileName: string, mimeType?: string): boolean =>
  detectMediaKind(fileName, mimeType) === "image";

const buildExtendedMarkdown = (
  kind: ExtendedMarkdownKind,
  localPath: string,
): string => `@[${kind}](${localPath})`;

const formatDraftMessage = (text: string, files: LocalChatFile[]): string => {
  const base = text.trim();
  if (files.length === 0) {
    return base;
  }
  const lines = files.map((file) => {
    const mediaKind = detectMediaKind(file.name, file.mimeType, file.extension);
    const markdownKind: ExtendedMarkdownKind = mediaKind ?? "file";
    return buildExtendedMarkdown(markdownKind, file.sourcePath);
  });
  return `${base}\n\n${lines.join("\n")}`;
};

const encodeExtendedMediaToken = (
  kind: ExtendedMarkdownKind,
  sourcePath: string,
): string => `${KIAN_MEDIA_PREFIX}${kind}/${encodeURIComponent(sourcePath)}`;

const decodeExtendedMediaToken = (
  src: string,
): { kind: ExtendedMarkdownKind; sourcePath: string } | null => {
  if (!src.startsWith(KIAN_MEDIA_PREFIX)) return null;
  const tokenBody = src.slice(KIAN_MEDIA_PREFIX.length);
  const separator = tokenBody.indexOf("/");
  if (separator <= 0) return null;

  const kind = tokenBody.slice(0, separator).toLowerCase();
  if (
    kind !== "image" &&
    kind !== "video" &&
    kind !== "audio" &&
    kind !== "file" &&
    kind !== "attachment"
  )
    return null;

  const encodedPath = tokenBody.slice(separator + 1);
  try {
    return { kind, sourcePath: decodeURIComponent(encodedPath) };
  } catch {
    return null;
  }
};

const repairCorruptedRelativeMediaPaths = (content: string): string =>
  content.replace(
    CORRUPTED_NESTED_MEDIA_PATTERN,
    (fullMatch, prefixRaw: string, _kindRaw: string, suffixRaw: string) => {
      const prefix = stripWrappedPath(prefixRaw);
      const suffix = stripWrappedPath(suffixRaw);
      if (!prefix || !suffix.startsWith("/")) {
        return fullMatch;
      }
      if (
        /^(?:https?|file|data|blob|mailto|tel|kian-local|kian-media):/i.test(
          prefix,
        ) ||
        prefix.startsWith("/") ||
        WINDOWS_ABSOLUTE_PATH_PATTERN.test(prefix) ||
        prefix.startsWith("\\\\")
      ) {
        return fullMatch;
      }
      return `${prefix}${suffix}`;
    },
  );

const normalizeFencedCodeBlocks = (content: string): string =>
  content.replace(
    /(^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g,
    (
      fullMatch,
      linePrefix: string,
      fence: string,
      info: string,
      body: string,
    ) => {
      const normalizedBody = body.replace(/^\s*\n+/, "").replace(/\n+\s*$/, "");
      if (!normalizedBody) return fullMatch;
      return `${linePrefix}${fence}${info}\n${normalizedBody}\n${fence}`;
    },
  );

const preprocessExtendedMediaMarkdown = (content: string): string =>
  rewriteBareRemoteMediaUrlsInMarkdown(
    normalizeFencedCodeBlocks(repairCorruptedRelativeMediaPaths(content)),
    (kind, url) => buildExtendedMarkdown(kind, url),
  ).replace(
    EXTENDED_MEDIA_PATTERN,
    (_full, kindRaw: string, sizeRaw: string | undefined, pathRaw: string) => {
      const kind = kindRaw.toLowerCase() as ExtendedMarkdownKind;
      const localPath = stripWrappedPath(pathRaw);
      if (!localPath) return "";
      const token = encodeExtendedMediaToken(kind, localPath);
      const sizeSuffix = sizeRaw ? `|${sizeRaw}` : "";
      if (kind === "file" || kind === "attachment") {
        return `[__kian_file__](${token})`;
      }
      return `![__kian_media_${kind}__${sizeSuffix}](${token})`;
    },
  );

const toLocalMediaUrl = (rawPath: string, projectId?: string): string => {
  const base = `${LOCAL_MEDIA_SCHEME_PREFIX}${encodeURIComponent(rawPath)}`;
  const normalizedProjectId = projectId?.trim();
  if (!normalizedProjectId) {
    return base;
  }
  return `${base}?projectId=${encodeURIComponent(normalizedProjectId)}`;
};

const resolveRenderableUrl = (url: string, projectId?: string): string => {
  const normalized = url.trim();
  if (!normalized) return "";
  if (UNSAFE_URL_PATTERN.test(normalized.toLowerCase())) return "";
  if (normalized.startsWith(KIAN_MEDIA_PREFIX)) return normalized;
  if (/^(?:https?|file|data|blob|mailto|tel|kian-local):/i.test(normalized))
    return normalized;
  if (
    normalized.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized) ||
    normalized.startsWith("\\\\")
  ) {
    return toLocalMediaUrl(normalized);
  }
  if (projectId?.trim()) {
    return toLocalMediaUrl(normalized, projectId);
  }
  return normalized;
};

const resolveRevealableImagePath = (url: string): string | null => {
  const normalized = url.trim();
  if (!normalized) return null;
  if (UNSAFE_URL_PATTERN.test(normalized.toLowerCase())) return null;
  if (/^(?:https?|file|data|blob|mailto|tel|kian-local):/i.test(normalized)) {
    return null;
  }
  const hashIndex = normalized.indexOf("#");
  const queryIndex = normalized.indexOf("?");
  const suffixIndex =
    hashIndex < 0
      ? queryIndex
      : queryIndex < 0
        ? hashIndex
        : Math.min(hashIndex, queryIndex);
  return suffixIndex < 0 ? normalized : normalized.slice(0, suffixIndex);
};

const parseSizeFromAlt = (
  alt: string,
): { cleanAlt: string; width?: number; height?: number } => {
  const m = alt.match(/\|(\d+)(?:x(\d+))?\s*$/);
  if (!m) return { cleanAlt: alt };
  return {
    cleanAlt: alt.slice(0, m.index).trim() || "image",
    width: parseInt(m[1], 10),
    height: m[2] ? parseInt(m[2], 10) : undefined,
  };
};

const mediaSizeStyle = (
  w?: number,
  h?: number,
): React.CSSProperties | undefined =>
  w ? { width: w, maxWidth: "100%", height: h ?? "auto" } : undefined;

const revokePreviewUrls = (files: LocalChatFile[]): void => {
  for (const file of files) {
    if (file.previewUrl) {
      URL.revokeObjectURL(file.previewUrl);
    }
  }
};

const getPathFileName = (sourcePath: string): string => {
  const normalized = sourcePath.trim().replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || sourcePath;
};

const extractTextFromReactNode = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((item) => extractTextFromReactNode(item)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractTextFromReactNode(node.props.children ?? "");
  }
  return "";
};

const isTextFilePath = (sourcePath: string): boolean => {
  const fileName = getPathFileName(sourcePath);
  const extension = getFileExtension(fileName);
  return TEXT_FILE_EXTENSIONS.has(extension);
};

const truncateTextPreview = (
  content: string,
): { text: string; truncated: boolean } => {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const limitedLines = lines.slice(0, TEXT_PREVIEW_MAX_LINES);
  let text = limitedLines.join("\n");
  let truncated = lines.length > TEXT_PREVIEW_MAX_LINES;
  if (text.length > TEXT_PREVIEW_MAX_CHARS) {
    text = text.slice(0, TEXT_PREVIEW_MAX_CHARS);
    truncated = true;
  }
  return { text, truncated };
};

const readTextPreviewFromUrl = async (
  fileUrl: string,
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetch(fileUrl, { signal });
  if (!response.ok) {
    throw new Error(`Failed to read file: HTTP ${response.status}`);
  }
  if (!response.body) {
    const result = truncateTextPreview(await response.text());
    return result.truncated ? `${result.text}\n...(已截断)` : result.text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let collected = "";
  let bytesRead = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const remaining = TEXT_PREVIEW_MAX_BYTES - bytesRead;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const chunk =
      value.byteLength > remaining ? value.slice(0, remaining) : value;
    bytesRead += chunk.byteLength;
    collected += decoder.decode(chunk, { stream: true });
    if (value.byteLength > remaining) {
      truncated = true;
      break;
    }
  }
  collected += decoder.decode();
  const preview = truncateTextPreview(collected);
  return truncated || preview.truncated
    ? `${preview.text}\n...(已截断)`
    : preview.text;
};

const FileReferenceCard = ({
  sourcePath,
  projectId,
  user,
  forceCardOnly = false,
  attachment = false,
}: {
  sourcePath: string;
  projectId?: string;
  user: boolean;
  forceCardOnly?: boolean;
  attachment?: boolean;
}) => {
  const fileName = useMemo(() => getPathFileName(sourcePath), [sourcePath]);
  const isTextPreview = useMemo(
    () => !forceCardOnly && isTextFilePath(sourcePath),
    [forceCardOnly, sourcePath],
  );
  const resolvedSource = useMemo(
    () => resolveRenderableUrl(sourcePath, projectId),
    [projectId, sourcePath],
  );
  const [previewText, setPreviewText] = useState<string>("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTextPreview || !resolvedSource) {
      setLoadingPreview(false);
      setPreviewText("");
      setPreviewError(null);
      return;
    }

    const controller = new AbortController();
    setLoadingPreview(true);
    setPreviewError(null);
    setPreviewText("");
    void readTextPreviewFromUrl(resolvedSource, controller.signal)
      .then((text) => {
        setPreviewText(text);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setPreviewError(error instanceof Error ? error.message : "预览失败");
      })
      .finally(() => {
        setLoadingPreview(false);
      });

    return () => {
      controller.abort();
    };
  }, [isTextPreview, resolvedSource]);

  const handleShowInFinder = (): void => {
    void api.file.showInFinder(sourcePath, projectId).catch((error) => {
      message.error(
        error instanceof Error ? error.message : "无法在 Finder 中打开文件",
      );
    });
  };

  if (isTextPreview) {
    return (
      <div
        className={`chat-file-preview chat-file-preview--light ${user ? "chat-file-preview--user" : ""}`}
      >
        <div className="chat-file-preview__header">
          <span className="chat-file-preview__title">{fileName}</span>
          <button
            type="button"
            className="chat-file-preview__finder"
            onClick={handleShowInFinder}
          >
            <FolderOpenOutlined />在 Finder 中查看
          </button>
        </div>
        <pre className="chat-file-preview__content">
          {loadingPreview
            ? "正在加载文本预览..."
            : previewError || previewText || "文件为空"}
        </pre>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`chat-file-card ${user ? "chat-file-card--user" : ""}`}
      onClick={handleShowInFinder}
    >
      <span className="chat-file-card__icon">
        {attachment ? <PushpinOutlined /> : <FileOutlined />}
      </span>
      <span className="chat-file-card__body">
        <span className="chat-file-card__name">{fileName}</span>
        <span className="chat-file-card__hint">点击在 Finder 中查看</span>
      </span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const MarkdownMessage = memo(
  ({
    content,
    projectId,
    user,
    className,
  }: {
    content: string;
    projectId?: string;
    user: boolean;
    className?: string;
  }) => {
    const normalizedContent = useMemo(
      () => preprocessExtendedMediaMarkdown(content),
      [content],
    );

    return (
      <div
        className={`markdown-body chat-markdown ${user ? "chat-markdown--user" : "chat-markdown--assistant"} ${className ?? ""}`}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          urlTransform={(url) => url}
          components={{
            pre: ({ children }) => (
              <MarkdownPreBlock variant="chat">{children}</MarkdownPreBlock>
            ),
            code: ({ children, className }) => {
              const source = extractTextFromReactNode(children);
              const isBlock =
                Boolean(className?.includes("language-")) ||
                source.includes("\n");

              if (isBlock) {
                return <code className={className}>{children}</code>;
              }

              return (
                <code className="chat-markdown__inline-code">{children}</code>
              );
            },
            a: ({ children, href }) => {
              const rawHref = String(href ?? "");
              const extended = decodeExtendedMediaToken(rawHref);
              if (
                extended &&
                (extended.kind === "file" || extended.kind === "attachment")
              ) {
                return (
                  <FileReferenceCard
                    sourcePath={extended.sourcePath}
                    projectId={projectId}
                    user={user}
                    forceCardOnly={extended.kind === "attachment"}
                    attachment={extended.kind === "attachment"}
                  />
                );
              }

              const targetHref = resolveRenderableUrl(rawHref, projectId);
              if (!targetHref) {
                return <span>{children}</span>;
              }
              return (
                <a
                  href={targetHref}
                  onClick={(event) => {
                    event.preventDefault();
                    void openUrl(targetHref);
                  }}
                >
                  {children}
                </a>
              );
            },
            img: ({ src, alt }) => {
              const source = String(src ?? "");
              if (!source) return null;

              const extended = decodeExtendedMediaToken(source);
              if (
                extended &&
                (extended.kind === "file" || extended.kind === "attachment")
              ) {
                return (
                  <FileReferenceCard
                    sourcePath={extended.sourcePath}
                    projectId={projectId}
                    user={user}
                    forceCardOnly={extended.kind === "attachment"}
                    attachment={extended.kind === "attachment"}
                  />
                );
              }

              const { cleanAlt, width, height } = parseSizeFromAlt(
                String(alt ?? ""),
              );
              const altKind = cleanAlt.trim().toLowerCase();
              const rawSourcePath = extended?.sourcePath ?? source;
              const mediaKind =
                extended?.kind ??
                (altKind === "video" || altKind === "audio"
                  ? altKind
                  : (detectMarkdownMediaKindFromSource(rawSourcePath) ?? "image"));
              const resolvedSource = resolveRenderableUrl(
                rawSourcePath,
                projectId,
              );
              if (!resolvedSource) return null;

              if (mediaKind === "video") {
                return (
                  <video
                    controls
                    preload="metadata"
                    className="chat-markdown__media chat-markdown__media--video"
                    style={mediaSizeStyle(width, height)}
                    src={resolvedSource}
                  />
                );
              }
              if (mediaKind === "audio") {
                return (
                  <audio
                    controls
                    preload="metadata"
                    className="chat-markdown__audio"
                    src={resolvedSource}
                  />
                );
              }

              const normalizedAlt =
                cleanAlt && !cleanAlt.startsWith("__kian_media_")
                  ? cleanAlt
                  : "image";
              return (
                <RevealableImage
                  src={resolvedSource}
                  alt={normalizedAlt}
                  filePath={resolveRevealableImagePath(rawSourcePath)}
                  projectId={projectId}
                  className="chat-markdown__media chat-markdown__media--image"
                  imageClassName="chat-markdown__media-image"
                  style={mediaSizeStyle(width, height)}
                />
              );
            },
          }}
        >
          {normalizedContent}
        </ReactMarkdown>
      </div>
    );
  },
);
MarkdownMessage.displayName = "MarkdownMessage";

/** Renders a single tool call step during streaming. */
const ToolCallStep = memo(({ info }: { info: ToolCallInfo }) => {
  const isDone = info.status === "done";
  const hasDetails = Boolean(info.toolInput?.trim() || info.output?.trim());
  const [showAllOutput, setShowAllOutput] = useState(false);
  const outputPreview = useMemo(() => {
    const text = info.output?.trim() ?? "";
    if (!text) {
      return {
        fullText: "",
        previewText: "",
        truncated: false,
      };
    }
    const lines = text.split("\n");
    const truncated = lines.length > TOOL_OUTPUT_PREVIEW_MAX_LINES;
    return {
      fullText: text,
      previewText: truncated
        ? lines.slice(0, TOOL_OUTPUT_PREVIEW_MAX_LINES).join("\n")
        : text,
      truncated,
    };
  }, [info.output]);

  if (!hasDetails) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center leading-none">
          {isDone ? (
            <CheckCircleOutlined className="text-[11px] text-green-500" />
          ) : (
            <LoadingOutlined className="text-[11px] text-blue-500" />
          )}
        </span>
        <span className="text-[11px] font-medium leading-none text-slate-700">
          {info.toolName}
        </span>
      </div>
    );
  }

  return (
    <details className="w-full">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center leading-none">
          {isDone ? (
            <CheckCircleOutlined className="text-[11px] text-green-500" />
          ) : (
            <LoadingOutlined className="text-[11px] text-blue-500" />
          )}
        </span>
        <span className="text-[11px] font-medium leading-none text-slate-700">
          {info.toolName}
        </span>
      </summary>
      <div className="mt-2 w-full space-y-2 border-l-2 border-[#dbe5f5] pl-2">
        {info.toolInput?.trim() ? (
          <div>
            <div className="mb-1 text-[11px] font-medium text-slate-500">
              输入参数
            </div>
            <pre className="w-full overflow-x-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] leading-5 text-slate-700">
              {info.toolInput}
            </pre>
          </div>
        ) : null}
        {info.output?.trim() ? (
          <div>
            <div className="mb-1 text-[11px] font-medium text-slate-500">
              执行结果
            </div>
            {showAllOutput ? (
              <ScrollArea className="max-h-72 w-full">
                <pre className="w-full whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-2 py-1 pr-2 font-mono text-[11px] leading-5 text-slate-700">
                  {outputPreview.fullText}
                </pre>
              </ScrollArea>
            ) : (
              <pre className="w-full whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] leading-5 text-slate-700">
                {outputPreview.previewText}
              </pre>
            )}
            {!showAllOutput && outputPreview.truncated ? (
              <button
                type="button"
                className="mt-1 text-[11px] leading-none text-[#2f6ff7] hover:cursor-pointer hover:underline"
                onClick={() => setShowAllOutput(true)}
              >
                展示全部
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
});
ToolCallStep.displayName = "ToolCallStep";

const extractToolDisplayName = (content: string): string => {
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  const callMatch = firstLine.match(/^调用工具[:：]\s*(.+)$/);
  if (callMatch?.[1]) return formatToolDisplayName(callMatch[1].trim());

  const outputMatch = firstLine.match(/^工具输出（(.+?)）/);
  if (outputMatch?.[1]) return formatToolDisplayName(outputMatch[1].trim());

  const summaryMatch = firstLine.match(/^工具摘要[:：]\s*(.+)$/);
  if (summaryMatch?.[1]) return formatToolDisplayName(summaryMatch[1].trim());

  if (firstLine === "工具输出") return "工具";
  return formatToolDisplayName(firstLine || "工具");
};

interface ParsedToolCallJson {
  toolUseId?: string;
  toolName?: string;
  toolInput?: string;
  output?: string;
  status?: ToolCallInfo["status"];
}

const parseMessageMetadataJson = (
  raw: string | null | undefined,
): ChatMessageMetadata | null => {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ChatMessageMetadata;
    if (
      parsed.kind === "delegation" ||
      parsed.kind === "sub_agent_report" ||
      parsed.kind === "delegation_receipt" ||
      parsed.kind === "thinking"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const getDisplayMessageContent = (
  content: string,
  metadata: ChatMessageMetadata | null,
): string => {
  if (metadata?.kind === "sub_agent_report") {
    const normalized = content.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const trimmedFirst = lines[0]?.trim() ?? "";
    const trimmedSecond = lines[1]?.trim() ?? "";
    if (
      trimmedFirst.startsWith("来自 Agent ") &&
      trimmedSecond.startsWith("状态：")
    ) {
      return lines
        .slice(2)
        .join("\n")
        .replace(/^\s*\n+/, "")
        .trim();
    }
    return content;
  }

  if (metadata?.kind !== "delegation_receipt") {
    return content;
  }

  const filtered = content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed !== "" &&
        !trimmed.startsWith("委派编号：") &&
        !trimmed.startsWith("会话：") &&
        !trimmed.startsWith("模块：")
      );
    })
    .join("\n");

  return filtered.replace(
    /^已委派到 Agent\s+(.+?)(?:\s+\([^)]+\))?$/m,
    (_match, agentName: string) => `已委派给：**${agentName.trim()}**`,
  );
};

const getSubAgentReportSummary = (content: string): string => {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s*/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`([^`]+)`/g, "$1"),
    )
    .filter((line) => line.length > 0);
  const summary = lines.slice(0, 2).join(" ");
  if (!summary) {
    return "暂无摘要";
  }
  if (summary.length <= 110) {
    return summary;
  }
  return `${summary.slice(0, 109).trimEnd()}…`;
};

const formatThinkingQuoteMarkdown = (content: string): string =>
  content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

const SubAgentReportCard = memo(
  ({
    content,
    metadata,
    projectId,
  }: {
    content: string;
    metadata: ChatMessageMetadata | null;
    projectId?: string;
  }) => {
    const sourceLabel =
      metadata?.sourceProjectName?.trim() ||
      metadata?.sourceProjectId?.trim() ||
      "未知 Agent";
    const statusLabel = metadata?.status === "failed" ? "失败" : "已完成";
    const statusClassName =
      metadata?.status === "failed"
        ? "border-[#f3c7c2] bg-[#fff5f4] text-[#bb4d3e]"
        : "border-[#c5e4d2] bg-[#f6fcf8] text-[#2b6b4b]";
    const bodyContent = useMemo(
      () => getDisplayMessageContent(content, metadata),
      [content, metadata],
    );
    const summary = useMemo(
      () => getSubAgentReportSummary(bodyContent),
      [bodyContent],
    );

    return (
      <details className="group w-full rounded-2xl border border-[#d6e6ff] bg-[#eef5ff] px-3 py-3 text-slate-800">
        <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-[#bfd5ff] bg-white px-2 py-0.5 text-[11px] font-medium text-[#2458c7]">
                  子智能体 回报
                </span>
                <span className="inline-flex rounded-full border border-[#d5e1f5] bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {sourceLabel}
                </span>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClassName}`}
                >
                  {statusLabel}
                </span>
              </div>
              <p className="text-sm leading-6 text-slate-700 group-open:hidden">
                {summary}
              </p>
            </div>
            <span className="inline-flex flex-shrink-0 items-center gap-1 text-[11px] font-medium text-[#4d7bd6]">
              查看详情
              <ArrowUpOutlined className="rotate-180 transition-transform group-open:rotate-0" />
            </span>
          </div>
        </summary>
        <div className="mt-1 pt-1">
          <MarkdownMessage
            content={bodyContent}
            projectId={projectId}
            user={false}
          />
        </div>
      </details>
    );
  },
);
SubAgentReportCard.displayName = "SubAgentReportCard";

const ThinkingMessageCard = memo(
  ({
    content,
    projectId,
    title,
    active = false,
  }: {
    content: string;
    projectId?: string;
    title: string;
    active?: boolean;
  }) => (
    <details className="group w-full">
      <summary className="list-none [&::-webkit-details-marker]:hidden">
        <Tag
          key={`${active ? "active" : "idle"}-${title}`}
          className="i18n-no-translate !m-0 inline-flex cursor-pointer items-center gap-1 rounded-full border-[#e5d7ae] bg-[#fff7df] px-2 py-0.5 text-[11px] font-medium text-[#8a6b17]"
        >
          {active ? <LoadingOutlined className="text-[10px]" spin /> : null}
          <span>{title}</span>
          <ArrowUpOutlined className="text-[10px] transition-transform group-open:rotate-0 rotate-180" />
        </Tag>
      </summary>
      <div className="pt-2">
        <MarkdownMessage
          content={formatThinkingQuoteMarkdown(content)}
          projectId={projectId}
          user={false}
          className="[&_blockquote]:my-0 [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#e5d7ae] [&_blockquote]:bg-[#fffcf4] [&_blockquote]:py-1 [&_blockquote]:pl-3 [&_blockquote]:pr-0 [&_blockquote]:text-slate-500 [&_blockquote_p]:text-[12px] [&_blockquote_p]:italic [&_blockquote_p]:leading-5"
        />
      </div>
    </details>
  ),
);
ThinkingMessageCard.displayName = "ThinkingMessageCard";

const parseToolCallJson = (
  toolCallJson: string | null | undefined,
): ParsedToolCallJson => {
  const raw = toolCallJson?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const payload = parsed as {
      toolCall?: {
        toolUseId?: unknown;
        toolName?: unknown;
        input?: unknown;
        toolInput?: unknown;
        output?: unknown;
        status?: unknown;
      };
      toolUseId?: unknown;
      toolName?: unknown;
      input?: unknown;
      toolInput?: unknown;
      output?: unknown;
      status?: unknown;
    };
    const source =
      payload.toolCall && typeof payload.toolCall === "object"
        ? payload.toolCall
        : payload;
    const status = source.status;
    return {
      toolUseId:
        typeof source.toolUseId === "string" ? source.toolUseId : undefined,
      toolName:
        typeof source.toolName === "string" ? source.toolName : undefined,
      toolInput:
        typeof source.input === "string"
          ? source.input
          : typeof source.toolInput === "string"
            ? source.toolInput
            : undefined,
      output: typeof source.output === "string" ? source.output : undefined,
      status:
        status === "starting" || status === "running" || status === "done"
          ? status
          : undefined,
    };
  } catch {
    return {};
  }
};

const extractToolOutputFromContent = (content: string): string | undefined => {
  const match = content.match(/^工具输出(?:（.+?）)?\n([\s\S]*)$/);
  if (!match?.[1]) return undefined;
  return normalizeToolDetailText(match[1]);
};

const toToolCallInfoFromMessage = (item: ChatMessageDTO): ToolCallInfo => {
  const parsed = parseToolCallJson(item.toolCallJson);
  const toolName = formatToolDisplayName(
    parsed.toolName?.trim() || extractToolDisplayName(item.content),
  );
  return {
    toolUseId: parsed.toolUseId?.trim() || item.id,
    toolName,
    status: parsed.status ?? "done",
    toolInput: normalizeToolDetailText(parsed.toolInput),
    output:
      normalizeToolDetailText(parsed.output) ??
      extractToolOutputFromContent(item.content),
  };
};

interface ChatTimelineProps {
  projectId?: string;
  timelineBlocks: MessageBlock[];
  showStreamingPanel: boolean;
  showWorkingIndicator: boolean;
  streamingThinkingActive: boolean;
  streamError?: string;
  messageBottomRef: RefObject<HTMLDivElement | null>;
  thinkingMessageTitle: string;
  streamingThinkingTitle: string;
  workingIndicatorLabel: string;
  delegationReceiptLabel: string;
  delegationLabel: string;
}

const ThinkingIndicator = memo(({ label }: { label: string }) => (
  <div className="flex justify-start">
    <Tag className="i18n-no-translate !m-0 inline-flex items-center gap-1 rounded-full border-[#dbe5f5] bg-[#f8fbff] px-2 py-0.5 text-[11px] font-medium text-[#2f6ff7]">
      <LoadingOutlined className="text-[10px]" spin />
      <span>{label}</span>
    </Tag>
  </div>
));
ThinkingIndicator.displayName = "ThinkingIndicator";

const ChatTimeline = memo(
  ({
    projectId,
    timelineBlocks,
    showStreamingPanel,
    showWorkingIndicator,
    streamingThinkingActive,
    streamError,
    messageBottomRef,
    thinkingMessageTitle,
    streamingThinkingTitle,
    workingIndicatorLabel,
    delegationReceiptLabel,
    delegationLabel,
  }: ChatTimelineProps) => {
    if (timelineBlocks.length === 0 && !showStreamingPanel) {
      return null;
    }

    const shouldShowWorkingIndicator = showWorkingIndicator;
    const shouldShowStreamingThinkingState = streamingThinkingActive;

    return (
      <div className="flex flex-col gap-3">
        {timelineBlocks.map((block) => {
          if (block.type === "tool-group") {
            return (
              <div key={block.key} className="flex justify-start">
                <div className="w-full">
                  <div className="flex flex-col gap-2">
                    {block.tools.map((tool, index) => (
                      <ToolCallStep
                        key={`${tool.toolUseId}-${index}`}
                        info={tool}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          if (block.type === "streaming-thinking") {
            if (!block.content.trim()) {
              return null;
            }
            return (
              <div key={block.key} className="w-full">
                <ThinkingMessageCard
                  content={block.content}
                  projectId={projectId}
                  title={
                    shouldShowStreamingThinkingState
                      ? streamingThinkingTitle
                      : thinkingMessageTitle
                  }
                  active={shouldShowStreamingThinkingState}
                />
              </div>
            );
          }

          if (block.type === "streaming-assistant") {
            if (!block.content.trim()) {
              return null;
            }
            return (
              <div key={block.key} className="w-full">
                <div className="w-full text-slate-800">
                  <MarkdownMessage
                    content={block.content}
                    projectId={projectId}
                    user={false}
                  />
                </div>
              </div>
            );
          }

          const item = block.message;
          const isUser = item.role === "user";
          const messageMetadata = parseMessageMetadataJson(item.metadataJson);
          const displayContent = getDisplayMessageContent(
            item.content,
            messageMetadata,
          );
          const isDelegationCard =
            messageMetadata?.kind === "delegation" ||
            messageMetadata?.kind === "delegation_receipt";
          const isReportCard = messageMetadata?.kind === "sub_agent_report";
          const isThinkingCard = messageMetadata?.kind === "thinking";
          return (
            <div
              key={item.id}
              className={`flex ${isUser ? "justify-end" : "w-full"}`}
            >
              <div
                className={
                  isUser
                    ? "max-w-[88%] rounded-2xl rounded-br-md bg-[#2f6ff7] px-3 py-2 text-white"
                    : isDelegationCard
                      ? "w-full rounded-2xl border border-[#d9ece2] bg-[#f3fbf7] px-3 py-3 text-slate-800"
                      : isThinkingCard
                        ? "w-full"
                      : isReportCard
                        ? "w-full"
                        : "w-full text-slate-800"
                }
              >
                {isDelegationCard ? (
                  <div className="mb-2 inline-flex rounded-full border border-[#c5e4d2] bg-white px-2 py-0.5 text-[11px] font-medium text-[#2b6b4b]">
                    {messageMetadata?.kind === "delegation_receipt"
                      ? delegationReceiptLabel
                      : delegationLabel}
                  </div>
                ) : null}
                {isReportCard ? (
                  <SubAgentReportCard
                    content={item.content}
                    metadata={messageMetadata}
                    projectId={projectId}
                  />
                ) : isThinkingCard ? (
                  <ThinkingMessageCard
                    content={displayContent}
                    projectId={projectId}
                    title={thinkingMessageTitle}
                  />
                ) : (
                  <MarkdownMessage
                    content={displayContent}
                    projectId={projectId}
                    user={isUser}
                  />
                )}
              </div>
            </div>
          );
        })}

        {streamError ? (
          <div className="text-xs text-red-500">{streamError}</div>
        ) : null}
        <div
          ref={messageBottomRef}
          aria-hidden="true"
          className={`relative w-full ${shouldShowWorkingIndicator ? "py-2" : "h-px"}`}
        >
          {shouldShowWorkingIndicator ? (
            <div className="pointer-events-none w-full">
              <ThinkingIndicator label={workingIndicatorLabel} />
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);
ChatTimeline.displayName = "ChatTimeline";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const ModuleChatPane = ({
  projectId,
  scope,
  module,
  chatVariant = "project",
  acceptMainInputFocusEvents = true,
  contextSnapshot,
  hideBorder = false,
  sessionId: externalSessionId,
  onSessionCreated,
  layoutMode = "fill",
  emptyStateMode = "default",
  timelineMaxHeight,
  composerVariant = "default",
  sessionBootstrapMode = "default",
}: ModuleChatPaneProps) => {
  const { language } = useAppI18n();
  const t = useCallback(
    (value: string) => translateUiText(language, value),
    [language],
  );
  const effectiveScope = useMemo<ChatScope>(
    () =>
      scope ??
      ({
        type: "project",
        projectId: projectId ?? "",
      } as ChatScope),
    [projectId, scope],
  );
  const resolvedProjectId =
    effectiveScope.type === "project" ? effectiveScope.projectId : "";
  const docsQueryProjectId =
    effectiveScope.type === "main" ? MAIN_AGENT_SCOPE_ID : resolvedProjectId;
  const mediaProjectId =
    effectiveScope.type === "project"
      ? effectiveScope.projectId
      : MAIN_AGENT_SCOPE_ID;
  const scopeKey = getScopeKey(effectiveScope);
  const [input, setInput] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    undefined,
  );
  const [selectedThinkingLevel, setSelectedThinkingLevel] =
    useState<ChatThinkingLevel>("low");
  const [internalSessionId, setInternalSessionId] = useState<
    string | undefined
  >(undefined);
  const currentSessionId = externalSessionId ?? internalSessionId;
  const setCurrentSessionId = useCallback(
    (id: string | undefined) => {
      setInternalSessionId(id);
      if (id && onSessionCreated) {
        onSessionCreated(id);
      }
    },
    [onSessionCreated],
  );
  const [pendingUserMessages, setPendingUserMessages] = useState<
    ChatMessageDTO[]
  >([]);
  const [pendingFiles, setPendingFiles] = useState<LocalChatFile[]>([]);
  const [queuedSendPayloads, setQueuedSendPayloads] = useState<
    QueuedSendPayload[]
  >([]);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const thinkingLevelOptions = useMemo(
    () =>
      CHAT_THINKING_LEVEL_VALUES.map((value) => ({
        value,
        label:
          value === "low" ? t("低") : value === "medium" ? t("中") : t("高"),
      })),
    [t],
  );

  const sessionRef = useRef<string | undefined>(undefined);
  const chatInputContainerRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<string | undefined>(undefined);
  const messageBottomRef = useRef<HTMLDivElement | null>(null);
  const isBottomAnchorVisibleRef = useRef(true);
  const hasInitialBottomPositionedRef = useRef(false);
  const forceScrollToBottomRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFilesRef = useRef<LocalChatFile[]>([]);
  const hasHydratedThinkingLevelRef = useRef(false);
  const initializedScopeKeyRef = useRef<string | null>(null);

  const streamSession = useChatStreamStore((state) =>
    currentSessionId ? state.sessions[currentSessionId] : undefined,
  );
  const beginStreamRequest = useChatStreamStore((state) => state.beginRequest);
  const releaseStreamRequest = useChatStreamStore(
    (state) => state.releaseRequest,
  );
  const clearSessionStream = useChatStreamStore(
    (state) => state.clearSessionStream,
  );
  const streamingBlocks = streamSession?.streamingBlocks ?? [];
  const streamingInProgress = streamSession?.streamingInProgress ?? false;
  const streamingThinkingActive =
    streamSession?.streamingThinkingActive ?? false;
  const streamError = streamSession?.streamError;
  const activeRequestId = streamSession?.activeRequestId;

  const queryClient = useQueryClient();
  const generalConfigQuery = useQuery({
    queryKey: ["settings", "general"],
    queryFn: api.settings.getGeneralConfig,
  });
  const shortcutConfigQuery = useQuery({
    queryKey: ["settings", "shortcuts"],
    queryFn: api.settings.getShortcutConfig,
  });
  const claudeStatusQuery = useQuery({
    queryKey: ["settings", "claude", scopeKey],
    queryFn: () => api.settings.get(effectiveScope),
  });
  const legacyInputShortcutTipDismissed = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return (
        window.localStorage.getItem(
          LEGACY_CHAT_INPUT_SHORTCUT_TIP_DISMISSED_STORAGE_KEY,
        ) === "1"
      );
    } catch {
      return false;
    }
  }, []);
  const shortcutConfig = shortcutConfigQuery.data ?? DEFAULT_SHORTCUT_CONFIG;
  const showInputShortcutTip = generalConfigQuery.data
    ? !(
        generalConfigQuery.data.chatInputShortcutTipDismissed ||
        legacyInputShortcutTipDismissed
      )
    : false;
  const persistGeneralConfig = useCallback(
    async (
      overrides: Partial<
        Awaited<ReturnType<typeof api.settings.getGeneralConfig>>
      >,
    ) => {
      const currentConfig =
        generalConfigQuery.data ?? (await api.settings.getGeneralConfig());
      const nextConfig = {
        ...currentConfig,
        ...overrides,
        mainSubModeEnabled: true,
      };
      await api.settings.saveGeneralConfig(nextConfig);
      queryClient.setQueryData(["settings", "general"], nextConfig);
      return nextConfig;
    },
    [generalConfigQuery.data, queryClient],
  );
  useEffect(() => {
    if (
      !generalConfigQuery.data ||
      generalConfigQuery.data.chatInputShortcutTipDismissed ||
      !legacyInputShortcutTipDismissed
    ) {
      return;
    }

    void persistGeneralConfig({
      chatInputShortcutTipDismissed: true,
    }).catch(() => undefined);
  }, [
    generalConfigQuery.data,
    legacyInputShortcutTipDismissed,
    persistGeneralConfig,
  ]);
  const chatInputShortcutHint = useMemo<ReactNode>(
    () => (
      <span className="inline-flex items-center gap-1.5">
        <span role="img" aria-label="tip">
          💡
        </span>{" "}
        <strong>{formatKeyboardShortcut(shortcutConfig.sendMessage)}</strong>{" "}
        发送，
        <strong>
          {formatKeyboardShortcut(shortcutConfig.insertNewline)}
        </strong>{" "}
        换行。
      </span>
    ),
    [shortcutConfig],
  );
  const enabledModels = claudeStatusQuery.data?.allEnabledModels ?? [];
  const hasEnabledModels = enabledModels.length > 0;
  const hasHydratedSelectedModel = !hasEnabledModels || Boolean(selectedModel);

  useEffect(() => {
    if (claudeStatusQuery.data && !selectedModel) {
      const models = claudeStatusQuery.data.allEnabledModels;
      const saved = claudeStatusQuery.data.lastSelectedModel;
      // Restore saved model if it's still in the enabled list
      if (saved && models.some((m) => `${m.provider}:${m.modelId}` === saved)) {
        setSelectedModel(saved);
      } else {
        const first = models[0];
        if (first) setSelectedModel(`${first.provider}:${first.modelId}`);
      }
    }
  }, [claudeStatusQuery.data, selectedModel]);

  useEffect(() => {
    if (!claudeStatusQuery.data || hasHydratedThinkingLevelRef.current) return;
    const saved = claudeStatusQuery.data.lastSelectedThinkingLevel;
    if (saved && isChatThinkingLevel(saved)) {
      setSelectedThinkingLevel(saved);
    }
    hasHydratedThinkingLevelRef.current = true;
  }, [claudeStatusQuery.data]);

  // Reset state when project changes
  useEffect(() => {
    if (initializedScopeKeyRef.current === null) {
      initializedScopeKeyRef.current = scopeKey;
      return;
    }
    if (initializedScopeKeyRef.current === scopeKey) {
      return;
    }
    initializedScopeKeyRef.current = scopeKey;
    setInternalSessionId(undefined);
    setInput("");
    setIsComposing(false);
    setSelectedModel(undefined);
    setSelectedThinkingLevel("low");
    setPendingUserMessages([]);
    setQueuedSendPayloads([]);
    setIsCreatingSession(false);
    setPendingFiles((prev) => {
      revokePreviewUrls(prev);
      return [];
    });
    hasInitialBottomPositionedRef.current = false;
    forceScrollToBottomRef.current = false;
    isBottomAnchorVisibleRef.current = true;
    hasHydratedThinkingLevelRef.current = false;
  }, [scopeKey]);

  useEffect(() => {
    sessionRef.current = currentSessionId;
    // Clean up per-session transient state on session switch
    setPendingUserMessages([]);
    setQueuedSendPayloads([]);
    hasInitialBottomPositionedRef.current = false;
    isBottomAnchorVisibleRef.current = true;
  }, [currentSessionId]);
  useEffect(() => {
    requestRef.current = activeRequestId;
  }, [activeRequestId]);
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);
  useEffect(() => {
    return () => {
      revokePreviewUrls(pendingFilesRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Stream subscription
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const invalidateDocsQueries = (): void => {
      if (!docsQueryProjectId) return;
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["docs", docsQueryProjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["docs-explorer", docsQueryProjectId],
        }),
      ]);
    };

    const unsubscribe = api.chat.subscribeStream((event) => {
      if (!sessionRef.current || event.sessionId !== sessionRef.current) return;
      if (requestRef.current && event.requestId !== requestRef.current) return;
      if (event.type === "assistant_done" || event.type === "tool_output") {
        invalidateDocsQueries();
      }
    });

    return unsubscribe;
  }, [docsQueryProjectId, queryClient]);

  useEffect(() => {
    const unsubscribe = api.chat.subscribeHistoryUpdated(
      (event: ChatHistoryUpdatedEvent) => {
        if (!isSameScope(event.scope, effectiveScope)) return;
        if (!sessionRef.current || event.sessionId !== sessionRef.current)
          return;
        if (event.role === "assistant" && !requestRef.current) {
          clearSessionStream(event.sessionId);
        }
      },
    );
    return unsubscribe;
  }, [clearSessionStream, effectiveScope]);

  // ---------------------------------------------------------------------------
  // Session bootstrap
  // ---------------------------------------------------------------------------

  const sessionsQuery = useQuery({
    queryKey: ["chat-sessions", scopeKey],
    queryFn: () => api.chat.getSessions(effectiveScope),
    enabled: Boolean(scopeKey),
  });

  useEffect(() => {
    // When externally controlled, skip auto-bootstrap
    if (externalSessionId) return;
    if (sessionBootstrapMode === "lazy-new") return;

    const bootstrap = async (): Promise<void> => {
      if (!scopeKey) return;
      if (sessionsQuery.data && sessionsQuery.data.length > 0) {
        setCurrentSessionId(sessionsQuery.data[0].id);
        return;
      }
      if (!sessionsQuery.isFetched) return;

      const created = await api.chat.createSession({
        scope: effectiveScope,
        module,
        title: "",
      });
      setCurrentSessionId(created.id);
      queryClient.invalidateQueries({ queryKey: ["chat-sessions", scopeKey] });
    };
    void bootstrap();
  }, [
    chatVariant,
    effectiveScope,
    externalSessionId,
    module,
    queryClient,
    sessionBootstrapMode,
    scopeKey,
    setCurrentSessionId,
    sessionsQuery.data,
    sessionsQuery.isFetched,
  ]);

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  const messagesQuery = useQuery({
    queryKey: ["chat-messages", scopeKey, currentSessionId],
    queryFn: () =>
      api.chat.getMessages(effectiveScope, currentSessionId as string),
    enabled: Boolean(currentSessionId),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  const sendMutation = useMutation({
    mutationFn: async ({ sessionId, text, requestId, files }: SendPayload) => {
      let attachments: ChatAttachmentDTO[] | undefined;
      if (files.length > 0) {
        attachments = await api.chat.uploadFiles({
          scope: effectiveScope,
          files: files.map((file) => ({
            name: file.name,
            sourcePath: file.sourcePath,
            mimeType: file.mimeType,
            size: file.size,
          })),
        });
      }

      return api.chat.sendMessage({
        scope: effectiveScope,
        module,
        sessionId,
        requestId,
        message: text,
        model: selectedModel,
        thinkingLevel: selectedThinkingLevel,
        attachments,
        contextSnapshot,
      });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["chat-messages", scopeKey, variables.sessionId],
      });
      releaseStreamRequest(variables.sessionId, variables.requestId);
      const streamState =
        useChatStreamStore.getState().sessions[variables.sessionId];
      if (!streamState?.activeRequestId) {
        clearSessionStream(variables.sessionId);
      }
    },
    onError: async (error, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["chat-messages", scopeKey, variables.sessionId],
      });
      setPendingUserMessages((prev) =>
        prev.filter(
          (item) => item.id !== `pending-user-${variables.requestId}`,
        ),
      );
      releaseStreamRequest(variables.sessionId, variables.requestId);
      const streamState =
        useChatStreamStore.getState().sessions[variables.sessionId];
      if (!streamState?.activeRequestId) {
        clearSessionStream(variables.sessionId);
      }
      message.error(error instanceof Error ? error.message : "发送失败");
    },
  });

  const interruptMutation = useMutation({
    mutationFn: async ({
      sessionId,
      requestId,
    }: {
      sessionId: string;
      requestId?: string;
    }) =>
      api.chat.interrupt({
        scope: effectiveScope,
        sessionId,
        requestId,
      }),
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "打断失败");
    },
  });

  const messages = useMemo<ChatMessageDTO[]>(
    () => messagesQuery.data ?? [],
    [messagesQuery.data],
  );
  useEffect(() => {
    setPendingUserMessages((prev) => {
      const next = prev.filter(
        (item) => !hasPersistedPendingUserMessage(messages, item),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [messages]);

  const renderedMessages = useMemo<ChatMessageDTO[]>(() => {
    if (pendingUserMessages.length === 0) return messages;
    const optimisticMessages = pendingUserMessages.filter(
      (item) => !hasPersistedPendingUserMessage(messages, item),
    );
    if (optimisticMessages.length === 0) {
      return messages;
    }
    return [...messages, ...optimisticMessages];
  }, [messages, pendingUserMessages]);

  const timelineBlocks = useMemo<MessageBlock[]>(() => {
    const sortedMessages = renderedMessages
      .map((item, index) => ({ item, index }))
      .sort(
        (left, right) =>
          left.item.createdAt.localeCompare(right.item.createdAt) ||
          left.index - right.index,
      );
    const timelineItems: TimelineItem[] = [];
    let sortOrder = 0;

    for (const { item } of sortedMessages) {
      sortOrder += 1;
      if (item.role === "tool") {
        timelineItems.push({
          type: "tool",
          key: item.id,
          createdAt: item.createdAt,
          sortOrder,
          tool: toToolCallInfoFromMessage(item),
        });
        continue;
      }

      timelineItems.push({
        type: "message",
        key: item.id,
        createdAt: item.createdAt,
        sortOrder,
        message: item,
      });
    }

    for (const block of streamingBlocks) {
      sortOrder += 1;
      if (block.kind === "assistant") {
        timelineItems.push({
          type: "streaming-assistant",
          key: block.key,
          createdAt: block.createdAt,
          sortOrder,
          content: block.content,
        });
        continue;
      }

      if (block.kind === "thinking") {
        timelineItems.push({
          type: "streaming-thinking",
          key: block.key,
          createdAt: block.createdAt,
          sortOrder,
          content: block.content,
        });
        continue;
      }

      timelineItems.push({
        type: "tool",
        key: block.key,
        createdAt: block.createdAt,
        sortOrder,
        tool: block.tool,
      });
    }

    timelineItems.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.sortOrder - right.sortOrder,
    );

    const blocks: MessageBlock[] = [];
    let currentTools: Array<{
      key: string;
      createdAt: string;
      tool: ToolCallInfo;
    }> = [];

    const flushTools = (): void => {
      if (currentTools.length === 0) return;
      blocks.push({
        type: "tool-group",
        key: `tool-group-${currentTools[0].key}`,
        createdAt: currentTools[0].createdAt,
        tools: currentTools.map((item) => item.tool),
      });
      currentTools = [];
    };

    for (const item of timelineItems) {
      if (item.type === "tool") {
        currentTools.push(item);
        continue;
      }

      flushTools();
      if (item.type === "message") {
        blocks.push({
          type: "message",
          key: item.key,
          createdAt: item.createdAt,
          message: item.message,
        });
        continue;
      }

      if (item.type === "streaming-thinking") {
        blocks.push({
          type: "streaming-thinking",
          key: item.key,
          createdAt: item.createdAt,
          content: item.content,
        });
        continue;
      }

      blocks.push({
        type: "streaming-assistant",
        key: item.key,
        createdAt: item.createdAt,
        content: item.content,
      });
    }

    flushTools();
    return blocks;
  }, [renderedMessages, streamingBlocks]);

  const hasPendingAssistantReply = useMemo(() => {
    let waitingForAssistant = false;
    for (const item of renderedMessages) {
      if (item.role === "user") {
        waitingForAssistant = true;
        continue;
      }
      if (item.role === "assistant") {
        waitingForAssistant = false;
      }
    }
    return waitingForAssistant;
  }, [renderedMessages]);

  useEffect(() => {
    hasInitialBottomPositionedRef.current = false;
    isBottomAnchorVisibleRef.current = true;
  }, [currentSessionId]);

  const getMessageViewport = useCallback((): HTMLElement | null => {
    const anchor = messageBottomRef.current;
    if (!anchor) return null;
    const viewport = anchor.closest(".simplebar-content-wrapper");
    return viewport instanceof HTMLElement ? viewport : null;
  }, []);

  const isViewportNearBottom = useCallback((viewport: HTMLElement): boolean => {
    const distanceToBottom =
      viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight);
    return distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const viewport = getMessageViewport();
    if (!viewport) return;

    const syncBottomVisibility = (): void => {
      isBottomAnchorVisibleRef.current = isViewportNearBottom(viewport);
    };

    syncBottomVisibility();
    viewport.addEventListener("scroll", syncBottomVisibility, {
      passive: true,
    });

    return () => {
      viewport.removeEventListener("scroll", syncBottomVisibility);
    };
  }, [
    currentSessionId,
    getMessageViewport,
    isViewportNearBottom,
    renderedMessages.length,
    streamingBlocks.length,
    hasPendingAssistantReply,
  ]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior): void => {
      const viewport = getMessageViewport();
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior });
        return;
      }
      const anchor = messageBottomRef.current;
      if (!anchor) return;
      anchor.scrollIntoView({ block: "end", behavior });
    },
    [getMessageViewport],
  );

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const viewport = getMessageViewport();
    if (!viewport) return;
    const content = viewport.querySelector(".simplebar-content");
    if (!(content instanceof HTMLElement)) return;

    let rafId: number | undefined;
    const keepBottomWhenContentChanges = (): void => {
      if (!isBottomAnchorVisibleRef.current && !forceScrollToBottomRef.current)
        return;
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
    };

    const observer = new ResizeObserver(() => {
      keepBottomWhenContentChanges();
    });
    observer.observe(content);

    return () => {
      observer.disconnect();
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [
    currentSessionId,
    getMessageViewport,
    scrollToBottom,
    renderedMessages.length,
    streamingBlocks.length,
    hasPendingAssistantReply,
  ]);

  // Auto-scroll
  useLayoutEffect(() => {
    if (!messageBottomRef.current) return;
    const isInitialBottomPositioning = !hasInitialBottomPositionedRef.current;
    const shouldForceScroll = forceScrollToBottomRef.current;
    if (
      !shouldForceScroll &&
      !isInitialBottomPositioning &&
      !isBottomAnchorVisibleRef.current
    )
      return;
    const viewport = getMessageViewport();
    const distanceToBottom = viewport
      ? viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight)
      : 0;
    const shouldUseSmoothScroll =
      !shouldForceScroll &&
      !isInitialBottomPositioning &&
      !sendMutation.isPending &&
      !streamingInProgress &&
      !hasPendingAssistantReply &&
      distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    scrollToBottom(shouldUseSmoothScroll ? "smooth" : "auto");
    hasInitialBottomPositionedRef.current = true;
    forceScrollToBottomRef.current = false;
    isBottomAnchorVisibleRef.current = true;
  }, [
    getMessageViewport,
    hasPendingAssistantReply,
    renderedMessages,
    sendMutation.isPending,
    streamingBlocks,
    streamingInProgress,
    scrollToBottom,
  ]);

  // ---------------------------------------------------------------------------
  // Send handler
  // ---------------------------------------------------------------------------

  const handleSelectFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) {
      return;
    }

    const supportedFiles: LocalChatFile[] = [];
    for (const rawFile of selected) {
      const legacyPath = (rawFile as File & { path?: string }).path;
      const sourcePath = api.file.getPathForFile(rawFile) || legacyPath;
      if (!sourcePath) {
        message.error("当前环境无法读取文件路径");
        continue;
      }

      supportedFiles.push({
        key: `${sourcePath}:${rawFile.lastModified}:${rawFile.size}`,
        name: rawFile.name,
        sourcePath,
        size: rawFile.size,
        mimeType: rawFile.type || undefined,
        extension: getFileExtension(rawFile.name),
        previewUrl: isImageFile(rawFile.name, rawFile.type || undefined)
          ? URL.createObjectURL(rawFile)
          : undefined,
      });
    }

    if (supportedFiles.length > 0) {
      setPendingFiles((prev) => {
        const byKey = new Map(prev.map((item) => [item.key, item]));
        for (const file of supportedFiles) {
          const existing = byKey.get(file.key);
          if (existing) {
            if (file.previewUrl) {
              URL.revokeObjectURL(file.previewUrl);
            }
            continue;
          }
          byKey.set(file.key, file);
        }
        const merged = [...byKey.values()];
        if (merged.length <= 20) {
          return merged;
        }
        const overflow = merged.slice(20);
        revokePreviewUrls(overflow);
        return merged.slice(0, 20);
      });
    }

    // Allow picking the same file again later.
    event.target.value = "";
  };

  const handleRemovePendingFile = (key: string): void => {
    setPendingFiles((prev) => {
      const target = prev.find((item) => item.key === key);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.key !== key);
    });
  };

  const startSend = useCallback(
    (payload: SendPayload): void => {
      requestRef.current = payload.requestId;
      forceScrollToBottomRef.current = true;
      isBottomAnchorVisibleRef.current = true;
      beginStreamRequest(payload.sessionId, payload.requestId);
      sendMutation.mutate(payload);
    },
    [beginStreamRequest, sendMutation],
  );

  useEffect(() => {
    if (queuedSendPayloads.length === 0) return;
    if (
      sendMutation.isPending ||
      streamingInProgress ||
      Boolean(activeRequestId) ||
      interruptMutation.isPending
    ) {
      return;
    }
    const [nextPayload, ...rest] = queuedSendPayloads;
    setQueuedSendPayloads(rest);
    startSend(nextPayload);
  }, [
    activeRequestId,
    interruptMutation.isPending,
    queuedSendPayloads,
    sendMutation.isPending,
    startSend,
    streamingInProgress,
  ]);

  const handleSend = (): void => {
    void (async () => {
      const text = input.trim();
      const files = [...pendingFiles];
      if (
        (!text && files.length === 0) ||
        !hasHydratedSelectedModel ||
        isCreatingSession
      ) {
        return;
      }

      let sessionId = currentSessionId;
      if (!sessionId) {
        try {
          setIsCreatingSession(true);
          const created = await api.chat.createSession({
            scope: effectiveScope,
            module,
            title: "",
          });
          sessionId = created.id;
          setCurrentSessionId(created.id);
          void queryClient.invalidateQueries({
            queryKey: ["chat-sessions", scopeKey],
          });
        } catch (error) {
          message.error(error instanceof Error ? error.message : t("发送失败"));
          return;
        } finally {
          setIsCreatingSession(false);
        }
      }

      if (!sessionId) {
        return;
      }

      try {
        const latestSessions = await api.chat.getSessions(effectiveScope);
        const matchedSession = latestSessions.find(
          (session) => session.id === sessionId,
        );
        if (!matchedSession) {
          const fallbackSession =
            latestSessions[0] ??
            (await api.chat.createSession({
              scope: effectiveScope,
              module,
              title: "",
            }));
          sessionId = fallbackSession.id;
          setCurrentSessionId(fallbackSession.id);
          void queryClient.invalidateQueries({
            queryKey: ["chat-sessions", scopeKey],
          });
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : t("发送失败"));
        return;
      }

      const requestId =
        globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}`;
      setInput("");
      setPendingFiles((prev) => {
        revokePreviewUrls(prev);
        return [];
      });
      const nextPayload: QueuedSendPayload = {
        sessionId,
        text,
        requestId,
        files: files.map(({ previewUrl: _previewUrl, ...file }) => file),
        pendingMessage: {
          id: `pending-user-${requestId}`,
          sessionId,
          role: "user",
          content: formatDraftMessage(text, files),
          metadataJson: buildUserRequestMetadataJson(requestId),
          createdAt: new Date().toISOString(),
        },
      };
      setPendingUserMessages((prev) => [...prev, nextPayload.pendingMessage]);

      const hasActiveProcessing =
        sendMutation.isPending || streamingInProgress || Boolean(activeRequestId);
      if (hasActiveProcessing || interruptMutation.isPending) {
        setQueuedSendPayloads((prev) => [...prev, nextPayload]);
        const currentRequestId = requestRef.current ?? activeRequestId;
        if (currentRequestId && !interruptMutation.isPending) {
          interruptMutation.mutate({
            sessionId,
            requestId: currentRequestId,
          });
        }
        return;
      }

      startSend({
        sessionId,
        text,
        requestId,
        files: nextPayload.files,
      });
    })();
  };

  const handleInterrupt = (): void => {
    const sessionId = currentSessionId;
    if (!sessionId || interruptMutation.isPending) return;
    const requestId = requestRef.current ?? activeRequestId;
    if (!requestId) {
      if (queuedSendPayloads.length === 0) return;
      const queuedIds = new Set(
        queuedSendPayloads.map((item) => item.pendingMessage.id),
      );
      setQueuedSendPayloads([]);
      setPendingUserMessages((prev) =>
        prev.filter((item) => !queuedIds.has(item.id)),
      );
      return;
    }
    interruptMutation.mutate({
      sessionId,
      requestId,
    });
  };

  const handleDismissInputShortcutTip = (): void => {
    if (generalConfigQuery.data?.chatInputShortcutTipDismissed) {
      return;
    }

    const previousConfig = generalConfigQuery.data;
    if (previousConfig) {
      queryClient.setQueryData(["settings", "general"], {
        ...previousConfig,
        chatInputShortcutTipDismissed: true,
      });
    }

    void persistGeneralConfig({
      chatInputShortcutTipDismissed: true,
    }).catch((error) => {
      if (previousConfig) {
        queryClient.setQueryData(["settings", "general"], previousConfig);
      }
      message.error(
        error instanceof Error
          ? error.message
          : t("快捷键提示关闭状态保存失败"),
      );
    });
  };

  const focusChatInput = useCallback((): void => {
    const textarea = chatInputContainerRef.current?.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return;
    }
    textarea.focus();
    const cursorPosition = textarea.value.length;
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  }, []);

  useEffect(() => {
    if (chatVariant !== "main" || !acceptMainInputFocusEvents) {
      return;
    }

    const handleFocusRequest = (): void => {
      window.requestAnimationFrame(() => {
        focusChatInput();
      });
    };

    window.addEventListener(MAIN_AGENT_INPUT_FOCUS_EVENT, handleFocusRequest);
    return () => {
      window.removeEventListener(
        MAIN_AGENT_INPUT_FOCUS_EVENT,
        handleFocusRequest,
      );
    };
  }, [acceptMainInputFocusEvents, chatVariant, focusChatInput]);

  const insertNewlineAtCursor = useCallback((target: HTMLTextAreaElement) => {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const nextValue =
      target.value.slice(0, start) + "\n" + target.value.slice(end);
    setInput(nextValue);
    window.requestAnimationFrame(() => {
      target.focus();
      const nextCursorPosition = start + 1;
      target.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }, []);

  const canSend =
    (sessionBootstrapMode === "lazy-new" || Boolean(currentSessionId)) &&
    (input.trim().length > 0 || pendingFiles.length > 0) &&
    hasHydratedSelectedModel &&
    !isCreatingSession;
  const canInterrupt =
    Boolean(currentSessionId) &&
    ((sendMutation.isPending &&
      sendMutation.variables?.sessionId === currentSessionId) ||
      streamingInProgress ||
      Boolean(activeRequestId) ||
      queuedSendPayloads.length > 0) &&
    !interruptMutation.isPending;
  const showStreamingPanel =
    (sendMutation.isPending &&
      sendMutation.variables?.sessionId === currentSessionId) ||
    streamingInProgress ||
    hasPendingAssistantReply;
  const showWorkingIndicator = showStreamingPanel && !streamingThinkingActive;
  const isAutoLayout = layoutMode === "auto";
  const rootClassName = isAutoLayout
    ? "flex min-h-0 justify-center"
    : "flex h-full min-h-0 justify-center";
  const chatContainerBaseClassName = isAutoLayout
    ? "w-full flex min-h-0 flex-col"
    : "w-full flex h-full min-h-0 flex-col";
  const timelineContainerClassName = isAutoLayout
    ? hideBorder
      ? "p-3 pb-0"
      : "rounded-lg border border-[#e2e8f5] bg-white p-3 pb-0"
    : hideBorder
      ? "min-h-0 flex-1 p-3 pb-0"
      : "min-h-0 flex-1 rounded-lg border border-[#e2e8f5] bg-white p-3 pb-0";

  const composer = (
    <ChatComposer
      variant={composerVariant}
      pendingFiles={pendingFiles}
      onRemovePendingFile={handleRemovePendingFile}
      showInputShortcutTip={showInputShortcutTip}
      chatInputShortcutHint={chatInputShortcutHint}
      onDismissInputShortcutTip={handleDismissInputShortcutTip}
      dismissShortcutTipLabel={t("不再提示")}
      inputContainerRef={chatInputContainerRef}
      input={input}
      isComposing={isComposing}
      onInputChange={setInput}
      onCompositionStart={() => setIsComposing(true)}
      onCompositionEnd={(value) => {
        setIsComposing(false);
        setInput(value);
      }}
      onInputKeyDown={(event) => {
        if ((event.nativeEvent as KeyboardEvent).isComposing || isComposing) {
          return;
        }

        if (
          matchesKeyboardShortcut(event.nativeEvent, shortcutConfig.sendMessage)
        ) {
          event.preventDefault();
          event.stopPropagation();
          handleSend();
          return;
        }

        if (
          matchesKeyboardShortcut(
            event.nativeEvent,
            shortcutConfig.insertNewline,
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          insertNewlineAtCursor(event.currentTarget);
        }
      }}
      placeholder={
        canInterrupt
          ? t("继续发送消息修正我的行为...")
          : t("有什么吩咐...")
      }
      fileInputRef={fileInputRef}
      onSelectFiles={handleSelectFiles}
      fileAccept={SUPPORTED_FILE_ACCEPT}
      addFileLabel={t("添加文件")}
      removeFileLabel={(fileName) => t(`移除文件 ${fileName}`)}
      selectedModel={selectedModel}
      modelOptions={enabledModels.map((m) => ({
        label: stripProviderPrefixFromModelName(m.modelName),
        value: `${m.provider}:${m.modelId}`,
      }))}
      onModelChange={(value) => {
        setSelectedModel(value);
        queryClient.setQueryData(
          ["settings", "claude", scopeKey],
          (
            previous:
              | Awaited<ReturnType<typeof api.settings.get>>
              | undefined,
          ) =>
            previous
              ? {
                  ...previous,
                  lastSelectedModel: value,
                }
              : previous,
        );
        api.settings.setLastSelectedModel(effectiveScope, value).catch(() => {});
      }}
      selectedThinkingLevel={selectedThinkingLevel}
      onThinkingLevelChange={(value) => {
        setSelectedThinkingLevel(value);
        queryClient.setQueryData(
          ["settings", "claude", scopeKey],
          (
            previous:
              | Awaited<ReturnType<typeof api.settings.get>>
              | undefined,
          ) =>
            previous
              ? {
                  ...previous,
                  lastSelectedThinkingLevel: value,
                }
              : previous,
        );
        api.settings
          .setLastSelectedThinkingLevel(effectiveScope, value)
          .catch(() => {});
      }}
      thinkingLevelOptions={thinkingLevelOptions}
      thinkingLevelMenuHeader={t("思考等级")}
      canInterrupt={canInterrupt}
      interruptLoading={interruptMutation.isPending}
      onInterrupt={handleInterrupt}
      sendLoading={sendMutation.isPending || isCreatingSession}
      onSend={handleSend}
      canSend={canSend}
    />
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isEmpty = timelineBlocks.length === 0 && !showStreamingPanel;
  const showEmptyState = emptyStateMode === "default" && isEmpty;
  const chatContainerClassName =
    !isAutoLayout && emptyStateMode === "hidden" && isEmpty
      ? `${chatContainerBaseClassName} justify-end`
      : chatContainerBaseClassName;
  const timelineStyle = isAutoLayout
    ? timelineMaxHeight
      ? { maxHeight: timelineMaxHeight }
      : undefined
    : undefined;

  return (
    <div className={rootClassName}>
      <div className={chatContainerClassName}>
        {showEmptyState ? (
          <div
            className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-3 select-none ${hideBorder ? "" : "rounded-lg border border-[#e2e8f5] bg-white"}`}
          >
            <svg
              width="64"
              height="64"
              viewBox="0 0 64 64"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="opacity-30"
            >
              <rect
                x="6"
                y="12"
                width="30"
                height="20"
                rx="6"
                stroke="#94a3b8"
                strokeWidth="1.2"
              />
              <path
                d="M12 32 L12 38 L19 32"
                stroke="#94a3b8"
                strokeWidth="1.2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="15" cy="22" r="1.5" fill="#94a3b8" />
              <circle cx="21" cy="22" r="1.5" fill="#94a3b8" />
              <circle cx="27" cy="22" r="1.5" fill="#94a3b8" />
              <rect
                x="28"
                y="28"
                width="30"
                height="20"
                rx="6"
                stroke="#94a3b8"
                strokeWidth="1.2"
              />
              <path
                d="M52 48 L52 54 L45 48"
                stroke="#94a3b8"
                strokeWidth="1.2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect
                x="35"
                y="36"
                width="16"
                height="2"
                rx="1"
                fill="#94a3b8"
                opacity="0.5"
              />
              <rect
                x="35"
                y="41"
                width="10"
                height="2"
                rx="1"
                fill="#94a3b8"
                opacity="0.35"
              />
            </svg>
            <span className="text-[13px] text-slate-400/70">
              有什么可以帮你的吗？
            </span>
          </div>
        ) : !isEmpty ? (
          <ScrollArea
            className={timelineContainerClassName}
            style={timelineStyle}
          >
            <ChatTimeline
              projectId={mediaProjectId}
              timelineBlocks={timelineBlocks}
              showStreamingPanel={showStreamingPanel}
              showWorkingIndicator={showWorkingIndicator}
              streamingThinkingActive={streamingThinkingActive}
              streamError={streamError}
              messageBottomRef={messageBottomRef}
              thinkingMessageTitle={t("思考过程")}
              streamingThinkingTitle={t("正在思考中...")}
              workingIndicatorLabel={t("努力工作中")}
              delegationReceiptLabel={t("主 Agent 委派回执")}
              delegationLabel={t("来自主 Agent 的委派")}
            />
          </ScrollArea>
        ) : null}

        <div className="z-10 mt-2">{composer}</div>
      </div>
    </div>
  );
};
