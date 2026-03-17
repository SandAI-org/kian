const LOCAL_MEDIA_SCHEME_PREFIX = "kian-local://local/";
const WINDOWS_ABS = /^[a-zA-Z]:[\\/]/;
const UNSAFE_URL = /^(?:javascript|vbscript):/i;
const PASSTHROUGH_URL = /^(?:https?|file|data|blob|mailto|tel|kian-local):/i;

const IMAGE_EXTS = new Set([
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
const VIDEO_EXTS = new Set([
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
const AUDIO_EXTS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
]);

export type DocMediaKind = "image" | "video" | "audio" | null;

const splitPathSuffix = (value: string): { path: string; suffix: string } => {
  const hashIndex = value.indexOf("#");
  const queryIndex = value.indexOf("?");
  const suffixIndex =
    hashIndex < 0
      ? queryIndex
      : queryIndex < 0
        ? hashIndex
        : Math.min(hashIndex, queryIndex);

  if (suffixIndex < 0) {
    return { path: value, suffix: "" };
  }

  return {
    path: value.slice(0, suffixIndex),
    suffix: value.slice(suffixIndex),
  };
};

export const detectDocMediaKind = (src: string): DocMediaKind => {
  const { path } = splitPathSuffix(src);
  const dot = path.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = path.slice(dot).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return null;
};

export const isDocPassthroughUrl = (rawUrl: string): boolean =>
  PASSTHROUGH_URL.test(rawUrl.trim());

export const toLocalMediaUrl = (
  filePath: string,
  options?: { projectId?: string; documentPath?: string },
): string => {
  const base = `${LOCAL_MEDIA_SCHEME_PREFIX}${encodeURIComponent(filePath)}`;
  const searchParams = new URLSearchParams();
  const normalizedProjectId = options?.projectId?.trim();
  if (normalizedProjectId) {
    searchParams.set("projectId", normalizedProjectId);
  }
  const normalizedDocumentPath = options?.documentPath?.trim();
  if (normalizedDocumentPath) {
    searchParams.set("documentPath", normalizedDocumentPath);
  }
  const query = searchParams.toString();
  return query ? `${base}?${query}` : base;
};

export const resolveDocLocalUrl = (
  rawUrl: string,
  options?: { projectId?: string; documentPath?: string },
): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (UNSAFE_URL.test(trimmed)) return "";
  if (isDocPassthroughUrl(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || WINDOWS_ABS.test(trimmed) || trimmed.startsWith("\\\\")) {
    return toLocalMediaUrl(trimmed, options);
  }
  return toLocalMediaUrl(trimmed, options);
};
