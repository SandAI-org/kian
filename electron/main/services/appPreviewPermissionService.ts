import { session, systemPreferences } from 'electron';
import { logger } from './logger';
import { APP_PREVIEW_PARTITION } from './appPreviewWindowService';

const PREVIEW_ORIGIN_PREFIX = 'kian-local://local';
const APP_SHELL_ORIGIN_PREFIXES = [
  'file://',
  'http://localhost',
  'http://127.0.0.1',
  'https://localhost',
  'https://127.0.0.1',
];

const isPreviewOrigin = (value: string | null | undefined): boolean => {
  if (!value) return false;
  return value === PREVIEW_ORIGIN_PREFIX || value.startsWith(`${PREVIEW_ORIGIN_PREFIX}/`);
};

const isAppShellOrigin = (value: string | null | undefined): boolean => {
  if (!value) return false;
  return APP_SHELL_ORIGIN_PREFIXES.some((prefix) => value.startsWith(prefix));
};

const isMediaPermission = (permission: string): boolean =>
  permission === 'media' || permission === 'display-capture';

const normalizeMediaType = (mediaType: string): 'audio' | 'video' | null => {
  const normalized = mediaType.trim().toLowerCase();
  if (normalized.includes('audio')) return 'audio';
  if (normalized.includes('video')) return 'video';
  return null;
};

const hasAllowedMediaTypes = (mediaTypes: string[] | undefined): boolean => {
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) {
    return true;
  }
  // Electron versions may return values like "audioCapture"/"videoCapture".
  return mediaTypes.every((mediaType) => normalizeMediaType(mediaType) !== null);
};

const toRequiredMacMediaKinds = (
  mediaTypes: string[] | undefined,
): Array<'camera' | 'microphone'> => {
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) {
    return ['camera', 'microphone'];
  }

  const normalizedTypes = new Set(
    mediaTypes
      .map((mediaType) => normalizeMediaType(mediaType))
      .filter((mediaType): mediaType is 'audio' | 'video' => mediaType !== null),
  );

  const kinds: Array<'camera' | 'microphone'> = [];
  if (normalizedTypes.has('video')) {
    kinds.push('camera');
  }
  if (normalizedTypes.has('audio')) {
    kinds.push('microphone');
  }
  if (kinds.length === 0) {
    return ['camera', 'microphone'];
  }
  return kinds;
};

const ensureMacMediaAccess = async (
  mediaTypes: string[] | undefined,
): Promise<boolean> => {
  if (process.platform !== 'darwin') {
    return true;
  }

  const requiredKinds = toRequiredMacMediaKinds(mediaTypes);
  for (const kind of requiredKinds) {
    const status = systemPreferences.getMediaAccessStatus(kind);
    if (status === 'granted') {
      continue;
    }
    if (status !== 'not-determined') {
      return false;
    }
    const granted = await systemPreferences.askForMediaAccess(kind);
    if (!granted) {
      return false;
    }
  }
  return true;
};

const toOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const toOptionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
};

const isPreviewRequest = (input: {
  requestingOrigin?: string;
  embeddingOrigin?: string;
  webContentsUrl?: string;
}): boolean =>
  isPreviewOrigin(input.requestingOrigin) ||
  isPreviewOrigin(input.embeddingOrigin) ||
  isPreviewOrigin(input.webContentsUrl);

