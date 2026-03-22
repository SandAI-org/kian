import path from 'node:path';
import type { ChatAttachmentDTO, ChatScope } from '@shared/types';
import {
  detectMarkdownMediaKindFromSource,
  rewriteBareRemoteMediaUrlsInMarkdown,
} from '@shared/utils/markdownMedia';
import { INTERNAL_ROOT, WORKSPACE_ROOT } from './workspacePaths';

export type MediaKind = 'image' | 'video' | 'audio';
export type ExtendedMarkdownKind = MediaKind | 'file' | 'attachment';
export interface ExtendedMarkdownToken {
  kind: ExtendedMarkdownKind;
  hint?: string;
  path: string;
  raw: string;
  index: number;
}

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.avif',
  '.heic',
  '.heif'
]);
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.avi',
  '.mkv',
  '.flv',
  '.wmv',
  '.m3u8'
]);
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.opus'
]);

const normalizePathLike = (value: string): string => value.replace(/^<|>$/g, '').trim();
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALL_MEDIA_EXTENSIONS = [...new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS])];
const MEDIA_PATH_PATTERN = new RegExp(
  `(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/)[^\\s<>"'\\\`]+?(?:${ALL_MEDIA_EXTENSIONS.map(escapeRegex).join('|')})`,
  'gi'
);
const EXTENDED_MARKDOWN_PATTERN =
  /@\[(image|video|audio|file|attachment)(?:\|([^\]]*))?\]\(([^)\n]+)\)/gi;
const MARKDOWN_DESTINATION_PATTERN = /\]\(([^)\n]+)\)/g;

const getScopeRootDir = (scope: ChatScope): string =>
  scope.type === 'main'
    ? path.join(INTERNAL_ROOT, 'main-agent')
    : path.join(WORKSPACE_ROOT, scope.projectId);

export const resolveAttachmentAbsolutePath = (scope: ChatScope, filePath: string): string => {
  const normalized = normalizePathLike(filePath);
  if (!normalized) return '';
  if (path.isAbsolute(normalized)) {
    return path.normalize(normalized);
  }
  return path.resolve(getScopeRootDir(scope), normalized);
};

export const detectAttachmentMediaKind = (attachment: Pick<ChatAttachmentDTO, 'name' | 'path' | 'mimeType'>): MediaKind | null => {
  const mime = attachment.mimeType?.toLowerCase().trim();
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';

  const ext = path.extname(attachment.path || attachment.name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return null;
};

export const detectAttachmentMarkdownKind = (
  attachment: Pick<ChatAttachmentDTO, 'name' | 'path' | 'mimeType'>
): ExtendedMarkdownKind => detectAttachmentMediaKind(attachment) ?? 'file';

export const buildExtendedMarkdown = (kind: ExtendedMarkdownKind, filePath: string): string =>
  `@[${kind}](${filePath})`;

export const buildMediaMarkdown = (kind: MediaKind, filePath: string): string =>
  buildExtendedMarkdown(kind, filePath);

export const buildFileMarkdown = (filePath: string): string =>
  buildExtendedMarkdown('file', filePath);

export const buildAttachmentMarkdown = (filePath: string): string =>
  buildExtendedMarkdown('attachment', filePath);

export const detectMediaKindFromPath = (filePath: string): MediaKind | null => {
  return detectMarkdownMediaKindFromSource(filePath);
};

export const normalizeMediaMarkdownInText = (content: string): string => {
  if (!content.trim()) return content;

  const rewrittenRemoteMedia = rewriteBareRemoteMediaUrlsInMarkdown(
    content,
    (kind, url) => buildMediaMarkdown(kind, url)
  );

  let inFenceBlock = false;
  const lines = rewrittenRemoteMedia.split('\n').map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```')) {
      inFenceBlock = !inFenceBlock;
      return line;
    }
    if (inFenceBlock) return line;

    const protectedRanges = Array.from(line.matchAll(MARKDOWN_DESTINATION_PATTERN)).map((match) => {
      const fullMatch = match[0];
      const matchIndex = match.index ?? -1;
      const pathIndex = fullMatch.indexOf('(');
      const path = match[1] ?? '';
      return {
        start: matchIndex + pathIndex + 1,
        end: matchIndex + pathIndex + 1 + path.length
      };
    });

    return line.replace(MEDIA_PATH_PATTERN, (match, offset, source) => {
      const index = typeof offset === 'number' ? offset : source.indexOf(match);
      const before = source.slice(Math.max(0, index - 2), index);
      if (before === '](') {
        return match;
      }
      if (protectedRanges.some((range) => index >= range.start && index < range.end)) {
        return match;
      }

      const kind = detectMediaKindFromPath(match);
      if (!kind) return match;
      return buildMediaMarkdown(kind, match);
    });
  });

  return lines.join('\n');
};

export const extractExtendedMarkdownTokens = (content: string): ExtendedMarkdownToken[] => {
  if (!content || !content.trim()) return [];

  const tokens: ExtendedMarkdownToken[] = [];
  for (const match of content.matchAll(EXTENDED_MARKDOWN_PATTERN)) {
    const kindRaw = match[1]?.toLowerCase().trim();
    const hintRaw = match[2]?.trim();
    const pathRaw = match[3];
    if (!kindRaw || !pathRaw) continue;
    if (kindRaw !== 'image' && kindRaw !== 'video' && kindRaw !== 'audio' && kindRaw !== 'file' && kindRaw !== 'attachment') {
      continue;
    }

    const normalizedPath = normalizePathLike(pathRaw);
    if (!normalizedPath) continue;
    tokens.push({
      kind: kindRaw,
      ...(hintRaw ? { hint: hintRaw } : {}),
      path: normalizedPath,
      raw: match[0],
      index: match.index ?? 0
    });
  }
  return tokens;
};
