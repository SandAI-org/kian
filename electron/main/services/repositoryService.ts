import {
  type AppBuildResultDTO,
  type AppWorkspaceStatusDTO,
  type AssetDTO,
  type ChatAttachmentDTO,
  type ChatModuleType,
  type ChatMessageDTO,
  type ChatScope,
  type ChatSessionDTO,
  type ChatUploadFilePayload,
  type CreationBoardDTO,
  type CreationSceneDTO,
  type CreationShotDTO,
  type CronJobDTO,
  type DocExplorerEntryDTO,
  type DocumentDTO,
  type ModuleType,
  type ProjectDTO,
  type ProjectCreationSource,
} from "@shared/types";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { chatEvents } from "./chatEvents";
import { logger } from "./logger";
import { INTERNAL_ROOT, WORKSPACE_ROOT } from "./workspacePaths";

interface ProjectMetaFile extends ProjectDTO {}
interface CronJobFileItem {
  cron: string;
  content: string;
  status: string;
  targetAgentId?: string | null;
}

const nowISO = (): string => new Date().toISOString();
const MAIN_AGENT_SCOPE_ID = "main-agent";

const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    ) {
      return fallback;
    }
    throw error;
  }
};

const writeJson = async <T>(filePath: string, payload: T): Promise<void> => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const PROJECT_ID_PATTERN = /^p-(\d{4}-\d{2}-\d{2})-(\d+)$/;

const normalizeProjectDisplayName = (name: string): string =>
  name
    .replace(/[\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatProjectDay = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const buildProjectId = (day: string, sequence: number): string =>
  `p-${day}-${sequence}`;

const DEFAULT_AGENT_PERSONA_NAMES = [
  "张亮",
  "Lucy",
  "李云龙",
  "清洁工",
  "张导演",
  "阿哲",
  "Mia",
  "老周",
  "安娜",
  "王策划",
  "小武",
  "陈老师",
  "Noah",
  "林队长",
  "许编辑",
  "夏洛特",
] as const;

const buildAgentDefaultProjectName = (sequence: number): string => {
  const index = (sequence - 1) % DEFAULT_AGENT_PERSONA_NAMES.length;
  const round = Math.floor((sequence - 1) / DEFAULT_AGENT_PERSONA_NAMES.length);
  const baseName = DEFAULT_AGENT_PERSONA_NAMES[index];
  return round === 0 ? baseName : `${baseName} ${round + 1}号`;
};

const buildManualDefaultProjectName = (sequence: number): string =>
  `陌生人-${sequence}`;

const buildDefaultProjectName = (
  source: ProjectCreationSource,
  sequence: number,
): string =>
  source === "manual"
    ? buildManualDefaultProjectName(sequence)
    : buildAgentDefaultProjectName(sequence);

const resolveNextProjectIdentity = async (
  source: ProjectCreationSource,
): Promise<{
  id: string;
  defaultName: string;
}> => {
  const day = formatProjectDay(new Date());
  const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });

  let nextSequence = 1;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const matched = PROJECT_ID_PATTERN.exec(entry.name);
    if (!matched || matched[1] !== day) {
      continue;
    }
    const sequence = Number.parseInt(matched[2], 10);
    if (Number.isInteger(sequence) && sequence >= nextSequence) {
      nextSequence = sequence + 1;
    }
  }

  let projectId = buildProjectId(day, nextSequence);
  while (await pathExists(path.join(WORKSPACE_ROOT, projectId))) {
    nextSequence += 1;
    projectId = buildProjectId(day, nextSequence);
  }

  return {
    id: projectId,
    defaultName: buildDefaultProjectName(source, nextSequence),
  };
};

const getProjectDir = (projectId: string): string =>
  path.join(WORKSPACE_ROOT, projectId);
const getMainAgentRootDir = (): string => path.join(INTERNAL_ROOT, "main-agent");
const getMainAgentDocsDir = (): string =>
  path.join(getMainAgentRootDir(), "docs");
const getProjectMetaPath = (projectId: string): string =>
  path.join(getProjectDir(projectId), "project.json");

const getDocsDir = (projectId: string): string =>
  projectId.trim() === MAIN_AGENT_SCOPE_ID
    ? getMainAgentDocsDir()
    : path.join(getProjectDir(projectId), "docs");

const APP_DIR_NAME = "app";
const getAppDir = (projectId: string): string =>
  path.join(getProjectDir(projectId), APP_DIR_NAME);
const getAppPackageJsonPath = (projectId: string): string =>
  path.join(getAppDir(projectId), "package.json");
const getAppDistIndexPath = (projectId: string): string =>
  path.join(getAppDir(projectId), "dist", "index.html");
const getAppMetadataPath = (projectId: string): string =>
  path.join(getAppDir(projectId), "app.json");

const getCreationDir = (projectId: string): string =>
  path.join(getProjectDir(projectId), "creation");
const getCreationBoardPath = (projectId: string): string =>
  path.join(getCreationDir(projectId), "board.json");

const getAssetsDir = (projectId: string): string =>
  path.join(getProjectDir(projectId), "assets");
const ASSETS_GENERATED_DIR_NAME = "generated";
const ASSETS_USER_FILES_DIR_NAME = "user_files";
const ASSETS_META_FILE_NAME = "meta.json";
const ASSETS_LEGACY_INDEX_FILE_NAME = "assets.json";
const ASSET_TAG_USER = "user";
const ASSET_TAG_GENERATED = "generated";

const getGeneratedAssetsDir = (projectId: string): string =>
  path.join(getAssetsDir(projectId), ASSETS_GENERATED_DIR_NAME);
const getUserFilesDir = (projectId: string): string =>
  path.join(getAssetsDir(projectId), ASSETS_USER_FILES_DIR_NAME);
const getAssetsMetaPath = (projectId: string): string =>
  path.join(getAssetsDir(projectId), ASSETS_META_FILE_NAME);
const getAssetsLegacyIndexPath = (projectId: string): string =>
  path.join(getAssetsDir(projectId), ASSETS_LEGACY_INDEX_FILE_NAME);

const getChatDir = (projectId: string): string =>
  path.join(getProjectDir(projectId), "chat");
const getChatSessionsPath = (projectId: string): string =>
  path.join(getChatDir(projectId), "sessions.json");
const getChatMessagesDir = (projectId: string): string =>
  path.join(getChatDir(projectId), "messages");
const getChatMessagesPath = (projectId: string, sessionId: string): string =>
  path.join(getChatMessagesDir(projectId), `${sessionId}.json`);
const getMainAgentChatDir = (): string => path.join(getMainAgentRootDir(), "chat");
const getMainAgentChatSessionsPath = (): string =>
  path.join(getMainAgentChatDir(), "sessions.json");
const getMainAgentChatMessagesDir = (): string =>
  path.join(getMainAgentChatDir(), "messages");
const getMainAgentChatMessagesPath = (sessionId: string): string =>
  path.join(getMainAgentChatMessagesDir(), `${sessionId}.json`);
const getMainAgentFilesDir = (): string =>
  path.join(getMainAgentRootDir(), "files", "user_files");
const LEGACY_MAIN_AGENT_CONTEXT_FILE_NAMES = [
  "IDENTITY.md",
  "SOUL.md",
  "USER.md",
] as const;

const getLogsDir = (projectId: string): string =>
  path.join(getProjectDir(projectId), "logs");
const getAgentLogPath = (projectId: string): string =>
  path.join(getLogsDir(projectId), "agent-actions.jsonl");
const getCronJobPath = (): string => path.join(WORKSPACE_ROOT, "cronjob.json");
const getCronJobLogPath = (): string =>
  path.join(WORKSPACE_ROOT, "cronjob-log.jsonl");

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".csv",
  ".xlsx",
]);
const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".text",
  ".log",
  ".ini",
  ".conf",
  ".config",
  ".toml",
  ".xml",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
  ".py",
  ".rb",
  ".php",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".cs",
  ".m",
  ".mm",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".dockerfile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".yarnrc",
  ".prettierrc",
  ".eslintrc",
  ".stylelintrc",
  ".env",
  ".md",
  ".markdown",
  ".mdx",
]);
const SUPPORTED_TEXT_BASENAMES = new Set([
  "Dockerfile",
  "Makefile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".yarnrc",
  ".prettierrc",
  ".eslintrc",
  ".stylelintrc",
  ".env",
]);
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
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
const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
  ".opus",
]);
const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
  ".webm",
  ".wmv",
]);
const SUPPORTED_FILE_EXTENSIONS = new Set([
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
  ...SUPPORTED_TEXT_EXTENSIONS,
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_AUDIO_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS,
]);
const SUPPORTED_MIME_PREFIXES = ["text/", "image/", "audio/", "video/"];
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
  "text/csv",
]);