export const registerAppPreviewPermissionService = (): void => {
  const managedSessions = Array.from(
    new Set(
      [session.defaultSession, session.fromPartition(APP_PREVIEW_PARTITION)].filter(
        (value): value is Electron.Session => Boolean(value),
      ),
    ),
  );
  if (managedSessions.length === 0) return;

  for (const managedSession of managedSessions) {
    managedSession.setPermissionCheckHandler(
      (webContents, permission, requestingOrigin, details) => {
        if (!isMediaPermission(permission)) {
          return false;
        }

        const mediaType =
          details && 'mediaType' in details && typeof details.mediaType === 'string'
            ? details.mediaType
            : undefined;
        const mediaTypes = mediaType ? [mediaType] : undefined;
        const requestingUrl =
          details && 'requestingUrl' in details && typeof details.requestingUrl === 'string'
            ? details.requestingUrl
            : undefined;
        const securityOrigin =
          details && 'securityOrigin' in details && typeof details.securityOrigin === 'string'
            ? details.securityOrigin
            : undefined;

        const allowedByOrigin = isPreviewRequest({
          requestingOrigin,
          embeddingOrigin: undefined,
          webContentsUrl: webContents?.getURL(),
        }) ||
        isPreviewOrigin(requestingUrl) ||
        isPreviewOrigin(securityOrigin) ||
        isAppShellOrigin(requestingOrigin) ||
        isAppShellOrigin(requestingUrl) ||
        isAppShellOrigin(securityOrigin) ||
        isAppShellOrigin(webContents?.getURL());

        if (!allowedByOrigin) {
          logger.warn('Denied media permission check by origin gate', {
            permission,
            requestingOrigin,
            requestingUrl,
            securityOrigin,
            webContentsUrl: webContents?.getURL(),
            mediaType,
          });
          return false;
        }

        if (!hasAllowedMediaTypes(mediaTypes)) {
          logger.warn('Denied media permission check by mediaType gate', {
            permission,
            requestingOrigin,
            requestingUrl,
            securityOrigin,
            webContentsUrl: webContents?.getURL(),
            mediaType,
          });
          return false;
        }

        return true;
      },
    );

    managedSession.setPermissionRequestHandler(
      (webContents, permission, callback, details) => {
        if (!isMediaPermission(permission)) {
          callback(false);
          return;
        }

        const requestingOrigin =
          'requestingOrigin' in details
            ? toOptionalString(details.requestingOrigin)
            : undefined;
        const embeddingOrigin =
          'embeddingOrigin' in details
            ? toOptionalString(details.embeddingOrigin)
            : undefined;
        const mediaTypes =
          'mediaTypes' in details
            ? toOptionalStringArray(details.mediaTypes)
            : undefined;
        const requestingUrl =
          'requestingUrl' in details
            ? toOptionalString(details.requestingUrl)
            : undefined;
        const securityOrigin =
          'securityOrigin' in details
            ? toOptionalString(details.securityOrigin)
            : undefined;
        const allowedByOrigin = isPreviewRequest({
          requestingOrigin,
          embeddingOrigin,
          webContentsUrl: webContents?.getURL(),
        }) ||
        isPreviewOrigin(requestingUrl) ||
        isPreviewOrigin(securityOrigin) ||
        isAppShellOrigin(requestingOrigin) ||
        isAppShellOrigin(embeddingOrigin) ||
        isAppShellOrigin(requestingUrl) ||
        isAppShellOrigin(securityOrigin) ||
        isAppShellOrigin(webContents?.getURL());
        if (!allowedByOrigin) {
          logger.warn('Denied media permission by origin gate', {
            permission,
            requestingOrigin,
            embeddingOrigin,
            requestingUrl,
            securityOrigin,
            webContentsUrl: webContents?.getURL(),
            mediaTypes,
          });
          callback(false);
          return;
        }

        if (permission === 'media') {
          if (!hasAllowedMediaTypes(mediaTypes)) {
            logger.warn('Denied media permission by mediaTypes gate', {
              mediaTypes,
              requestingOrigin,
              embeddingOrigin,
              requestingUrl,
              securityOrigin,
              webContentsUrl: webContents?.getURL(),
            });
            callback(false);
            return;
          }

          void ensureMacMediaAccess(mediaTypes)
            .then((granted) => {
              callback(granted);
            })
            .catch(() => {
              callback(false);
            });
          return;
        }

        callback(true);
      },
    );
  }
};
