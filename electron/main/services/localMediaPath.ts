import fs from 'node:fs';
import path from 'node:path';
import { INTERNAL_ROOT, WORKSPACE_ROOT } from './workspacePaths';

const MAX_DECODE_ROUNDS = 3;
const MAIN_AGENT_SCOPE_ID = 'main-agent';
const PROJECT_ROOT_PREFIXES = ['assets/', 'docs/', 'files/'] as const;

const normalizePathCandidate = (value: string): string | null => {
  const normalized = path.normalize(value.trim());
  if (!normalized || normalized === '.') return null;
  return normalized;
};

const splitPathSuffix = (value: string): string => {
  const hashIndex = value.indexOf('#');
  const queryIndex = value.indexOf('?');
  const suffixIndex =
    hashIndex < 0
      ? queryIndex
      : queryIndex < 0
        ? hashIndex
        : Math.min(hashIndex, queryIndex);

  return suffixIndex < 0 ? value : value.slice(0, suffixIndex);
};

const normalizeRelativePath = (value: string): string | null => {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) return null;

  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join('/');
};

const dirname = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : '';
};

const normalizeDocumentPath = (value: string): string | null => {
  const normalized = normalizeRelativePath(value);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('docs/')) {
    return normalized.slice('docs/'.length);
  }
  if (normalized.startsWith('files/')) {
    return normalized.slice('files/'.length);
  }
  return normalized;
};

const collectDecodedCandidates = (encodedPath: string): string[] => {
  const candidates: string[] = [];
  let current = encodedPath;

  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      break;
    }

    const normalizedCandidate = normalizePathCandidate(decoded);
    if (normalizedCandidate && !candidates.includes(normalizedCandidate)) {
      candidates.push(normalizedCandidate);
    }

    if (decoded === current) {
      break;
    }
    current = decoded;
  }

  return candidates;
};

const isWithinDirectory = (targetPath: string, rootDir: string): boolean => {
  const relative = path.relative(rootDir, targetPath);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

const resolveProjectRootDir = (options?: {
  projectId?: string;
  projectRootOverride?: string;
}): string | null => {
  if (options?.projectRootOverride) {
    return path.resolve(options.projectRootOverride);
  }

  const projectId = options?.projectId?.trim();
  if (!projectId) {
    return null;
  }

  return projectId === MAIN_AGENT_SCOPE_ID
    ? path.join(INTERNAL_ROOT, MAIN_AGENT_SCOPE_ID)
    : path.join(WORKSPACE_ROOT, projectId);
};

const buildProjectCandidate = (
  projectRootDir: string,
  relativePath: string,
): string | null => {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  if (!normalizedRelativePath) {
    return null;
  }

  const resolved = path.resolve(projectRootDir, normalizedRelativePath);
  if (!isWithinDirectory(resolved, projectRootDir)) {
    return null;
  }
  return resolved;
};

const buildDocumentRelativeCandidate = (
  projectRootDir: string,
  rawPath: string,
  documentPath?: string,
): string | null => {
  const normalizedDocumentPath = normalizeDocumentPath(documentPath ?? '');
  if (!normalizedDocumentPath) {
    return null;
  }

  const normalizedRawPath = rawPath.replace(/\\/g, '/').trim();
  if (!normalizedRawPath) {
    return null;
  }

  const baseDir = dirname(`docs/${normalizedDocumentPath}`);
  const combinedPath = baseDir ? `${baseDir}/${normalizedRawPath}` : normalizedRawPath;
  return buildProjectCandidate(projectRootDir, combinedPath);
};

const hasProjectRootPrefix = (value: string): boolean => {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  return PROJECT_ROOT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const isExplicitDocumentRelativePath = (value: string): boolean =>
  value.startsWith('./') || value.startsWith('../');

const collectProjectCandidates = (
  candidate: string,
  options?: {
    projectId?: string;
    documentPath?: string;
    projectRootOverride?: string;
  },
): string[] => {
  if (path.isAbsolute(candidate)) {
    return [];
  }

  const projectRootDir = resolveProjectRootDir(options);
  if (!projectRootDir) {
    return [];
  }

  const normalizedCandidate = splitPathSuffix(candidate).replace(/\\/g, '/').trim();
  if (!normalizedCandidate) {
    return [];
  }

  const results: string[] = [];
  const addResult = (value: string | null): void => {
    if (!value || results.includes(value)) {
      return;
    }
    results.push(value);
  };

  if (hasProjectRootPrefix(normalizedCandidate)) {
    addResult(buildProjectCandidate(projectRootDir, normalizedCandidate));
    return results;
  }

  if (isExplicitDocumentRelativePath(normalizedCandidate)) {
    addResult(
      buildDocumentRelativeCandidate(
        projectRootDir,
        normalizedCandidate,
        options?.documentPath,
      ),
    );
    return results;
  }

  addResult(
    buildDocumentRelativeCandidate(
      projectRootDir,
      normalizedCandidate,
      options?.documentPath,
    ),
  );
  addResult(buildProjectCandidate(projectRootDir, `docs/${normalizedCandidate}`));
  addResult(buildProjectCandidate(projectRootDir, normalizedCandidate));
  return results;
};

export const resolveLocalMediaPath = (
  encodedPath: string,
  options?: {
    projectId?: string;
    documentPath?: string;
    projectRootOverride?: string;
  },
): string | null => {
  const candidates = collectDecodedCandidates(encodedPath);
  if (candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    const absoluteCandidate = normalizePathCandidate(splitPathSuffix(candidate));
    if (!absoluteCandidate || !path.isAbsolute(absoluteCandidate)) continue;
    if (fs.existsSync(absoluteCandidate)) {
      return absoluteCandidate;
    }
  }

  for (const candidate of candidates) {
    for (const resolved of collectProjectCandidates(candidate, options)) {
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }

  const absoluteFallback = candidates
    .map((candidate) => normalizePathCandidate(splitPathSuffix(candidate)))
    .find((candidate): candidate is string => Boolean(candidate && path.isAbsolute(candidate)));
  if (absoluteFallback) {
    return absoluteFallback;
  }

  for (const candidate of candidates) {
    const projectCandidates = collectProjectCandidates(candidate, options);
    if (projectCandidates.length > 0) {
      return projectCandidates[0];
    }
  }

  return null;
};
