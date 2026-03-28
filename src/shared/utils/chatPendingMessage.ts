import type { ChatMessageDTO } from '../types';

const USER_REQUEST_METADATA_KIND = 'user_request';
const EXTENDED_MEDIA_PATTERN =
  /@\[(image|video|audio|file|attachment)(?:\|([^\]]*))?\]\(([^)\n]+)\)/gi;

const stripWrappedPath = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
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

const getPathFileName = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || value;
};

const normalizeMessageContentForComparison = (content: string): string =>
  content
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(
      EXTENDED_MEDIA_PATTERN,
      (_full, kindRaw: string, sizeRaw: string | undefined, pathRaw: string) => {
        const normalizedKind =
          kindRaw.toLowerCase() === 'attachment'
            ? 'file'
            : kindRaw.toLowerCase();
        const normalizedPath = stripWrappedPath(pathRaw);
        const fileName = getPathFileName(normalizedPath);
        const sizeSuffix = sizeRaw?.trim() ? `|${sizeRaw.trim()}` : '';
        return `@[${normalizedKind}${sizeSuffix}](${fileName})`;
      }
    );

export const buildUserRequestMetadataJson = (
  requestId: string,
  requestStartedAt?: string,
): string =>
  JSON.stringify({
    kind: USER_REQUEST_METADATA_KIND,
    requestId,
    requestStartedAt,
  });

export const extractUserRequestIdFromMetadataJson = (
  raw: string | null | undefined
): string | null => {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { kind?: unknown; requestId?: unknown };
    if (
      parsed.kind === USER_REQUEST_METADATA_KIND &&
      typeof parsed.requestId === 'string' &&
      parsed.requestId.trim()
    ) {
      return parsed.requestId.trim();
    }
  } catch {
    return null;
  }
  return null;
};

export const hasPersistedPendingUserMessage = (
  messages: ChatMessageDTO[],
  pendingUserMessage: ChatMessageDTO
): boolean => {
  const pendingRequestId = extractUserRequestIdFromMetadataJson(
    pendingUserMessage.metadataJson
  );
  if (pendingRequestId) {
    const matchedByRequestId = messages.some((item) => {
      if (item.role !== 'user') return false;
      return (
        extractUserRequestIdFromMetadataJson(item.metadataJson) ===
        pendingRequestId
      );
    });
    if (matchedByRequestId) {
      return true;
    }
  }

  const pendingCreatedAt = Date.parse(pendingUserMessage.createdAt);
  const pendingContent = normalizeMessageContentForComparison(
    pendingUserMessage.content
  );
  return messages.some((item) => {
    if (item.role !== 'user') return false;
    if (!Number.isFinite(pendingCreatedAt)) {
      return (
        normalizeMessageContentForComparison(item.content) === pendingContent
      );
    }
    const messageCreatedAt = Date.parse(item.createdAt);
    if (!Number.isFinite(messageCreatedAt)) return false;
    if (normalizeMessageContentForComparison(item.content) !== pendingContent) {
      return false;
    }
    return Math.abs(messageCreatedAt - pendingCreatedAt) <= 5_000;
  });
};