const APP_TEMPLATE_FILES: Array<{ relativePath: string; content: string }> = [
  {
    relativePath: ".gitignore",
    content: "node_modules\ndist\n",
  },
  {
    relativePath: "app.json",
    content: `{
  "name": "Kian 应用",
  "buildTime": null
}
`,
  },
  {
    relativePath: "package.json",
    content: `{
  "name": "kian-project-app",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  },
  "devDependencies": {
    "@types/react": "^19.1.10",
    "@types/react-dom": "^19.1.7",
    "@vitejs/plugin-react": "^4.7.0",
    "typescript": "^5.9.2",
    "vite": "^5.4.19",
    "vite-plugin-singlefile": "^2.0.3"
  }
}
`,
  },
  {
    relativePath: "index.html",
    content: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kian App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  },
  {
    relativePath: "tsconfig.json",
    content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
`,
  },
  {
    relativePath: "tsconfig.node.json",
    content: `{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
`,
  },
  {
    relativePath: "vite.config.ts",
    content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()]
});
`,
  },
  {
    relativePath: "src/main.tsx",
    content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
  },
  {
    relativePath: "src/App.tsx",
    content: `const App = () => {
  return (
    <main className="app">
      <h1>Kian 应用模块</h1>
      <p>这里是项目应用入口。修改代码后请重新构建，再在预览区查看最新效果。</p>
      <p>内置 SDK：<code>window.KianNativeSDK</code>（含摄像头 / 麦克风能力）。</p>
    </main>
  );
};

export default App;
`,
  },
  {
    relativePath: "src/index.css",
    content: `:root {
  font-family: 'PingFang SC', 'Noto Sans SC', sans-serif;
  color: #0f172a;
  background: #f8fafc;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  min-height: 100%;
}

.app {
  min-height: 100vh;
  padding: 32px;
  background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 55%, #fff7ed 100%);
}

.app h1 {
  margin: 0 0 12px;
  font-size: 28px;
  line-height: 1.2;
}

.app p {
  margin: 0;
  max-width: 640px;
  color: #334155;
  line-height: 1.7;
}
`,
  },
  {
    relativePath: "src/kian-native-sdk.d.ts",
    content: `export {};

declare global {
  type KianPermissionState =
    | PermissionState
    | "unsupported"
    | "unknown";

  interface KianNativeSdkMedia {
    isSupported(): boolean;
    getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
    openCamera(): Promise<MediaStream>;
    openMicrophone(): Promise<MediaStream>;
    getDisplayMedia(
      options?: DisplayMediaStreamOptions
    ): Promise<MediaStream>;
    enumerateDevices(): Promise<MediaDeviceInfo[]>;
    getPermissions(): Promise<{
      camera: KianPermissionState;
      microphone: KianPermissionState;
    }>;
    stopStream(stream: MediaStream): void;
  }

  interface KianNativeSDK {
    version: string;
    platform: string;
    capabilities: {
      camera: boolean;
      microphone: boolean;
      displayCapture: boolean;
    };
    media: KianNativeSdkMedia;
  }

  interface Window {
    KianNativeSDK: KianNativeSDK;
    kian: KianNativeSDK;
  }
}
`,
  },
  {
    relativePath: "src/vite-env.d.ts",
    content: `/// <reference types="vite/client" />
`,
  },
];

type PackageManager = "pnpm" | "npm";

const toNonEmptyString = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const toPosixPath = (filePath: string): string =>
  filePath.split(path.sep).join("/");

const isWithinDirectory = (targetPath: string, rootDir: string): boolean => {
  const relative = path.relative(rootDir, targetPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const isMarkdownFile = (filePath: string): boolean => {
  const extension = path.extname(path.basename(filePath)).toLowerCase();
  return extension === ".md" || extension === ".markdown";
};

const isEditableTextDocument = (filePath: string): boolean => {
  const baseName = path.basename(filePath);
  if (
    SUPPORTED_TEXT_BASENAMES.has(baseName) ||
    baseName.startsWith(".env.")
  ) {
    return true;
  }

  const extension = path.extname(baseName).toLowerCase();
  return SUPPORTED_TEXT_EXTENSIONS.has(extension);
};

const normalizeDocumentId = (input: string): string => {
  const normalized = toPosixPath(input)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");
  if (normalized.startsWith("docs/files/")) {
    return normalized.slice("docs/files/".length);
  }
  if (normalized.startsWith("docs/")) {
    return normalized.slice("docs/".length);
  }
  if (normalized.startsWith("files/")) {
    return normalized.slice("files/".length);
  }
  return normalized;
};

const sanitizeDocumentPathSegment = (
  input: string,
  fallback: string,
): string => {
  const sanitized = input
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized || sanitized === "." || sanitized === "..") {
    return fallback;
  }
  return sanitized;
};

const sanitizeDocumentRelativePath = (
  input: string,
  fallback: string,
): string => {
  const normalized = normalizeDocumentId(toNonEmptyString(input, fallback))
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const rawSegments = normalized.split("/").filter(Boolean);
  const sourceSegments = rawSegments.length > 0 ? rawSegments : [fallback];
  const sanitizedSegments = sourceSegments.map((segment, index) =>
    sanitizeDocumentPathSegment(
      segment,
      index === sourceSegments.length - 1 ? fallback : "folder",
    ),
  );

  let fileName = sanitizedSegments.at(-1) ?? fallback;
  if (!isEditableTextDocument(fileName)) {
    fileName = `${fileName}.md`;
  }

  if (sanitizedSegments.length === 1) {
    return fileName;
  }

  return [...sanitizedSegments.slice(0, -1), fileName].join("/");
};

const sanitizeDocumentDirectoryPath = (
  input: string,
  fallback: string,
): string => {
  const normalized = normalizeDocumentId(toNonEmptyString(input, fallback))
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const rawSegments = normalized.split("/").filter(Boolean);
  const sourceSegments = rawSegments.length > 0 ? rawSegments : [fallback];

  return sourceSegments
    .map((segment) => sanitizeDocumentPathSegment(segment, "folder"))
    .join("/");
};

const sanitizeDocumentFileName = (input: string, fallback: string): string => {
  const normalized = toNonEmptyString(input, fallback);
  const baseName = path
    .basename(normalized)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const safeName = baseName || fallback;
  return isEditableTextDocument(safeName) ? safeName : `${safeName}.md`;
};

const sanitizeUploadFileName = (input: string, fallback: string): string => {
  const normalized = toNonEmptyString(input, fallback);
  const baseName = path
    .basename(normalized)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return baseName || fallback;
};

const sanitizeExistingFileName = (input: string, fallback: string): string => {
  const sanitized = sanitizeUploadFileName(input, fallback);
  if (path.extname(sanitized)) {
    return sanitized;
  }

  const fallbackExt = path.extname(fallback);
  return fallbackExt ? `${sanitized}${fallbackExt}` : sanitized;
};

const isSupportedUserFile = (fileName: string, mimeType?: string): boolean => {
  const extension = path.extname(fileName).toLowerCase();
  if (SUPPORTED_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  const normalizedMime = mimeType?.trim().toLowerCase();
  if (!normalizedMime) {
    return false;
  }

  if (SUPPORTED_MIME_TYPES.has(normalizedMime)) {
    return true;
  }

  return SUPPORTED_MIME_PREFIXES.some((prefix) =>
    normalizedMime.startsWith(prefix),
  );
};

const normalizeAssetRelativePath = (input: string): string => {
  const normalized = toPosixPath(input)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");
  if (normalized.startsWith("assets/")) {
    return normalized.slice("assets/".length);
  }
  return normalized;
};

const isAssetSystemFile = (assetRelativePath: string): boolean => {
  const normalized = normalizeAssetRelativePath(assetRelativePath);
  if (!normalized) return true;

  const baseName = path.basename(normalized);
  if (baseName.startsWith(".")) return true;
  if (normalized === ASSETS_META_FILE_NAME) return true;
  if (normalized === ASSETS_LEGACY_INDEX_FILE_NAME) return true;
  return false;
};

const getAssetTypeByFileName = (fileName: string): AssetDTO["type"] => {
  const ext = path.extname(fileName).toLowerCase();
  if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (SUPPORTED_VIDEO_EXTENSIONS.has(ext)) return "video";
  if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "file";
};

const getAssetTagsByRelativePath = (assetRelativePath: string): string[] => {
  const normalized = normalizeAssetRelativePath(assetRelativePath);
  if (
    normalized === ASSETS_USER_FILES_DIR_NAME ||
    normalized.startsWith(`${ASSETS_USER_FILES_DIR_NAME}/`)
  ) {
    return [ASSET_TAG_USER];
  }
  if (
    normalized === ASSETS_GENERATED_DIR_NAME ||
    normalized.startsWith(`${ASSETS_GENERATED_DIR_NAME}/`)
  ) {
    return [ASSET_TAG_GENERATED];
  }
  return [];
};

const normalizeAssetTagsFilter = (tags?: string[]): string[] => {
  if (!tags || tags.length === 0) {
    return [];
  }

  const normalized = tags
    .map((item) => item.trim().toLowerCase())
    .map((item) => {
      if (item === "user" || item === "user-file" || item === "user file")
        return ASSET_TAG_USER;
      if (
        item === "generated" ||
        item === "ai" ||
        item === "ai-generated" ||
        item === "ai generated"
      ) {
        return ASSET_TAG_GENERATED;
      }
      return item;
    })
    .filter(Boolean);

  return [...new Set(normalized)];
};

const collectAssetFiles = async (assetsDir: string): Promise<string[]> => {
  const files: string[] = [];
  const pendingDirs = [assetsDir];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizeAssetRelativePath(
        path.relative(assetsDir, absolutePath),
      );
      if (!relativePath || relativePath.startsWith("../")) {
        continue;
      }

      if (entry.isDirectory()) {
        pendingDirs.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (isAssetSystemFile(relativePath)) {
        continue;
      }

      files.push(relativePath);
    }
  }

  files.sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" }),
  );
  return files;
};

const buildAssetDto = async (input: {
  projectId: string;
  assetRelativePath: string;
  metaMap: AssetMetaMap;
}): Promise<AssetDTO> => {
  const assetsDir = getAssetsDir(input.projectId);
  const relativePath = normalizeAssetRelativePath(input.assetRelativePath);
  const absolutePath = path.resolve(assetsDir, relativePath);
  if (!isWithinDirectory(absolutePath, assetsDir)) {
    throw new Error(`素材路径非法: ${input.assetRelativePath}`);
  }

  const stats = await fs.stat(absolutePath);
  const tags = getAssetTagsByRelativePath(relativePath);
  const meta = input.metaMap[relativePath];

  return {
    id: relativePath,
    projectId: input.projectId,
    type: getAssetTypeByFileName(relativePath),
    name: path.basename(relativePath),
    path: relativePath,
    absolutePath,
    duration: null,
    thumbnailPath: null,
    tagsJson: JSON.stringify(tags),
    metaJson: meta ? JSON.stringify(meta) : null,
    createdAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
  };
};

const parseAssetMetaJson = (raw?: string | null): AssetMetaEntry | null => {
  if (!raw || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as AssetMetaEntry;
  } catch {
    return null;
  }
};

const resolveAssetAbsolutePath = (
  projectId: string,
  idOrPath: string,
): string | null => {
  const raw = idOrPath.trim();
  if (!raw) return null;

  const assetsDir = getAssetsDir(projectId);
  if (path.isAbsolute(raw)) {
    const normalized = path.normalize(raw);
    if (!isWithinDirectory(normalized, assetsDir)) return null;
    return normalized;
  }

  const normalizedRelativePath = normalizeAssetRelativePath(raw);
  if (!normalizedRelativePath || normalizedRelativePath.startsWith("../"))
    return null;
  const absolutePath = path.resolve(assetsDir, normalizedRelativePath);
  if (!isWithinDirectory(absolutePath, assetsDir)) return null;
  return absolutePath;
};

const toAssetRelativePath = (
  projectId: string,
  absolutePath: string,
): string => {
  const assetsDir = getAssetsDir(projectId);
  return normalizeAssetRelativePath(path.relative(assetsDir, absolutePath));
};

const readAssetMetaMap = async (projectId: string): Promise<AssetMetaMap> => {
  const metaPath = getAssetsMetaPath(projectId);
  try {
    const raw = await readJson<unknown>(metaPath, {});
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    return raw as AssetMetaMap;
  } catch (error) {
    logger.error(`Failed to parse assets meta: ${metaPath}`, error);
    return {};
  }
};

const writeAssetMetaMap = async (
  projectId: string,
  payload: AssetMetaMap,
): Promise<void> => {
  await writeJson(getAssetsMetaPath(projectId), payload);
};

interface DocsFsEntry {
  path: string;
  name: string;
  kind: "directory" | "file";
  isEditableText: boolean;
  isMarkdown: boolean;
}

interface AssetMetaEntry {
  provider?: string;
  model?: string;
  prompt?: string;
  source?: string;
  sourceUrl?: string | null;
  parameters?: Record<string, unknown>;
  notes?: string[];
  createdAt?: string;
  updatedAt?: string;
}

type AssetMetaMap = Record<string, AssetMetaEntry>;

const listDocsFsEntries = async (projectId: string): Promise<DocsFsEntry[]> => {
  const docsDir = getDocsDir(projectId);
  const pendingDirs = [docsDir];
  const entries: DocsFsEntry[] = [];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) {
      continue;
    }

    let dirEntries: Dirent[];
    try {
      dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    for (const entry of dirEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = toPosixPath(path.relative(docsDir, absolutePath));
      if (
        !relativePath ||
        relativePath === "." ||
        relativePath.startsWith("../")
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        pendingDirs.push(absolutePath);
        entries.push({
          path: relativePath,
          name: entry.name,
          kind: "directory",
          isEditableText: false,
          isMarkdown: false,
        });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      entries.push({
        path: relativePath,
        name: entry.name,
        kind: "file",
        isEditableText: isEditableTextDocument(entry.name),
        isMarkdown: isMarkdownFile(entry.name),
      });
    }
  }

  entries.sort((a, b) =>
    a.path.localeCompare(b.path, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return entries;
};

const listEditableDocumentRelativePaths = (entries: DocsFsEntry[]): string[] =>
  entries
    .filter((entry) => entry.kind === "file" && entry.isEditableText)
    .map((entry) => entry.path);

const buildDocumentPathCandidate = (
  rootDir: string,
  normalizedDocumentId: string,
): { absolutePath: string; relativePath: string } | null => {
  const absolutePath = path.resolve(rootDir, normalizedDocumentId);
  if (!isWithinDirectory(absolutePath, rootDir)) {
    return null;
  }

  const relativePath = toPosixPath(path.relative(rootDir, absolutePath));
  if (
    !relativePath ||
    relativePath === "." ||
    relativePath.startsWith("../") ||
    !isEditableTextDocument(relativePath)
  ) {
    return null;
  }

  return { absolutePath, relativePath };
};

const buildDocsFilePathCandidate = (
  rootDir: string,
  normalizedDocumentId: string,
): { absolutePath: string; relativePath: string } | null => {
  const absolutePath = path.resolve(rootDir, normalizedDocumentId);
  if (!isWithinDirectory(absolutePath, rootDir)) {
    return null;
  }

  const relativePath = toPosixPath(path.relative(rootDir, absolutePath));
  if (
    !relativePath ||
    relativePath === "." ||
    relativePath.startsWith("../")
  ) {
    return null;
  }

  return { absolutePath, relativePath };
};

const resolveDocumentPath = (
  projectId: string,
  documentId: string,
): { absolutePath: string; relativePath: string } => {
  const docsDir = getDocsDir(projectId);
  const normalizedDocumentId = normalizeDocumentId(documentId);
  if (
    !normalizedDocumentId ||
    normalizedDocumentId === "." ||
    normalizedDocumentId.startsWith("../")
  ) {
    throw new Error("文档路径非法");
  }

  const docsCandidate = buildDocumentPathCandidate(
    docsDir,
    normalizedDocumentId,
  );
  if (!docsCandidate) {
    throw new Error("文档路径非法");
  }

  return docsCandidate;
};

const resolveDocsFilePath = (
  projectId: string,
  documentId: string,
): { absolutePath: string; relativePath: string } => {
  const docsDir = getDocsDir(projectId);
  const normalizedDocumentId = normalizeDocumentId(documentId);
  if (
    !normalizedDocumentId ||
    normalizedDocumentId === "." ||
    normalizedDocumentId.startsWith("../")
  ) {
    throw new Error("文档路径非法");
  }

  const docsCandidate = buildDocsFilePathCandidate(docsDir, normalizedDocumentId);
  if (!docsCandidate) {
    throw new Error("文档路径非法");
  }

  return docsCandidate;
};

const resolveDocumentDirectoryPath = (
  projectId: string,
  directoryPath: string,
): { absolutePath: string; relativePath: string } => {
  const docsDir = getDocsDir(projectId);
  const normalizedDirectoryPath = normalizeDocumentId(directoryPath)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (
    !normalizedDirectoryPath ||
    normalizedDirectoryPath === "." ||
    normalizedDirectoryPath.startsWith("../")
  ) {
    throw new Error("文档目录路径非法");
  }

  const absolutePath = path.resolve(docsDir, normalizedDirectoryPath);
  if (!isWithinDirectory(absolutePath, docsDir)) {
    throw new Error("文档目录路径非法");
  }

  const relativePath = toPosixPath(path.relative(docsDir, absolutePath));
  if (!relativePath || relativePath === "." || relativePath.startsWith("../")) {
    throw new Error("文档目录路径非法");
  }

  return { absolutePath, relativePath };
};

const resolveUniqueFilePath = async (
  dirPath: string,
  fileName: string,
  keepPath?: string,
): Promise<string> => {
  const normalizedRelativePath = toPosixPath(fileName)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const parentRelativeDir = path.dirname(normalizedRelativePath);
  const parentDirPath =
    parentRelativeDir === "."
      ? dirPath
      : path.resolve(dirPath, parentRelativeDir);
  if (!isWithinDirectory(parentDirPath, dirPath)) {
    throw new Error("文档路径非法");
  }

  const extension = path.extname(normalizedRelativePath) || ".md";
  const baseName = path.basename(normalizedRelativePath, extension) || "note";
  let candidate = path.resolve(parentDirPath, `${baseName}${extension}`);
  if (!isWithinDirectory(candidate, dirPath)) {
    throw new Error("文档路径非法");
  }

  let index = 2;

  while (candidate !== keepPath && (await pathExists(candidate))) {
    candidate = path.resolve(parentDirPath, `${baseName}-${index}${extension}`);
    if (!isWithinDirectory(candidate, dirPath)) {
      throw new Error("文档路径非法");
    }
    index += 1;
  }

  return candidate;
};

const resolveUniqueDirectoryPath = async (
  rootDir: string,
  directoryPath: string,
): Promise<string> => {
  const normalizedRelativePath = toPosixPath(directoryPath)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const segments = normalizedRelativePath.split("/").filter(Boolean);
  const safeSegments = segments.length > 0 ? segments : ["folder"];

  const parentSegments = safeSegments.slice(0, -1);
  const leafSegment = safeSegments.at(-1) ?? "folder";
  const parentPath = path.resolve(rootDir, ...parentSegments);
  if (!isWithinDirectory(parentPath, rootDir)) {
    throw new Error("文档目录路径非法");
  }

  let candidateLeaf = leafSegment;
  let candidatePath = path.resolve(parentPath, candidateLeaf);
  let index = 2;

  while (await pathExists(candidatePath)) {
    candidateLeaf = `${leafSegment}-${index}`;
    candidatePath = path.resolve(parentPath, candidateLeaf);
    index += 1;
  }

  if (!isWithinDirectory(candidatePath, rootDir)) {
    throw new Error("文档目录路径非法");
  }

  return candidatePath;
};

const resolveUniqueUploadFilePath = async (
  dirPath: string,
  fileName: string,
): Promise<{ absolutePath: string; finalName: string }> => {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension) || "file";

  let candidateName = `${baseName}${extension}`;
  let candidate = path.join(dirPath, candidateName);
  let index = 2;

  while (await pathExists(candidate)) {
    candidateName = `${baseName}-${index}${extension}`;
    candidate = path.join(dirPath, candidateName);
    index += 1;
  }

  return { absolutePath: candidate, finalName: candidateName };
};

const writeFileIfMissing = async (
  filePath: string,
  content: string,
): Promise<boolean> => {
  if (await pathExists(filePath)) {
    return false;
  }
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
  return true;
};

const initializeAppTemplateFiles = async (
  projectId: string,
): Promise<{ initialized: boolean; createdFiles: string[] }> => {
  const appDir = getAppDir(projectId);
  await ensureDir(appDir);

  const createdFiles: string[] = [];
  for (const file of APP_TEMPLATE_FILES) {
    const targetPath = path.join(appDir, file.relativePath);
    const created = await writeFileIfMissing(targetPath, file.content);
    if (created) {
      createdFiles.push(file.relativePath);
    }
  }

  return {
    initialized: await pathExists(getAppPackageJsonPath(projectId)),
    createdFiles,
  };
};

interface AppMetadataFile {
  name: string;
  buildTime: string | null;
}

const readAppMetadata = async (projectId: string): Promise<AppMetadataFile> => {
  const fallback: AppMetadataFile = {
    name: "",
    buildTime: null,
  };

  try {
    const raw = await fs.readFile(getAppMetadataPath(projectId), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const buildTimeValue =
      typeof parsed.buildTime === "string"
        ? parsed.buildTime
        : typeof parsed.builtAt === "string"
          ? parsed.builtAt
          : null;
    const normalizedBuildTime =
      buildTimeValue && buildTimeValue.trim() ? buildTimeValue.trim() : null;
    const buildTime =
      normalizedBuildTime && !Number.isNaN(Date.parse(normalizedBuildTime))
        ? normalizedBuildTime
        : null;
    return { name, buildTime };
  } catch {
    return fallback;
  }
};

const writeAppMetadata = async (
  projectId: string,
  metadata: AppMetadataFile,
): Promise<void> => {
  await ensureDir(getAppDir(projectId));
  await fs.writeFile(
    getAppMetadataPath(projectId),
    `${JSON.stringify(
      {
        name: metadata.name,
        buildTime: metadata.buildTime,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};

const updateAppMetadata = async (
  projectId: string,
  patch: Partial<AppMetadataFile>,
): Promise<AppMetadataFile> => {
  const current = await readAppMetadata(projectId);
  const next: AppMetadataFile = {
    name:
      patch.name !== undefined
        ? typeof patch.name === "string"
          ? patch.name.trim()
          : ""
        : current.name,
    buildTime:
      patch.buildTime !== undefined
        ? patch.buildTime && patch.buildTime.trim()
          ? patch.buildTime.trim()
          : null
        : current.buildTime,
  };
  await writeAppMetadata(projectId, next);
  return next;
};

const detectAppWorkspaceType = async (
  projectId: string,
): Promise<AppWorkspaceStatusDTO["appType"]> => {
  const packageJsonPath = getAppPackageJsonPath(projectId);

  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const dependencies =
      parsed.dependencies && typeof parsed.dependencies === "object"
        ? Object.keys(parsed.dependencies as Record<string, unknown>)
        : [];
    const devDependencies =
      parsed.devDependencies && typeof parsed.devDependencies === "object"
        ? Object.keys(parsed.devDependencies as Record<string, unknown>)
        : [];
    const allDependencies = new Set(
      [...dependencies, ...devDependencies]
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    );

    if (allDependencies.has("next")) return "nextjs";
    if (allDependencies.has("nuxt") || allDependencies.has("nuxt3"))
      return "nuxt";
    if (allDependencies.has("@angular/core")) return "angular";
    if (allDependencies.has("vue")) return "vue";
    if (allDependencies.has("svelte")) return "svelte";
    if (allDependencies.has("react")) return "react";
    if (allDependencies.size > 0) return "vanilla";
  } catch {
    // ignore parse/read failures and fallback to unknown
  }

  return "unknown";
};

const readAppWorkspaceStatus = async (
  projectId: string,
): Promise<AppWorkspaceStatusDTO> => {
  const appDir = getAppDir(projectId);
  const distIndexPath = getAppDistIndexPath(projectId);
  const [initialized, dependenciesInstalled, hasBuild, appType, metadata] =
    await Promise.all([
      pathExists(getAppPackageJsonPath(projectId)),
      pathExists(path.join(appDir, "node_modules")),
      pathExists(distIndexPath),
      detectAppWorkspaceType(projectId),
      readAppMetadata(projectId),
    ]);

  let distBuiltAt: string | null = null;
  if (hasBuild) {
    try {
      const stats = await fs.stat(distIndexPath);
      distBuiltAt = stats.mtime.toISOString();
    } catch {
      distBuiltAt = null;
    }
  }

  let builtAt: string | null = metadata.buildTime;
  if (!builtAt && distBuiltAt) {
    builtAt = distBuiltAt;
  }
  if (
    distBuiltAt &&
    (!builtAt || Date.parse(distBuiltAt) > Date.parse(builtAt))
  ) {
    builtAt = distBuiltAt;
  }
  if (builtAt !== metadata.buildTime) {
    await updateAppMetadata(projectId, {
      buildTime: builtAt,
    });
  }

  return {
    projectId,
    appDir,
    distIndexPath,
    appType,
    appName: metadata.name,
    initialized,
    dependenciesInstalled,
    hasBuild,
    builtAt,
  };
};

interface ProcessExecutionResult {
  stdout: string;
  stderr: string;
}

const trimCommandOutput = (output: string, maxLength = 12_000): string =>
  output.length <= maxLength
    ? output
    : `${output.slice(0, maxLength)}\n...(输出已截断)`;

const runCommand = async (
  command: string,
  args: string[],
  cwd: string,
): Promise<ProcessExecutionResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `执行命令失败: ${command} ${args.join(" ")} (${String(error)})`,
        ),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      reject(
        new Error(
          trimCommandOutput(
            `命令退出码 ${code ?? "unknown"}: ${command} ${args.join(" ")}${combined ? `\n${combined}` : ""}`,
          ),
        ),
      );
    });
  });

const isCommandNotFoundError = (error: unknown, command: string): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes(command.toLowerCase()) && message.includes("enoent");
};

const runPackageManagerTask = async (input: {
  cwd: string;
  pnpmArgs: string[];
  npmArgs: string[];
}): Promise<{ manager: PackageManager; output: ProcessExecutionResult }> => {
  try {
    const output = await runCommand("pnpm", input.pnpmArgs, input.cwd);
    return { manager: "pnpm", output };
  } catch (error) {
    if (!isCommandNotFoundError(error, "pnpm")) {
      throw error;
    }
    const output = await runCommand("npm", input.npmArgs, input.cwd);
    return { manager: "npm", output };
  }
};

const normalizeShots = (shots: unknown): CreationShotDTO[] => {
  if (!Array.isArray(shots)) return [];

  return shots.map((shot, index) => {
    const payload =
      typeof shot === "object" && shot ? (shot as Record<string, unknown>) : {};
    return {
      id: typeof payload.id === "string" ? payload.id : randomUUID(),
      title: toNonEmptyString(payload.title, `镜头 ${index + 1}`),
      prompt: typeof payload.prompt === "string" ? payload.prompt : "",
      notes: typeof payload.notes === "string" ? payload.notes : null,
      duration: typeof payload.duration === "number" ? payload.duration : null,
      order: typeof payload.order === "number" ? payload.order : index + 1,
    };
  });
};

const normalizeScenes = (scenes: unknown): CreationSceneDTO[] => {
  if (!Array.isArray(scenes)) return [];

  return scenes.map((scene, index) => {
    const payload =
      typeof scene === "object" && scene
        ? (scene as Record<string, unknown>)
        : {};
    return {
      id: typeof payload.id === "string" ? payload.id : randomUUID(),
      title: toNonEmptyString(payload.title, `场景 ${index + 1}`),
      description:
        typeof payload.description === "string" ? payload.description : "",
      order: typeof payload.order === "number" ? payload.order : index + 1,
      shots: normalizeShots(payload.shots),
    };
  });
};

const getCreationBoardFallback = (projectId: string): CreationBoardDTO => ({
  id: `creation-${projectId}`,
  projectId,
  updatedAt: "",
  scenes: [],
});

const EMPTY_CREATION_BOARD_FILE: Record<string, never> = {};

const ensureWorkspaceRoot = async (): Promise<void> => {
  await ensureDir(WORKSPACE_ROOT);
};

const CRON_FIELD_COUNT = 5;
const WEEKDAY_TEXTS = [
  "周日",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
] as const;

const isCronWildcard = (field: string): boolean => field.trim() === "*";

const parseCronNumber = (
  field: string,
  min: number,
  max: number,
): number | null => {
  const trimmed = field.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const value = Number.parseInt(trimmed, 10);
  if (value < min || value > max) {
    return null;
  }
  return value;
};

const parseCronStep = (field: string): number | null => {
  const match = field.trim().match(/^\*\/(\d+)$/);
  if (!match?.[1]) return null;

  const value = Number.parseInt(match[1], 10);
  return value > 0 ? value : null;
};

const parseWeekday = (field: string): number | null => {
  const value = parseCronNumber(field, 0, 7);
  if (value === null) return null;
  return value === 7 ? 0 : value;
};

const formatClockSummary = (hour24: number, minute: number): string => {
  const minuteText = minute === 0 ? "" : `${minute}分`;
  if (hour24 <= 5) return `凌晨${hour24}点${minuteText}`;
  if (hour24 <= 8) return `早晨${hour24}点${minuteText}`;
  if (hour24 <= 11) return `上午${hour24}点${minuteText}`;
  if (hour24 === 12) return `中午12点${minuteText}`;

  const hour12 = hour24 - 12;
  if (hour24 <= 17) return `下午${hour12}点${minuteText}`;
  return `晚上${hour12}点${minuteText}`;
};

const toCronTimeSummary = (cron: string): string => {
  const normalized = cron
    .trim()
    .split(/\s+/)
    .filter((field) => field.length > 0)
    .join(" ");
  if (!normalized) return "未设置执行时间";

  const fields = normalized.split(" ");
  if (fields.length !== CRON_FIELD_COUNT) {
    return `按 Cron 执行：${normalized}`;
  }

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] =
    fields;
  const dayOfMonthWildcard = isCronWildcard(dayOfMonthField);
  const monthWildcard = isCronWildcard(monthField);
  const dayOfWeekWildcard = isCronWildcard(dayOfWeekField);

  if (
    isCronWildcard(minuteField) &&
    isCronWildcard(hourField) &&
    dayOfMonthWildcard &&
    monthWildcard &&
    dayOfWeekWildcard
  ) {
    return "每分钟";
  }

  const minuteStep = parseCronStep(minuteField);
  if (
    minuteStep !== null &&
    isCronWildcard(hourField) &&
    dayOfMonthWildcard &&
    monthWildcard &&
    dayOfWeekWildcard
  ) {
    return `每${minuteStep}分钟`;
  }

  const minute = parseCronNumber(minuteField, 0, 59);
  const hourStep = parseCronStep(hourField);
  if (
    hourStep !== null &&
    minute !== null &&
    dayOfMonthWildcard &&
    monthWildcard &&
    dayOfWeekWildcard
  ) {
    if (minute === 0) {
      return `每${hourStep}小时（整点）`;
    }
    return `每${hourStep}小时的第${minute}分钟`;
  }

  if (
    isCronWildcard(hourField) &&
    minute !== null &&
    dayOfMonthWildcard &&
    monthWildcard &&
    dayOfWeekWildcard
  ) {
    return `每小时${minute}分`;
  }

  const hour = parseCronNumber(hourField, 0, 23);
  if (hour !== null && minute !== null) {
    const clockSummary = formatClockSummary(hour, minute);
    const dayOfMonth = parseCronNumber(dayOfMonthField, 1, 31);
    const month = parseCronNumber(monthField, 1, 12);
    const weekday = parseWeekday(dayOfWeekField);

    if (dayOfMonthWildcard && monthWildcard && dayOfWeekWildcard) {
      return `每天${clockSummary}`;
    }

    if (dayOfMonthWildcard && monthWildcard && weekday !== null) {
      return `每${WEEKDAY_TEXTS[weekday]}${clockSummary}`;
    }

    if (
      !dayOfMonthWildcard &&
      dayOfMonth !== null &&
      monthWildcard &&
      dayOfWeekWildcard
    ) {
      return `每月${dayOfMonth}日${clockSummary}`;
    }

    if (
      !dayOfMonthWildcard &&
      dayOfMonth !== null &&
      !monthWildcard &&
      month !== null &&
      dayOfWeekWildcard
    ) {
      return `每年${month}月${dayOfMonth}日${clockSummary}`;
    }
  }

  return `按 Cron 执行：${normalized}`;
};

const normalizeCronJobItems = (value: unknown): CronJobFileItem[] => {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    const payload =
      typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    const rawTargetAgentId =
      typeof payload.targetAgentId === "string"
        ? payload.targetAgentId
        : typeof payload.agentId === "string"
          ? payload.agentId
          : typeof payload.projectId === "string"
            ? payload.projectId
            : "";
    const normalizedTargetAgentId = rawTargetAgentId.trim();
    return {
      cron: typeof payload.cron === "string" ? payload.cron.trim() : "",
      content:
        typeof payload.content === "string" ? payload.content.trim() : "",
      status:
        typeof payload.status === "string" ? payload.status.trim() : "paused",
      targetAgentId:
        normalizedTargetAgentId.length > 0 &&
        normalizedTargetAgentId !== MAIN_AGENT_SCOPE_ID
          ? normalizedTargetAgentId
          : null,
    };
  });
};

const parseCronJobIndex = (id: string): number => {
  const matched = /^cronjob-(\d+)$/.exec(id.trim());
  if (!matched) {
    throw new Error(`定时任务 ID 无效: ${id}`);
  }

  const index = Number.parseInt(matched[1], 10) - 1;
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`定时任务 ID 无效: ${id}`);
  }
  return index;
};

const readCronJobItems = async (): Promise<CronJobFileItem[]> => {
  await ensureWorkspaceRoot();
  const filePath = getCronJobPath();
  const exists = await pathExists(filePath);
  if (!exists) {
    await writeJson<CronJobFileItem[]>(filePath, []);
    return [];
  }

  const raw = await readJson<unknown>(filePath, []);
  return normalizeCronJobItems(raw);
};

const readRawCronJobItems = async (): Promise<unknown[]> => {
  await ensureWorkspaceRoot();
  const filePath = getCronJobPath();
  const exists = await pathExists(filePath);
  if (!exists) {
    await writeJson<unknown[]>(filePath, []);
    return [];
  }

  const raw = await readJson<unknown>(filePath, []);
  return Array.isArray(raw) ? raw : [];
};

const resolveCronJobTargetAgentName = async (
  targetAgentId: string | null | undefined,
): Promise<string | null> => {
  const normalizedTargetAgentId = targetAgentId?.trim();
  if (!normalizedTargetAgentId) {
    return null;
  }

  const metaPath = getProjectMetaPath(normalizedTargetAgentId);
  if (!(await pathExists(metaPath))) {
    return null;
  }

  const project = await readProjectMeta(normalizedTargetAgentId);
  return project.name;
};

const toCronJobDto = async (
  item: CronJobFileItem,
  index: number,
): Promise<CronJobDTO> => ({
  id: `cronjob-${index + 1}`,
  cron: item.cron,
  timeSummary: toCronTimeSummary(item.cron),
  content: item.content,
  status: item.status,
  targetAgentId: item.targetAgentId ?? null,
  targetAgentName: await resolveCronJobTargetAgentName(item.targetAgentId),
});

const readProjectMeta = async (projectId: string): Promise<ProjectMetaFile> => {
  const filePath = getProjectMetaPath(projectId);
  const exists = await pathExists(filePath);
  if (!exists) {
    throw new Error(`项目不存在: ${projectId}`);
  }

  const meta = await readJson<ProjectMetaFile>(filePath, {
    id: projectId,
    name: projectId,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  });

  return {
    ...meta,
    id: projectId,
  };
};

const ensureProjectStructure = async (projectId: string): Promise<void> => {
  await ensureDir(getProjectDir(projectId));
  await ensureDir(getDocsDir(projectId));
  await ensureDir(getAppDir(projectId));
  await ensureDir(getCreationDir(projectId));
  await ensureDir(getAssetsDir(projectId));
  await ensureDir(getGeneratedAssetsDir(projectId));
  await ensureDir(getUserFilesDir(projectId));
  await ensureDir(getChatMessagesDir(projectId));
  await ensureDir(getLogsDir(projectId));

  if (!(await pathExists(getCreationBoardPath(projectId)))) {
    await writeJson<Record<string, never>>(
      getCreationBoardPath(projectId),
      EMPTY_CREATION_BOARD_FILE,
    );
  }

  if (!(await pathExists(getAssetsMetaPath(projectId)))) {
    await writeJson<AssetMetaMap>(getAssetsMetaPath(projectId), {});
  }

  // Keep writing legacy file for backward compatibility; assets list no longer depends on it.
  if (!(await pathExists(getAssetsLegacyIndexPath(projectId)))) {
    await writeJson<AssetDTO[]>(getAssetsLegacyIndexPath(projectId), []);
  }

  if (!(await pathExists(getChatSessionsPath(projectId)))) {
    await writeJson<ChatSessionDTO[]>(getChatSessionsPath(projectId), []);
  }

  if (!(await pathExists(getAgentLogPath(projectId)))) {
    await fs.writeFile(getAgentLogPath(projectId), "", "utf8");
  }

  if (
    !(await pathExists(getAppPackageJsonPath(projectId))) ||
    !(await pathExists(getAppMetadataPath(projectId)))
  ) {
    await initializeAppTemplateFiles(projectId);
  }
};

const migrateLegacyMainAgentContextFiles = async (): Promise<void> => {
  const docsDir = getMainAgentDocsDir();
  await ensureDir(docsDir);

  for (const fileName of LEGACY_MAIN_AGENT_CONTEXT_FILE_NAMES) {
    const legacyPath = path.join(WORKSPACE_ROOT, fileName);
    const nextPath = path.join(docsDir, fileName);
    if ((await pathExists(nextPath)) || !(await pathExists(legacyPath))) {
      continue;
    }
    await fs.copyFile(legacyPath, nextPath);
  }
};

const ensureMainAgentStructure = async (): Promise<void> => {
  await ensureDir(getMainAgentChatMessagesDir());
  await ensureDir(getMainAgentFilesDir());
  await ensureDir(getMainAgentDocsDir());

  if (!(await pathExists(getMainAgentChatSessionsPath()))) {
    await writeJson<ChatSessionDTO[]>(getMainAgentChatSessionsPath(), []);
  }

  await migrateLegacyMainAgentContextFiles();
};

const ensureDocsOwnerStructure = async (projectId: string): Promise<void> => {
  if (projectId.trim() === MAIN_AGENT_SCOPE_ID) {
    await ensureMainAgentStructure();
    return;
  }
  await ensureProjectStructure(projectId);
};

const getScopeType = (scope: ChatScope): ChatSessionDTO["scopeType"] =>
  scope.type === "main" ? "main" : "project";

const getChatSessionsPathByScope = (scope: ChatScope): string =>
  scope.type === "main"
    ? getMainAgentChatSessionsPath()
    : getChatSessionsPath(scope.projectId);

const getChatMessagesPathByScope = (
  scope: ChatScope,
  sessionId: string,
): string =>
  scope.type === "main"
    ? getMainAgentChatMessagesPath(sessionId)
    : getChatMessagesPath(scope.projectId, sessionId);

const getUploadFilesRootByScope = (scope: ChatScope): string =>
  scope.type === "main" ? getMainAgentFilesDir() : getUserFilesDir(scope.projectId);

const getScopeBaseDir = (scope: ChatScope): string =>
  scope.type === "main" ? getMainAgentRootDir() : getProjectDir(scope.projectId);

const _ensuredScopes = new Set<string>();
const ensureChatScopeStructure = async (scope: ChatScope): Promise<void> => {
  const key = scope.type === "main" ? "main" : `project:${scope.projectId}`;
  if (_ensuredScopes.has(key)) return;
  if (scope.type === "main") {
    await ensureMainAgentStructure();
  } else {
    await ensureProjectStructure(scope.projectId);
  }
  _ensuredScopes.add(key);
};

const normalizeChatSession = (
  row: ChatSessionDTO,
  scope: ChatScope,
): ChatSessionDTO => ({
  ...row,
  scopeType: row.scopeType ?? getScopeType(scope),
  projectId:
    scope.type === "project"
      ? row.projectId ?? scope.projectId
      : undefined,
  module: row.module ?? (scope.type === "main" ? "main" : "docs"),
  sdkSessionId: row.sdkSessionId ?? null,
});

const touchProject = async (projectId: string): Promise<void> => {
  if (projectId.trim() === MAIN_AGENT_SCOPE_ID) {
    return;
  }
  const meta = await readProjectMeta(projectId);
  const next: ProjectMetaFile = {
    ...meta,
    updatedAt: nowISO(),
  };
  await writeJson(getProjectMetaPath(projectId), next);
};

const toProjectDto = (meta: ProjectMetaFile): ProjectDTO => ({
  ...meta,
});

const readCreationBoard = async (
  projectId: string,
): Promise<CreationBoardDTO> => {
  await ensureProjectStructure(projectId);

  const fallback = getCreationBoardFallback(projectId);
  const raw = await readJson<Record<string, unknown>>(
    getCreationBoardPath(projectId),
    fallback as unknown as Record<string, unknown>,
  );
  const scenes = normalizeScenes(raw.scenes);

  return {
    id: typeof raw.id === "string" ? raw.id : fallback.id,
    projectId,
    scenes,
    updatedAt:
      typeof raw.updatedAt === "string" ? raw.updatedAt : fallback.updatedAt,
  };
};

const updateChatSessionTimestamp = async (
  scope: ChatScope,
  sessionId: string,
  updatedAt: string,
): Promise<void> => {
  const sessions = await readJson<ChatSessionDTO[]>(
    getChatSessionsPathByScope(scope),
    [],
  );
  const target = sessions.find((item) => item.id === sessionId);
  if (!target) {
    throw new Error("会话不存在");
  }

  target.updatedAt = updatedAt;
  await writeJson(getChatSessionsPathByScope(scope), sessions);
};

export const repositoryService = {
  async listCronJobs(): Promise<CronJobDTO[]> {
    const rows = await readCronJobItems();
    return Promise.all(rows.map((item, index) => toCronJobDto(item, index)));
  },

  async setCronJobStatus(input: {
    id: string;
    status: "active" | "paused";
  }): Promise<CronJobDTO> {
    const rows = await readRawCronJobItems();
    const index = parseCronJobIndex(input.id);
    if (index >= rows.length) {
      throw new Error("定时任务不存在");
    }

    const current = rows[index];
    const next =
      typeof current === "object" && current
        ? { ...(current as Record<string, unknown>) }
        : {};
    next.status = input.status;
    rows[index] = next;

    await writeJson(getCronJobPath(), rows);
    const normalized = normalizeCronJobItems([rows[index]])[0];
    return toCronJobDto(
      normalized ?? {
        cron: "",
        content: "",
        status: input.status,
        targetAgentId: null,
      },
      index,
    );
  },

  async logCronJobExecution(input: {
    executedAt: string;
    jobId: string;
    cron: string;
    content: string;
    status: "dispatched" | "skipped" | "failed";
    projectId?: string | null;
    projectName?: string | null;
    sessionId?: string | null;
    reason?: string | null;
    error?: string | null;
  }): Promise<void> {
    await ensureWorkspaceRoot();

    const line = JSON.stringify({
      executedAt: input.executedAt,
      jobId: input.jobId,
      cron: input.cron,
      content: input.content,
      status: input.status,
      reason: input.reason ?? null,
      error: input.error ?? null,
      project: {
        id: input.projectId ?? null,
        name: input.projectName ?? null,
      },
      sessionId: input.sessionId ?? null,
    });

    await fs.appendFile(getCronJobLogPath(), `${line}\n`, "utf8");
  },

  async listProjects(): Promise<ProjectDTO[]> {
    await ensureWorkspaceRoot();

    const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    const folders = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith("."),
    );

    const projects: ProjectDTO[] = [];

    for (const folder of folders) {
      const projectId = folder.name;
      const metaPath = getProjectMetaPath(projectId);
      if (!(await pathExists(metaPath))) {
        continue;
      }

      const project = await readProjectMeta(projectId);
      projects.push(toProjectDto(project));
    }

    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getProjectById(id: string): Promise<ProjectDTO | null> {
    await ensureWorkspaceRoot();
    const metaPath = getProjectMetaPath(id);
    if (!(await pathExists(metaPath))) {
      return null;
    }
    const project = await readProjectMeta(id);
    return toProjectDto(project);
  },

  async createProject(input: {
    name?: string;
    description?: string;
    cover?: string;
    source?: ProjectCreationSource;
  }): Promise<ProjectDTO> {
    await ensureWorkspaceRoot();

    const source = input.source ?? "agent";
    const identity = await resolveNextProjectIdentity(source);
    const normalizedInputName =
      typeof input.name === "string"
        ? normalizeProjectDisplayName(input.name)
        : "";
    const projectName = normalizedInputName || identity.defaultName;
    const createdAt = nowISO();

    const project: ProjectMetaFile = {
      id: identity.id,
      name: projectName,
      description: input.description,
      cover: input.cover,
      createdAt,
      updatedAt: createdAt,
    };

    await ensureProjectStructure(identity.id);
    await writeJson(getProjectMetaPath(identity.id), project);

    return toProjectDto(project);
  },

  async updateProject(input: {
    id: string;
    name?: string;
    description?: string | null;
    cover?: string | null;
  }): Promise<ProjectDTO> {
    await ensureWorkspaceRoot();

    const current = await readProjectMeta(input.id);
    const normalizedName =
      typeof input.name === "string"
        ? normalizeProjectDisplayName(input.name)
        : undefined;

    const nextMeta: ProjectMetaFile = {
      ...current,
      id: current.id,
      name: normalizedName || current.name,
      description:
        input.description !== undefined
          ? input.description
          : current.description,
      cover: input.cover !== undefined ? input.cover : current.cover,
      updatedAt: nowISO(),
    };

    await writeJson(getProjectMetaPath(current.id), nextMeta);
    return toProjectDto(nextMeta);
  },

  async deleteProject(id: string): Promise<void> {
    await ensureWorkspaceRoot();
    await fs.rm(getProjectDir(id), { recursive: true, force: true });
  },

  async listDocuments(projectId: string): Promise<DocumentDTO[]> {
    await ensureDocsOwnerStructure(projectId);

    const docsDir = getDocsDir(projectId);
    const entries = await listDocsFsEntries(projectId);
    const documentPaths = listEditableDocumentRelativePaths(entries);
    const docs = await Promise.all(
      documentPaths.map(
        async (relativePath): Promise<DocumentDTO | undefined> => {
          const absolutePath = path.join(docsDir, relativePath);
          try {
            const [content, stats] = await Promise.all([
              fs.readFile(absolutePath, "utf8"),
              fs.stat(absolutePath),
            ]);

            return {
              id: relativePath,
              projectId,
              title: relativePath,
              content,
              metadataJson: JSON.stringify({ path: relativePath }),
              version: Math.max(1, Math.trunc(stats.mtimeMs)),
              updatedAt: stats.mtime.toISOString(),
            } satisfies DocumentDTO;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              return undefined;
            }
            throw error;
          }
        },
      ),
    );

    return docs
      .filter((item): item is DocumentDTO => Boolean(item))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async listDocumentExplorer(
    projectId: string,
  ): Promise<DocExplorerEntryDTO[]> {
    await ensureDocsOwnerStructure(projectId);

    const entries = await listDocsFsEntries(projectId);
    return entries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      isEditableText: entry.isEditableText,
      isMarkdown: entry.isMarkdown,
    }));
  },

  async createDocumentDirectory(input: {
    projectId: string;
    path: string;
  }): Promise<DocExplorerEntryDTO> {
    await ensureDocsOwnerStructure(input.projectId);

    const docsDir = getDocsDir(input.projectId);
    const relativeDirectoryPath = sanitizeDocumentDirectoryPath(
      input.path,
      `folder-${Date.now()}`,
    );
    const absoluteDirectoryPath = await resolveUniqueDirectoryPath(
      docsDir,
      relativeDirectoryPath,
    );
    await ensureDir(absoluteDirectoryPath);
    await touchProject(input.projectId);

    const finalRelativePath = toPosixPath(
      path.relative(docsDir, absoluteDirectoryPath),
    );
    return {
      path: finalRelativePath,
      name: path.basename(finalRelativePath),
      kind: "directory",
      isEditableText: false,
      isMarkdown: false,
    };
  },

  async renameDocumentDirectory(input: {
    projectId: string;
    path: string;
    name: string;
  }): Promise<DocExplorerEntryDTO> {
    await ensureDocsOwnerStructure(input.projectId);

    const docsDir = getDocsDir(input.projectId);
    const { absolutePath, relativePath } = resolveDocumentDirectoryPath(
      input.projectId,
      input.path,
    );
    const currentStats = await fs.stat(absolutePath).catch(() => null);
    if (!currentStats || !currentStats.isDirectory()) {
      throw new Error("文件夹不存在");
    }

    const currentName = path.basename(relativePath);
    const nextName = sanitizeDocumentPathSegment(input.name, currentName);
    if (!nextName || nextName === currentName) {
      return {
        path: relativePath,
        name: currentName,
        kind: "directory",
        isEditableText: false,
        isMarkdown: false,
      };
    }

    const parentRelativePath = path.dirname(relativePath);
    const targetRelativePath =
      parentRelativePath === "."
        ? nextName
        : `${parentRelativePath}/${nextName}`;
    const targetAbsolutePath = await resolveUniqueDirectoryPath(
      docsDir,
      targetRelativePath,
    );
    if (targetAbsolutePath !== absolutePath) {
      await fs.rename(absolutePath, targetAbsolutePath);
    }
    await touchProject(input.projectId);

    const finalRelativePath = toPosixPath(
      path.relative(docsDir, targetAbsolutePath),
    );
    return {
      path: finalRelativePath,
      name: path.basename(finalRelativePath),
      kind: "directory",
      isEditableText: false,
      isMarkdown: false,
    };
  },

  async deleteDocumentDirectory(input: {
    projectId: string;
    path: string;
  }): Promise<void> {
    await ensureDocsOwnerStructure(input.projectId);

    const { absolutePath } = resolveDocumentDirectoryPath(
      input.projectId,
      input.path,
    );
    const currentStats = await fs.stat(absolutePath).catch(() => null);
    if (!currentStats) {
      return;
    }
    if (!currentStats.isDirectory()) {
      throw new Error("文件夹不存在");
    }

    await fs.rm(absolutePath, { recursive: true, force: true });
    await touchProject(input.projectId);
  },

  async createDocument(input: {
    projectId: string;
    title: string;
    content: string;
  }): Promise<DocumentDTO> {
    await ensureDocsOwnerStructure(input.projectId);

    const docsDir = getDocsDir(input.projectId);
    const relativePath = sanitizeDocumentRelativePath(
      input.title,
      `note-${Date.now()}`,
    );
    const absolutePath = await resolveUniqueFilePath(docsDir, relativePath);

    await ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, input.content ?? "", "utf8");

    const stats = await fs.stat(absolutePath);
    const finalRelativePath = toPosixPath(path.relative(docsDir, absolutePath));
    await touchProject(input.projectId);

    return {
      id: finalRelativePath,
      projectId: input.projectId,
      title: finalRelativePath,
      content: input.content ?? "",
      metadataJson: JSON.stringify({ path: finalRelativePath }),
      version: Math.max(1, Math.trunc(stats.mtimeMs)),
      updatedAt: stats.mtime.toISOString(),
    };
  },

  async updateDocument(input: {
    projectId: string;
    id: string;
    title?: string;
    content?: string;
    metadataJson?: string | null;
  }): Promise<DocumentDTO> {
    await ensureDocsOwnerStructure(input.projectId);

    const docsDir = getDocsDir(input.projectId);
    let { absolutePath, relativePath } = resolveDocumentPath(
      input.projectId,
      input.id,
    );
    if (!(await pathExists(absolutePath))) {
      throw new Error("文档不存在");
    }

    if (input.title && input.title.trim()) {
      const nextFileName = sanitizeDocumentFileName(
        input.title,
        path.basename(relativePath),
      );
      if (nextFileName !== path.basename(relativePath)) {
        const nextPath = await resolveUniqueFilePath(
          path.dirname(absolutePath),
          nextFileName,
          absolutePath,
        );
        if (nextPath !== absolutePath) {
          await fs.rename(absolutePath, nextPath);
          absolutePath = nextPath;
          relativePath = toPosixPath(path.relative(docsDir, absolutePath));
        }
      }
    }

    const currentContent = await fs
      .readFile(absolutePath, "utf8")
      .catch(() => "");
    const nextContent = input.content ?? currentContent;
    if (input.content !== undefined && nextContent !== currentContent) {
      await fs.writeFile(absolutePath, nextContent, "utf8");
    }

    const stats = await fs.stat(absolutePath);
    await touchProject(input.projectId);

    return {
      id: relativePath,
      projectId: input.projectId,
      title: relativePath,
      content: nextContent,
      metadataJson: JSON.stringify({ path: relativePath }),
      version: Math.max(1, Math.trunc(stats.mtimeMs)),
      updatedAt: stats.mtime.toISOString(),
    };
  },

  async renameDocumentFile(input: {
    projectId: string;
    path: string;
    name: string;
  }): Promise<DocExplorerEntryDTO> {
    await ensureDocsOwnerStructure(input.projectId);

    const docsDir = getDocsDir(input.projectId);
    const { absolutePath, relativePath } = resolveDocsFilePath(
      input.projectId,
      input.path,
    );
    const currentStats = await fs.stat(absolutePath).catch(() => null);
    if (!currentStats || !currentStats.isFile()) {
      throw new Error("文件不存在");
    }

    const currentName = path.basename(relativePath);
    const nextName = sanitizeExistingFileName(input.name, currentName);
    if (!nextName || nextName === currentName) {
      return {
        path: relativePath,
        name: currentName,
        kind: "file",
        isEditableText: isEditableTextDocument(relativePath),
        isMarkdown: isMarkdownFile(relativePath),
      };
    }

    const targetRelativePath = toPosixPath(
      path.join(path.dirname(relativePath), nextName),
    );
    const targetAbsolutePath = await resolveUniqueFilePath(
      docsDir,
      targetRelativePath,
      absolutePath,
    );
    if (targetAbsolutePath !== absolutePath) {
      await fs.rename(absolutePath, targetAbsolutePath);
    }
    await touchProject(input.projectId);

    const finalRelativePath = toPosixPath(
      path.relative(docsDir, targetAbsolutePath),
    );
    return {
      path: finalRelativePath,
      name: path.basename(finalRelativePath),
      kind: "file",
      isEditableText: isEditableTextDocument(finalRelativePath),
      isMarkdown: isMarkdownFile(finalRelativePath),
    };
  },

  async deleteDocument(projectId: string, id: string): Promise<void> {
    await ensureDocsOwnerStructure(projectId);

    const { absolutePath } = resolveDocsFilePath(projectId, id);
    const currentStats = await fs.stat(absolutePath).catch(() => null);
    if (!currentStats) {
      return;
    }
    if (!currentStats.isFile()) {
      throw new Error("文件不存在");
    }

    await fs.rm(absolutePath, { force: true });
    await touchProject(projectId);
  },

  async getAppWorkspaceStatus(
    projectId: string,
  ): Promise<AppWorkspaceStatusDTO> {
    await ensureProjectStructure(projectId);
    return readAppWorkspaceStatus(projectId);
  },

  async initializeAppWorkspace(
    projectId: string,
  ): Promise<AppWorkspaceStatusDTO> {
    await ensureProjectStructure(projectId);
    const { createdFiles } = await initializeAppTemplateFiles(projectId);
    if (createdFiles.length > 0) {
      await touchProject(projectId);
    }
    return readAppWorkspaceStatus(projectId);
  },

  async buildAppWorkspace(projectId: string): Promise<AppBuildResultDTO> {
    await ensureProjectStructure(projectId);
    await initializeAppTemplateFiles(projectId);

    const appDir = getAppDir(projectId);
    let installedDependencies = false;

    if (!(await pathExists(path.join(appDir, "node_modules")))) {
      await runPackageManagerTask({
        cwd: appDir,
        pnpmArgs: ["install"],
        npmArgs: ["install"],
      });
      installedDependencies = true;
    }

    await runPackageManagerTask({
      cwd: appDir,
      pnpmArgs: ["run", "build"],
      npmArgs: ["run", "build"],
    });

    const distIndexPath = getAppDistIndexPath(projectId);
    if (!(await pathExists(distIndexPath))) {
      throw new Error("应用构建已执行，但未找到 app/dist/index.html");
    }

    const stats = await fs.stat(distIndexPath);
    await updateAppMetadata(projectId, {
      buildTime: stats.mtime.toISOString(),
    });
    await touchProject(projectId);

    return {
      projectId,
      appDir,
      distIndexPath,
      builtAt: stats.mtime.toISOString(),
      installedDependencies,
    };
  },

  async getCreationBoard(projectId: string): Promise<CreationBoardDTO> {
    return readCreationBoard(projectId);
  },

  async replaceCreationBoard(
    projectId: string,
    scenes: unknown,
  ): Promise<CreationBoardDTO> {
    const current = await readCreationBoard(projectId);

    const next: CreationBoardDTO = {
      id: current.id,
      projectId,
      scenes: normalizeScenes(scenes),
      updatedAt: nowISO(),
    };

    await writeJson(getCreationBoardPath(projectId), next);
    await touchProject(projectId);

    return next;
  },

  async listAssets(
    projectId: string,
    options?: { search?: string; tags?: string[] },
  ): Promise<AssetDTO[]> {
    await ensureProjectStructure(projectId);

    const assetsDir = getAssetsDir(projectId);
    const assetRelativePaths = await collectAssetFiles(assetsDir);
    const metaMap = await readAssetMetaMap(projectId);
    const keyword = options?.search?.trim().toLowerCase();
    const tagFilter = normalizeAssetTagsFilter(options?.tags);

    const rows = await Promise.all(
      assetRelativePaths.map(async (assetRelativePath) => {
        try {
          return await buildAssetDto({
            projectId,
            assetRelativePath,
            metaMap,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
          }
          throw error;
        }
      }),
    );

    return rows
      .filter((item): item is AssetDTO => Boolean(item))
      .filter((item) => {
        if (tagFilter.length > 0) {
          const itemTags = normalizeAssetTagsFilter(
            (() => {
              try {
                return JSON.parse(item.tagsJson ?? "[]") as string[];
              } catch {
                return [];
              }
            })(),
          );
          const matched = tagFilter.every((tag) => itemTags.includes(tag));
          if (!matched) return false;
        }

        if (!keyword) return true;

        const meta = parseAssetMetaJson(item.metaJson);
        const searchableText = [
          item.name,
          item.path,
          item.type,
          meta?.provider,
          meta?.model,
          meta?.prompt,
        ]
          .filter((text): text is string => Boolean(text))
          .join(" ")
          .toLowerCase();
        return searchableText.includes(keyword);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async importAsset(input: {
    projectId: string;
    type: "image" | "video" | "audio";
    name: string;
    path: string;
    duration?: number;
    thumbnailPath?: string;
    tags?: string[];
  }): Promise<AssetDTO> {
    await ensureProjectStructure(input.projectId);

    const sourcePath = path.resolve(input.path);
    const sourceStats = await fs.stat(sourcePath);
    if (!sourceStats.isFile()) {
      throw new Error(`不是有效文件: ${input.path}`);
    }

    const userFilesDir = getUserFilesDir(input.projectId);
    const fallbackName = path.basename(sourcePath) || "file";
    const requestedName = toNonEmptyString(input.name, fallbackName);
    const safeName = sanitizeUploadFileName(requestedName, fallbackName);
    const { absolutePath, finalName } = await resolveUniqueUploadFilePath(
      userFilesDir,
      safeName,
    );
    await fs.copyFile(sourcePath, absolutePath);

    const relativePath = toAssetRelativePath(input.projectId, absolutePath);
    const metaMap = await readAssetMetaMap(input.projectId);
    const timestamp = nowISO();
    metaMap[relativePath] = {
      ...metaMap[relativePath],
      source: ASSET_TAG_USER,
      createdAt: metaMap[relativePath]?.createdAt ?? timestamp,
      updatedAt: timestamp,
      parameters: {
        import_type: input.type,
        original_path: sourcePath,
        requested_tags: input.tags ?? [],
      },
    };
    await writeAssetMetaMap(input.projectId, metaMap);
    await touchProject(input.projectId);

    const asset = await buildAssetDto({
      projectId: input.projectId,
      assetRelativePath: relativePath,
      metaMap,
    });

    return {
      ...asset,
      name: finalName,
    };
  },

  async saveFileToAssets(input: {
    projectId: string;
    fileName: string;
    data: Buffer;
  }): Promise<AssetDTO> {
    await ensureProjectStructure(input.projectId);

    const userFilesDir = getUserFilesDir(input.projectId);
    const fallbackName = "file";
    const safeName = sanitizeUploadFileName(input.fileName, fallbackName);
    const { absolutePath, finalName } = await resolveUniqueUploadFilePath(
      userFilesDir,
      safeName,
    );
    await fs.writeFile(absolutePath, input.data);

    const relativePath = toAssetRelativePath(input.projectId, absolutePath);
    const metaMap = await readAssetMetaMap(input.projectId);
    const timestamp = nowISO();
    const assetType = getAssetTypeByFileName(finalName);
    metaMap[relativePath] = {
      ...metaMap[relativePath],
      source: ASSET_TAG_USER,
      createdAt: metaMap[relativePath]?.createdAt ?? timestamp,
      updatedAt: timestamp,
      parameters: {
        import_type: assetType,
        original_path: "sdk:saveFileToAssets",
        requested_tags: [],
      },
    };
    await writeAssetMetaMap(input.projectId, metaMap);
    await touchProject(input.projectId);

    const asset = await buildAssetDto({
      projectId: input.projectId,
      assetRelativePath: relativePath,
      metaMap,
    });

    return {
      ...asset,
      name: finalName,
    };
  },

  async deleteAsset(id: string): Promise<void> {
    const projects = await repositoryService.listProjects();

    for (const project of projects) {
      const absolutePath = resolveAssetAbsolutePath(project.id, id);
      if (absolutePath && (await pathExists(absolutePath))) {
        const stats = await fs.stat(absolutePath).catch(() => null);
        if (stats?.isFile()) {
          await fs.rm(absolutePath, { force: true });
        }

        const assetRelativePath = toAssetRelativePath(project.id, absolutePath);
        const metaMap = await readAssetMetaMap(project.id);
        if (assetRelativePath in metaMap) {
          delete metaMap[assetRelativePath];
          await writeAssetMetaMap(project.id, metaMap);
        }

        const legacyRows = await readJson<AssetDTO[]>(
          getAssetsLegacyIndexPath(project.id),
          [],
        );
        const legacyNext = legacyRows.filter(
          (item) => item.id !== id && item.path !== id,
        );
        if (legacyNext.length !== legacyRows.length) {
          await writeJson(getAssetsLegacyIndexPath(project.id), legacyNext);
        }

        await touchProject(project.id);
        return;
      }

      const legacyRows = await readJson<AssetDTO[]>(
        getAssetsLegacyIndexPath(project.id),
        [],
      );
      const legacyNext = legacyRows.filter((item) => item.id !== id);
      if (legacyNext.length === legacyRows.length) {
        continue;
      }

      await writeJson(getAssetsLegacyIndexPath(project.id), legacyNext);
      await touchProject(project.id);
      return;
    }
  },

  async uploadChatFiles(input: {
    scope: ChatScope;
    files: ChatUploadFilePayload[];
  }): Promise<ChatAttachmentDTO[]> {
    await ensureChatScopeStructure(input.scope);

    const userFilesDir = getUploadFilesRootByScope(input.scope);
    const scopeBaseDir = getScopeBaseDir(input.scope);
    const projectScope = input.scope.type === "project" ? input.scope : null;
    const assetsDir = projectScope ? getAssetsDir(projectScope.projectId) : null;
    const metaMap = projectScope
      ? await readAssetMetaMap(projectScope.projectId)
      : null;
    let metaUpdated = false;
    const uploads: ChatAttachmentDTO[] = [];

    for (const file of input.files) {
      const sourcePath = path.resolve(file.sourcePath);
      const sourceStats = await fs.stat(sourcePath);
      if (!sourceStats.isFile()) {
        throw new Error(`不是有效文件: ${file.sourcePath}`);
      }

      const fallbackName = path.basename(sourcePath) || "file";
      const safeName = sanitizeUploadFileName(file.name, fallbackName);
      if (!isSupportedUserFile(safeName, file.mimeType)) {
        throw new Error(`不支持的文件类型: ${safeName}`);
      }

      const { absolutePath, finalName } = await resolveUniqueUploadFilePath(
        userFilesDir,
        safeName,
      );
      await fs.copyFile(sourcePath, absolutePath);

      if (assetsDir && metaMap) {
        const assetRelativePath = normalizeAssetRelativePath(
          path.relative(assetsDir, absolutePath),
        );
        const timestamp = nowISO();
        metaMap[assetRelativePath] = {
          ...metaMap[assetRelativePath],
          source: ASSET_TAG_USER,
          createdAt: metaMap[assetRelativePath]?.createdAt ?? timestamp,
          updatedAt: timestamp,
          parameters: {
            file_name: finalName,
            mime_type: file.mimeType ?? null,
            size_bytes: sourceStats.size,
          },
        };
        metaUpdated = true;
      }

      uploads.push({
        name: finalName,
        path: toPosixPath(path.relative(scopeBaseDir, absolutePath)),
        mimeType: file.mimeType,
        size: sourceStats.size,
      });
    }

    if (metaUpdated && metaMap && input.scope.type === "project") {
      await writeAssetMetaMap(input.scope.projectId, metaMap);
    }

    if (input.scope.type === "project") {
      await touchProject(input.scope.projectId);
    }
    return uploads;
  },

  async createChatSession(input: {
    scope: ChatScope;
    module: ChatModuleType;
    title: string;
  }): Promise<ChatSessionDTO> {
    await ensureChatScopeStructure(input.scope);

    const rows = await readJson<ChatSessionDTO[]>(
      getChatSessionsPathByScope(input.scope),
      [],
    );

    const timestamp = nowISO();

    const next: ChatSessionDTO = {
      id: randomUUID(),
      scopeType: getScopeType(input.scope),
      projectId: input.scope.type === "project" ? input.scope.projectId : undefined,
      module: input.module,
      title: input.title.trim(),
      sdkSessionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await writeJson(getChatSessionsPathByScope(input.scope), [...rows, next]);
    if (input.scope.type === "project") {
      await touchProject(input.scope.projectId);
    }
    chatEvents.emitHistoryUpdated({
      scope: input.scope,
      sessionId: next.id,
      messageId: "",
      role: "system",
      createdAt: timestamp,
      sessionTitle: next.title,
      sessionUpdatedAt: timestamp,
      sessionModule: input.module,
    });

    return next;
  },

  async listChatSessions(scope: ChatScope): Promise<ChatSessionDTO[]> {
    await ensureChatScopeStructure(scope);

    const rows = await readJson<ChatSessionDTO[]>(
      getChatSessionsPathByScope(scope),
      [],
    );

    return rows
      .map((row) => normalizeChatSession(row, scope))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getChatSession(
    scope: ChatScope,
    sessionId: string,
  ): Promise<ChatSessionDTO | null> {
    await ensureChatScopeStructure(scope);
    const rows = await readJson<ChatSessionDTO[]>(
      getChatSessionsPathByScope(scope),
      [],
    );
    const session = rows
      .map((row) => normalizeChatSession(row, scope))
      .find((item) => item.id === sessionId);
    if (!session) {
      return null;
    }
    return session;
  },

  async setChatSessionSdkSessionId(input: {
    scope: ChatScope;
    sessionId: string;
    sdkSessionId?: string | null;
  }): Promise<void> {
    await ensureChatScopeStructure(input.scope);
    const rows = await readJson<ChatSessionDTO[]>(
      getChatSessionsPathByScope(input.scope),
      [],
    );
    const session = rows.find((item) => item.id === input.sessionId);
    if (!session) {
      return;
    }
    session.sdkSessionId = input.sdkSessionId ?? null;
    await writeJson(getChatSessionsPathByScope(input.scope), rows);
  },

  async deleteChatSession(input: {
    scope: ChatScope;
    sessionId: string;
  }): Promise<void> {
    await ensureChatScopeStructure(input.scope);
    const rows = await readJson<ChatSessionDTO[]>(
      getChatSessionsPathByScope(input.scope),
      [],
    );
    const filtered = rows.filter((item) => item.id !== input.sessionId);
    await writeJson(getChatSessionsPathByScope(input.scope), filtered);

    // Also remove the messages file for this session
    const messagesPath = getChatMessagesPathByScope(input.scope, input.sessionId);
    try {
      await fs.unlink(messagesPath);
    } catch {
      // File may not exist, ignore
    }

    if (input.scope.type === "project") {
      await touchProject(input.scope.projectId);
    }
  },

  async updateChatSessionTitle(input: {
    scope: ChatScope;
    sessionId: string;
    title: string;
  }): Promise<void> {
    await ensureChatScopeStructure(input.scope);
    const rows = await readJson<ChatSessionDTO[]>(
      getChatSessionsPathByScope(input.scope),
      [],
    );
    const session = rows.find((item) => item.id === input.sessionId);
    if (!session) {
      return;
    }
    const title = input.title.trim();
    const updatedAt = nowISO();
    session.title = title;
    session.updatedAt = updatedAt;
    await writeJson(getChatSessionsPathByScope(input.scope), rows);
    chatEvents.emitHistoryUpdated({
      scope: input.scope,
      sessionId: input.sessionId,
      messageId: "",
      role: "system",
      createdAt: updatedAt,
      sessionTitle: title,
      sessionUpdatedAt: updatedAt,
      sessionModule: session.module,
    });
  },

  async listMessages(
    scope: ChatScope,
    sessionId: string,
  ): Promise<ChatMessageDTO[]> {
    await ensureChatScopeStructure(scope);

    const rows = await readJson<ChatMessageDTO[]>(
      getChatMessagesPathByScope(scope, sessionId),
      [],
    );

    return rows
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-100);
  },

  async appendMessage(input: {
    scope: ChatScope;
    sessionId: string;
    role: "user" | "assistant" | "tool" | "system";
    content: string;
    toolCallJson?: string;
    metadataJson?: string;
    createdAt?: string;
  }): Promise<ChatMessageDTO> {
    await ensureChatScopeStructure(input.scope);
    const sessions = await readJson<ChatSessionDTO[]>(
      getChatSessionsPathByScope(input.scope),
      [],
    );
    const sessionExists = sessions.some((item) => item.id === input.sessionId);
    if (!sessionExists) {
      throw new Error("会话不存在");
    }
    const createdAt = input.createdAt?.trim() || nowISO();

    const next: ChatMessageDTO = {
      id: randomUUID(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      toolCallJson: input.toolCallJson,
      metadataJson: input.metadataJson,
      createdAt,
    };

    const rows = await readJson<ChatMessageDTO[]>(
      getChatMessagesPathByScope(input.scope, input.sessionId),
      [],
    );
    rows.push(next);
    await writeJson(
      getChatMessagesPathByScope(input.scope, input.sessionId),
      rows,
    );

    const sessionUpdatedAt = nowISO();
    await updateChatSessionTimestamp(input.scope, input.sessionId, sessionUpdatedAt);
    if (input.scope.type === "project") {
      await touchProject(input.scope.projectId);
    }
    chatEvents.emitHistoryUpdated({
      scope: input.scope,
      sessionId: input.sessionId,
      messageId: next.id,
      role: next.role,
      createdAt: next.createdAt,
      sessionUpdatedAt,
    });

    return next;
  },

  async logAgentAction(input: {
    projectId: string;
    module: ModuleType;
    actionType: string;
    payloadJson: string;
    status: string;
  }): Promise<void> {
    await ensureProjectStructure(input.projectId);

    const line = JSON.stringify({
      ...input,
      createdAt: nowISO(),
    });

    await fs.appendFile(getAgentLogPath(input.projectId), `${line}\n`, "utf8");
  },
};
