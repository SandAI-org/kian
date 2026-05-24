import type {
  InstalledSkillDTO,
  SkillConfigDTO,
  SkillListItemDTO,
  SkillRepositoryDTO,
} from "@shared/types";
import { formatUtcTimestampToLocal } from "@shared/utils/dateTime";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "./logger";
import { GLOBAL_CONFIG_DIR, INTERNAL_ROOT, WORKSPACE_ROOT } from "./workspacePaths";

const BUILTIN_REPOSITORY_URL = "https://github.com/anthropics/skills";
const BUILTIN_LOCAL_REPOSITORY_URL = "builtin://kian";
const LOCAL_SKILL_REPOSITORY_URL = "local://kian";
const CLAWHUB_DOWNLOAD_URL = "https://wry-manatee-359.convex.site/api/v1/download";
const CLAWHUB_REPOSITORY_URL_PREFIX = "https://clawhub.ai";
const SKILLS_CONFIG_PATH = path.join(INTERNAL_ROOT, "skills.json");
const LEGACY_GLOBAL_SKILLS_DIR = path.join(WORKSPACE_ROOT, ".agents", "skills");
const INSTALLED_SKILLS_DIR = path.join(INTERNAL_ROOT, "skills", "installed");
const AGENT_RESOURCE_ROOT = path.join(INTERNAL_ROOT, "agent-resources");
const SKILL_META_FILE = ".skill.json";
const SKILL_FILE = "SKILL.md";
const SKILLS_REPOSITORY_DIR = "skills";
const BUILTIN_SKILLS_DIR = "builtin";
const REPOSITORIES_FILE = "repositories.json";
const SKILL_METADATA_CACHE_PATH = path.join(
  INTERNAL_ROOT,
  "skill-metadata-cache.json",
);
const GLOBAL_SKILL_REPOSITORY_CACHE_DIR = path.join(
  GLOBAL_CONFIG_DIR,
  "cache",
  "skill-repositories",
);
const SKILL_METADATA_SCHEMA_VERSION = 2;
const GIT_COMMAND_TIMEOUT_MS = 60_000;
const GIT_COMMAND_MAX_BUFFER = 8 * 1024 * 1024;
const ARCHIVE_DOWNLOAD_TIMEOUT_MS = 120_000;
const SKILL_IMPORTS_TEMP_DIR = path.join(INTERNAL_ROOT, "skill-imports");
const PROCESS_RESOURCES_PATH =
  typeof process.resourcesPath === "string" ? process.resourcesPath : "";
const PROCESS_RESOURCES_APP_ASAR_PATH = PROCESS_RESOURCES_PATH
  ? path.join(PROCESS_RESOURCES_PATH, "app.asar")
  : "";
const PROCESS_RESOURCES_APP_ASAR_UNPACKED_PATH = PROCESS_RESOURCES_PATH
  ? path.join(PROCESS_RESOURCES_PATH, "app.asar.unpacked")
  : "";
const REPOSITORIES_FILE_CANDIDATES = [
  path.join(process.cwd(), SKILLS_REPOSITORY_DIR, REPOSITORIES_FILE),
  path.resolve(__dirname, "..", "..", SKILLS_REPOSITORY_DIR, REPOSITORIES_FILE),
  path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    SKILLS_REPOSITORY_DIR,
    REPOSITORIES_FILE,
  ),
  path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    SKILLS_REPOSITORY_DIR,
    REPOSITORIES_FILE,
  ),
  ...(PROCESS_RESOURCES_APP_ASAR_PATH
    ? [
        path.join(
          PROCESS_RESOURCES_APP_ASAR_PATH,
          SKILLS_REPOSITORY_DIR,
          REPOSITORIES_FILE,
        ),
      ]
    : []),
  ...(PROCESS_RESOURCES_APP_ASAR_UNPACKED_PATH
    ? [
        path.join(
          PROCESS_RESOURCES_APP_ASAR_UNPACKED_PATH,
          SKILLS_REPOSITORY_DIR,
          REPOSITORIES_FILE,
        ),
      ]
    : []),
  ...(PROCESS_RESOURCES_PATH
    ? [
        path.join(
          PROCESS_RESOURCES_PATH,
          SKILLS_REPOSITORY_DIR,
          REPOSITORIES_FILE,
        ),
      ]
    : []),
];
const BUILTIN_SKILLS_ROOT_CANDIDATES = [
  path.join(process.cwd(), SKILLS_REPOSITORY_DIR, BUILTIN_SKILLS_DIR),
  path.resolve(
    __dirname,
    "..",
    "..",
    SKILLS_REPOSITORY_DIR,
    BUILTIN_SKILLS_DIR,
  ),
  path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    SKILLS_REPOSITORY_DIR,
    BUILTIN_SKILLS_DIR,
  ),
  path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    SKILLS_REPOSITORY_DIR,
    BUILTIN_SKILLS_DIR,
  ),
  ...(PROCESS_RESOURCES_APP_ASAR_PATH
    ? [
        path.join(
          PROCESS_RESOURCES_APP_ASAR_PATH,
          SKILLS_REPOSITORY_DIR,
          BUILTIN_SKILLS_DIR,
        ),
      ]
    : []),
  ...(PROCESS_RESOURCES_APP_ASAR_UNPACKED_PATH
    ? [
        path.join(
          PROCESS_RESOURCES_APP_ASAR_UNPACKED_PATH,
          SKILLS_REPOSITORY_DIR,
          BUILTIN_SKILLS_DIR,
        ),
      ]
    : []),
  ...(PROCESS_RESOURCES_PATH
    ? [
        path.join(
          PROCESS_RESOURCES_PATH,
          SKILLS_REPOSITORY_DIR,
          BUILTIN_SKILLS_DIR,
        ),
      ]
    : []),
];

interface SkillsConfigFile {
  repositories: string[];
}

interface LoadedSkillsConfig extends SkillsConfigFile {
  builtinRepositories: string[];
}

interface SkillMetadataCacheFile {
  repositories: Record<string, RepositorySkillMetadataCache>;
}

interface RepositorySkillMetadataCache {
  updatedAt: string;
  skills: Record<string, SkillMetadataEntry>;
}

interface SkillMetadataEntry {
  schemaVersion: number;
  skillFileSha: string;
  title: string;
  description: string;
  frontMatter: Record<string, string>;
  updatedAt: string;
}

interface SkillMetadataRefreshResult {
  updatedCount: number;
  totalCount: number;
}

interface InstalledSkillMetaFile {
  id: string;
  name: string;
  repositoryUrl: string;
  skillPath: string;
  installedAt: string;
  mainAgentVisible: boolean;
  projectAgentVisible: boolean;
}

interface InstalledSkillMetaRecord
  extends Omit<
    InstalledSkillMetaFile,
    "mainAgentVisible" | "projectAgentVisible"
  > {
  mainAgentVisible?: boolean;
  projectAgentVisible?: boolean;
}

interface ActiveAgentSkillInfo {
  dirName: string;
  title: string;
  description: string;
  skillFilePath: string;
}

interface SkillSourceDir {
  sourceDir: string;
  skillName: string;
  skillPath: string;
}

interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  canonicalUrl: string;
}

const metadataRefreshTasks = new Map<
  string,
  Promise<SkillMetadataRefreshResult>
>();
let metadataCacheWriteTask: Promise<void> = Promise.resolve();
const execFileAsync = promisify(execFile);

const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const DEFAULT_SKILL_VISIBILITY: {
  mainAgentVisible: boolean;
  projectAgentVisible: boolean;
} = {
  mainAgentVisible: true,
  projectAgentVisible: true,
};

type SkillVisibility = typeof DEFAULT_SKILL_VISIBILITY;

const toPosixPath = (filePath: string): string => filePath.replace(/\\/g, "/");

const readSkillDefaultVisibility = async (
  skillDir: string,
): Promise<SkillVisibility> => {
  const metaPath = path.join(skillDir, SKILL_META_FILE);
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<InstalledSkillMetaFile>;
    return {
      mainAgentVisible:
        typeof parsed.mainAgentVisible === "boolean"
          ? parsed.mainAgentVisible
          : DEFAULT_SKILL_VISIBILITY.mainAgentVisible,
      projectAgentVisible:
        typeof parsed.projectAgentVisible === "boolean"
          ? parsed.projectAgentVisible
          : DEFAULT_SKILL_VISIBILITY.projectAgentVisible,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_SKILL_VISIBILITY;
    }
    throw error;
  }
};

const resolveSkillVisibility = (
  meta: Pick<
    InstalledSkillMetaRecord,
    "mainAgentVisible" | "projectAgentVisible"
  >,
  fallbackVisibility: SkillVisibility = DEFAULT_SKILL_VISIBILITY,
): SkillVisibility => ({
  mainAgentVisible:
    typeof meta.mainAgentVisible === "boolean"
      ? meta.mainAgentVisible
      : fallbackVisibility.mainAgentVisible,
  projectAgentVisible:
    typeof meta.projectAgentVisible === "boolean"
      ? meta.projectAgentVisible
      : fallbackVisibility.projectAgentVisible,
});

const parseGitHubRepositoryUrl = (input: string): GitHubRepositoryRef => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("仓库地址不能为空");
  }

  const shortMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shortMatch) {
    const owner = shortMatch[1];
    const repo = shortMatch[2].replace(/\.git$/i, "");
    return {
      owner,
      repo,
      canonicalUrl: `https://github.com/${owner}/${repo}`,
    };
  }

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("仓库地址格式不正确");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "github.com" && hostname !== "www.github.com") {
    throw new Error("当前仅支持 GitHub 仓库");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error("仓库地址需包含 owner/repo");
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (!owner || !repo) {
    throw new Error("仓库地址需包含 owner/repo");
  }

  return {
    owner,
    repo,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  };
};

const normalizeSkillPath = (input: string): string => {
  const normalized = toPosixPath(input)
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("技能路径不能为空");
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("技能路径不合法");
  }

  return segments.join("/");
};

const sanitizeDirName = (input: string): string => {
  const normalized = input
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return normalized || "skill";
};

const buildRepositoryCacheDirName = (
  repository: GitHubRepositoryRef,
): string => {
  const readableName = sanitizeDirName(
    `${repository.owner}-${repository.repo}`.toLowerCase(),
  );
  const hash = createHash("sha256")
    .update(repository.canonicalUrl)
    .digest("hex")
    .slice(0, 10);
  return `${readableName}-${hash}`;
};

const getRepositoryCacheDir = (repository: GitHubRepositoryRef): string =>
  path.join(
    GLOBAL_SKILL_REPOSITORY_CACHE_DIR,
    buildRepositoryCacheDirName(repository),
  );

const getCommandErrorDetails = (error: unknown): string => {
  const execError = error as NodeJS.ErrnoException & {
    stdout?: string;
    stderr?: string;
  };
  const stderr = execError.stderr?.trim();
  if (stderr) {
    return stderr;
  }

  const stdout = execError.stdout?.trim();
  if (stdout) {
    return stdout;
  }

  return execError.message || "未知错误";
};

const runCommand = async (
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options?.cwd,
      env: process.env,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: GIT_COMMAND_MAX_BUFFER,
    });
    return stdout;
  } catch (error) {
    const execError = error as NodeJS.ErrnoException;
    if (execError.code === "ENOENT") {
      throw execError;
    }

    throw new Error(
      `执行 ${command} ${args[0] ?? ""} 失败：${getCommandErrorDetails(error)}`,
    );
  }
};

const hasCommand = async (command: string): Promise<boolean> => {
  try {
    await runCommand(command, ["--version"]);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT"
      ? true
      : false;
  }
};

const downloadRepositoryArchiveToCache = async (
  repository: GitHubRepositoryRef,
  cacheDir: string,
): Promise<void> => {
  if (!(await hasCommand("tar"))) {
    throw new Error("未检测到 tar 命令，无法解压技能仓库归档");
  }
  const tempDir = path.join(
    GLOBAL_SKILL_REPOSITORY_CACHE_DIR,
    `${buildRepositoryCacheDirName(repository)}-tmp-${Date.now()}`,
  );
  const archivePath = path.join(tempDir, "repository.tar.gz");
  const extractDir = path.join(tempDir, "extract");

  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.rm(cacheDir, { recursive: true, force: true });
  await ensureDir(extractDir);

  try {
    const response = await fetch(
      `${repository.canonicalUrl}/archive/HEAD.tar.gz`,
      {
        headers: buildGitHubHeaders(),
        signal: AbortSignal.timeout(ARCHIVE_DOWNLOAD_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(
        `下载仓库归档失败（${response.status}）${
          details.trim() ? `：${details.trim()}` : ""
        }`,
      );
    }

    const archiveBuffer = Buffer.from(await response.arrayBuffer());
    await ensureDir(tempDir);
    await fs.writeFile(archivePath, archiveBuffer);
    await runCommand("tar", ["-xzf", archivePath, "-C", extractDir]);

    const extractedEntries = await fs.readdir(extractDir, {
      withFileTypes: true,
    });
    const extractedRoot = extractedEntries.find((entry) => entry.isDirectory());
    if (!extractedRoot) {
      throw new Error("仓库归档解压失败：未找到仓库目录");
    }

    await fs.rename(path.join(extractDir, extractedRoot.name), cacheDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const ensureRepositoryCache = async (
  repository: GitHubRepositoryRef,
  options?: { forceRefresh?: boolean },
): Promise<string> => {
  const cacheDir = getRepositoryCacheDir(repository);
  const shouldRefresh = options?.forceRefresh ?? false;

  if (shouldRefresh || !(await pathExists(cacheDir))) {
    await downloadRepositoryArchiveToCache(repository, cacheDir);
    return cacheDir;
  }
  return cacheDir;
};

const resolveCachedSkillSourceDir = async (
  repository: GitHubRepositoryRef,
  skillPath: string,
): Promise<string> => {
  const cacheDir = await ensureRepositoryCache(repository);
  const normalizedSkillPath = normalizeSkillPath(skillPath);
  const sourceDir = path.join(cacheDir, ...normalizedSkillPath.split("/"));

  let sourceStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    sourceStat = await fs.stat(sourceDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("未找到技能目录，无法安装该技能");
    }
    throw error;
  }

  if (!sourceStat.isDirectory()) {
    throw new Error("技能路径不是目录，无法安装该技能");
  }

  const skillMainFilePath = path.join(sourceDir, SKILL_FILE);
  if (!(await pathExists(skillMainFilePath))) {
    throw new Error("未找到 SKILL.md，无法安装该技能");
  }

  return sourceDir;
};

const createTempImportDir = async (prefix: string): Promise<string> => {
  await ensureDir(SKILL_IMPORTS_TEMP_DIR);
  return fs.mkdtemp(path.join(SKILL_IMPORTS_TEMP_DIR, `${prefix}-`));
};

const collectSkillSourceDirsFromDirectory = async (
  rootDir: string,
): Promise<SkillSourceDir[]> => {
  if (await pathExists(path.join(rootDir, SKILL_FILE))) {
    const skillName = path.basename(rootDir);
    return [
      {
        sourceDir: rootDir,
        skillName,
        skillPath: skillName,
      },
    ];
  }

  const sources: SkillSourceDir[] = [];
  const walk = async (
    currentDir: string,
    relativePath: string,
  ): Promise<void> => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const hasSkillFile = entries.some(
      (entry) => entry.isFile() && entry.name === SKILL_FILE,
    );

    if (hasSkillFile && relativePath) {
      sources.push({
        sourceDir: currentDir,
        skillName: path.posix.basename(relativePath),
        skillPath: normalizeSkillPath(relativePath),
      });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const nextRelativePath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      await walk(path.join(currentDir, entry.name), nextRelativePath);
    }
  };

  await walk(rootDir, "");
  return sources;
};

const collectSkillSourceDirsFromPath = async (
  sourcePath: string,
): Promise<SkillSourceDir[]> => {
  const normalizedPath = path.resolve(sourcePath.trim());
  const stats = await fs.stat(normalizedPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("本地路径不存在");
    }
    throw error;
  });

  if (stats.isFile()) {
    if (path.basename(normalizedPath) !== SKILL_FILE) {
      throw new Error("请选择 SKILL.md 文件或包含 SKILL.md 的目录");
    }

    const sourceDir = path.dirname(normalizedPath);
    const skillName = path.basename(sourceDir);
    return [
      {
        sourceDir,
        skillName,
        skillPath: skillName,
      },
    ];
  }

  if (!stats.isDirectory()) {
    throw new Error("请选择 SKILL.md 文件或包含 SKILL.md 的目录");
  }

  return collectSkillSourceDirsFromDirectory(normalizedPath);
};

const parseClawHubSlug = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("ClawHub 名称或链接不能为空");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("ClawHub 链接格式不正确");
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "clawhub.ai" && hostname !== "www.clawhub.ai") {
      throw new Error("ClawHub 链接必须来自 clawhub.ai");
    }

    const slug =
      parsed.pathname.split("/").filter(Boolean).at(-1)?.trim() ?? "";
    if (!slug) {
      throw new Error("ClawHub 链接缺少技能名称");
    }
    return slug;
  }

  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
};

const buildSkillId = (repositoryUrl: string, skillPath: string): string =>
  `${repositoryUrl.toLowerCase()}::${normalizeSkillPath(skillPath)}`;

const isBuiltinSkillRepositoryUrl = (repositoryUrl: string): boolean =>
  repositoryUrl.trim().toLowerCase().startsWith("builtin://");

const getSkillDirByName = (skillName: string): string =>
  path.join(INSTALLED_SKILLS_DIR, sanitizeDirName(skillName));

const normalizeRepositoryUrls = (input: unknown[]): string[] =>
  input
    .map((item) => {
      if (typeof item !== "string") {
        return "";
      }
      try {
        return parseGitHubRepositoryUrl(item).canonicalUrl;
      } catch {
        return "";
      }
    })
    .filter((item): item is string => Boolean(item));

const parseRepositoryManifest = (input: unknown): string[] => {
  if (Array.isArray(input)) {
    return normalizeRepositoryUrls(input);
  }

  if (!input || typeof input !== "object") {
    return [];
  }

  const repositories = (input as { repositories?: unknown }).repositories;
  if (!Array.isArray(repositories)) {
    return [];
  }

  return normalizeRepositoryUrls(repositories);
};

const readBuiltinRepositories = async (): Promise<string[]> => {
  for (const filePath of Array.from(new Set(REPOSITORIES_FILE_CANDIDATES))) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const repositories = parseRepositoryManifest(parsed);
      return Array.from(new Set([BUILTIN_REPOSITORY_URL, ...repositories]));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        continue;
      }
      if (error instanceof SyntaxError) {
        throw new Error(
          `读取 ${SKILLS_REPOSITORY_DIR}/${REPOSITORIES_FILE} 失败：JSON 格式不正确`,
        );
      }
      throw error;
    }
  }

  return [BUILTIN_REPOSITORY_URL];
};

const readSkillsConfig = async (): Promise<LoadedSkillsConfig> => {
  const builtinRepositories = await readBuiltinRepositories();
  const fallback: LoadedSkillsConfig = {
    repositories: [...builtinRepositories],
    builtinRepositories,
  };

  await ensureDir(INTERNAL_ROOT);
  try {
    const raw = await fs.readFile(SKILLS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SkillsConfigFile>;

    const repositories = Array.isArray(parsed.repositories)
      ? normalizeRepositoryUrls(parsed.repositories)
      : [];

    const dedupedRepositories = Array.from(
      new Set([...builtinRepositories, ...repositories]),
    );

    return {
      repositories: dedupedRepositories,
      builtinRepositories,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return fallback;
  }
};

const writeSkillsConfig = async (
  config: SkillsConfigFile | LoadedSkillsConfig,
): Promise<void> => {
  const payload: SkillsConfigFile = {
    repositories: [...config.repositories],
  };
  await ensureDir(INTERNAL_ROOT);
  await fs.writeFile(
    SKILLS_CONFIG_PATH,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
};

const toConfigDTO = (config: LoadedSkillsConfig): SkillConfigDTO => {
  const builtinSet = new Set(
    config.builtinRepositories.map((item) => item.toLowerCase()),
  );
  return {
    repositories: config.repositories.map<SkillRepositoryDTO>((url) => ({
      url,
      builtin: builtinSet.has(url.toLowerCase()),
    })),
  };
};

const getGitHubToken = (): string | null => {
  const token = (
    process.env["GITHUB_TOKEN"] ??
    process.env["GH_TOKEN"] ??
    ""
  ).trim();
  return token || null;
};

const buildGitHubHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "kian-desktop-app",
  };

  const token = getGitHubToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
};

const readGitHubErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: unknown };
    return typeof payload.message === "string" ? payload.message : "";
  } catch {
    return "";
  }
};

const formatRateLimitReset = (raw: string | null): string => {
  if (!raw) {
    return "";
  }

  const timestamp = Number(raw);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }

  return formatUtcTimestampToLocal(timestamp * 1000);
};

const githubFetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    headers: buildGitHubHeaders(),
  });

  if (!response.ok) {
    const details = await readGitHubErrorMessage(response);
    if (response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      const resetAt = formatRateLimitReset(
        response.headers.get("x-ratelimit-reset"),
      );
      if (remaining === "0") {
        const resetHint = resetAt ? `（重置时间：${resetAt}）` : "";
        throw new Error(
          `请求 GitHub 失败（403，API 速率限制）${resetHint}。请稍后重试，或配置 GITHUB_TOKEN/GH_TOKEN 提升限额。`,
        );
      }

      throw new Error(
        `请求 GitHub 失败（403）。请检查仓库访问权限，或配置 GITHUB_TOKEN/GH_TOKEN。${
          details ? `详情：${details}` : ""
        }`,
      );
    }

    if (response.status === 401) {
      throw new Error(
        "请求 GitHub 失败（401）。请检查 GITHUB_TOKEN/GH_TOKEN 是否有效。",
      );
    }

    throw new Error(
      `请求 GitHub 失败（${response.status}）${details ? `：${details}` : ""}`,
    );
  }

  return (await response.json()) as T;
};

const getRepositoryCacheKey = (repositoryUrl: string): string =>
  repositoryUrl.trim().toLowerCase();

const readSkillMetadataCache = async (): Promise<SkillMetadataCacheFile> => {
  await ensureDir(INTERNAL_ROOT);
  try {
    const raw = await fs.readFile(SKILL_METADATA_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SkillMetadataCacheFile>;
    if (!parsed.repositories || typeof parsed.repositories !== "object") {
      return { repositories: {} };
    }

    const repositories: Record<string, RepositorySkillMetadataCache> = {};
    for (const [repositoryUrl, repositoryMeta] of Object.entries(
      parsed.repositories,
    )) {
      if (!repositoryMeta || typeof repositoryMeta !== "object") {
        continue;
      }

      const skillsSource = (repositoryMeta as { skills?: unknown }).skills;
      const skills: Record<string, SkillMetadataEntry> = {};
      if (skillsSource && typeof skillsSource === "object") {
        for (const [skillPath, entry] of Object.entries(skillsSource)) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as SkillMetadataEntry).skillFileSha === "string" &&
            typeof (entry as SkillMetadataEntry).description === "string" &&
            typeof (entry as SkillMetadataEntry).updatedAt === "string"
          ) {
            const frontMatterSource = (entry as { frontMatter?: unknown })
              .frontMatter;
            const frontMatter: Record<string, string> = {};
            if (frontMatterSource && typeof frontMatterSource === "object") {
              for (const [key, value] of Object.entries(frontMatterSource)) {
                if (typeof value === "string") {
                  frontMatter[key] = value;
                }
              }
            }

            skills[skillPath] = {
              schemaVersion:
                typeof (entry as { schemaVersion?: unknown }).schemaVersion ===
                "number"
                  ? (entry as { schemaVersion: number }).schemaVersion
                  : 1,
              skillFileSha: (entry as SkillMetadataEntry).skillFileSha,
              title:
                typeof (entry as { title?: unknown }).title === "string"
                  ? (entry as { title: string }).title
                  : "",
              description: (entry as SkillMetadataEntry).description,
              frontMatter,
              updatedAt: (entry as SkillMetadataEntry).updatedAt,
            };
          }
        }
      }

      repositories[getRepositoryCacheKey(repositoryUrl)] = {
        updatedAt:
          typeof (repositoryMeta as RepositorySkillMetadataCache).updatedAt ===
          "string"
            ? (repositoryMeta as RepositorySkillMetadataCache).updatedAt
            : "",
        skills,
      };
    }

    return { repositories };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { repositories: {} };
    }
    throw error;
  }
};

const writeSkillMetadataCache = async (
  cache: SkillMetadataCacheFile,
): Promise<void> => {
  await ensureDir(INTERNAL_ROOT);
  await fs.writeFile(
    SKILL_METADATA_CACHE_PATH,
    `${JSON.stringify(cache, null, 2)}\n`,
    "utf8",
  );
};

const updateSkillMetadataCache = async (
  updater: (cache: SkillMetadataCacheFile) => void,
): Promise<void> => {
  const task = metadataCacheWriteTask.then(async () => {
    const latestCache = await readSkillMetadataCache();
    updater(latestCache);
    await writeSkillMetadataCache(latestCache);
  });

  metadataCacheWriteTask = task.catch(() => {
    // keep queue alive even if one write fails
  });

  await task;
};

const cleanYamlScalar = (input: string): string =>
  input
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .replace(/^'(.*)'$/s, "$1")
    .trim();

const extractFrontMatterLines = (markdown: string): string[] => {
  const lines = markdown
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  if (lines[0]?.trim() !== "---") {
    return [];
  }

  const endIndex = lines.findIndex(
    (line, index) =>
      index > 0 && (line.trim() === "---" || line.trim() === "..."),
  );
  if (endIndex <= 0) {
    return [];
  }

  return lines.slice(1, endIndex);
};

const parseFrontMatterMap = (
  frontMatterLines: string[],
): Record<string, string> => {
  const frontMatter: Record<string, string> = {};
  const stack: Array<{ indent: number; key: string }> = [];

  for (const rawLine of frontMatterLines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      continue;
    }

    const indent = rawLine.search(/\S|$/);
    const line = rawLine.trim();
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }

    while (stack.length > 0 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const key = match[1];
    const value = cleanYamlScalar(match[2] ?? "");
    const keyPath = [...stack.map((item) => item.key), key]
      .join(".")
      .toLowerCase();

    if (!value) {
      stack.push({ indent, key });
      continue;
    }

    frontMatter[keyPath] = value;
  }

  return frontMatter;
};

const removeFrontMatter = (markdown: string): string => {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return normalized;
  }

  const lines = normalized.split("\n");
  const endIndex = lines.findIndex(
    (line, index) =>
      index > 0 && (line.trim() === "---" || line.trim() === "..."),
  );
  if (endIndex <= 0) {
    return normalized;
  }

  return lines.slice(endIndex + 1).join("\n");
};

const extractFallbackDescription = (markdown: string): string => {
  const body = removeFrontMatter(markdown);
  const lines = body.split("\n");
  const collected: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    if (!trimmed) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }

    if (
      trimmed.startsWith("#") ||
      /^[-*+]\s+/.test(trimmed) ||
      /^\d+\.\s+/.test(trimmed) ||
      /^>/.test(trimmed)
    ) {
      continue;
    }

    collected.push(trimmed);
    if (collected.join(" ").length >= 260) {
      break;
    }
  }

  return collected.join(" ").slice(0, 260).trim();
};

const extractHeadingTitle = (markdown: string): string => {
  const body = removeFrontMatter(markdown);
  const headingLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));

  return headingLine ? headingLine.slice(2).trim() : "";
};

const extractSkillMetadataFromMarkdown = (
  markdown: string,
): {
  title: string;
  description: string;
  frontMatter: Record<string, string>;
} => {
  const frontMatter = parseFrontMatterMap(extractFrontMatterLines(markdown));
  const description =
    frontMatter["description"] ||
    frontMatter["short-description"] ||
    frontMatter["metadata.short-description"] ||
    frontMatter["metadata.description"] ||
    extractFallbackDescription(markdown);

  const title =
    frontMatter["name"] ||
    frontMatter["title"] ||
    extractHeadingTitle(markdown);

  return {
    title,
    description,
    frontMatter,
  };
};

const hashSkillMarkdown = (markdown: string): string =>
  createHash("sha256").update(markdown).digest("hex");

const readRepositorySkillSnapshot = async (
  repository: GitHubRepositoryRef,
  options?: { forceRefresh?: boolean },
): Promise<
  Array<{
    skillPath: string;
    skillFileSha: string;
    title: string;
    description: string;
    frontMatter: Record<string, string>;
  }>
> => {
  const cacheDir = await ensureRepositoryCache(repository, {
    forceRefresh: options?.forceRefresh,
  });
  const skillPaths = await collectLocalSkillPaths(cacheDir);
  const snapshot = await Promise.all(
    skillPaths.map(async (skillPath) => {
      const skillFilePath = path.join(cacheDir, ...skillPath.split("/"), SKILL_FILE);
      const markdown = await fs.readFile(skillFilePath, "utf8");
      const metadata = extractSkillMetadataFromMarkdown(markdown);
      return {
        skillPath,
        skillFileSha: hashSkillMarkdown(markdown),
        title: metadata.title,
        description: metadata.description,
        frontMatter: metadata.frontMatter,
      };
    }),
  );

  return snapshot.sort((left, right) =>
    left.skillPath.localeCompare(right.skillPath, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    }),
  );
};

const runRepositoryMetadataRefresh = async (
  repository: GitHubRepositoryRef,
  options?: { forceRefresh?: boolean },
): Promise<SkillMetadataRefreshResult> => {
  const snapshot = await readRepositorySkillSnapshot(repository, {
    forceRefresh: options?.forceRefresh,
  });

  const cache = await readSkillMetadataCache();
  const cacheKey = getRepositoryCacheKey(repository.canonicalUrl);
  const previous = cache.repositories[cacheKey];
  const nextSkills: Record<string, SkillMetadataEntry> = {};

  let changedCount = 0;
  for (const skill of snapshot) {
    const cached = previous?.skills[skill.skillPath];
    if (
      cached &&
      cached.skillFileSha === skill.skillFileSha &&
      cached.schemaVersion === SKILL_METADATA_SCHEMA_VERSION
    ) {
      nextSkills[skill.skillPath] = cached;
      continue;
    }

    nextSkills[skill.skillPath] = {
      schemaVersion: SKILL_METADATA_SCHEMA_VERSION,
      skillFileSha: skill.skillFileSha,
      title: skill.title,
      description: skill.description,
      frontMatter: skill.frontMatter,
      updatedAt: new Date().toISOString(),
    };
    changedCount += 1;
  }

  const removedCount = Object.keys(previous?.skills ?? {}).filter(
    (skillPath) =>
      !snapshot.some((snapshotSkill) => snapshotSkill.skillPath === skillPath),
  ).length;
  changedCount += removedCount;

  await updateSkillMetadataCache((latestCache) => {
    latestCache.repositories[cacheKey] = {
      updatedAt: new Date().toISOString(),
      skills: nextSkills,
    };
  });

  return {
    updatedCount: changedCount,
    totalCount: snapshot.length,
  };
};

const queueRepositoryMetadataRefresh = async (
  repository: GitHubRepositoryRef,
  options: { force: boolean },
): Promise<SkillMetadataRefreshResult> => {
  const cacheKey = getRepositoryCacheKey(repository.canonicalUrl);
  const activeTask = metadataRefreshTasks.get(cacheKey);

  if (!options.force && activeTask) {
    return activeTask;
  }

  if (options.force && activeTask) {
    try {
      await activeTask;
    } catch {
      // noop: still try force refresh
    }
  }

  const task = runRepositoryMetadataRefresh(repository, {
    forceRefresh: options.force,
  })
    .catch((error) => {
      logger.warn(`技能元信息刷新失败：${repository.canonicalUrl}`, error);
      throw error;
    })
    .finally(() => {
      if (metadataRefreshTasks.get(cacheKey) === task) {
        metadataRefreshTasks.delete(cacheKey);
      }
    });

  metadataRefreshTasks.set(cacheKey, task);
  return task;
};

const readInstalledSkillMetaRecord = async (
  skillDir: string,
): Promise<InstalledSkillMetaRecord | null> => {
  const metaPath = path.join(skillDir, SKILL_META_FILE);
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<InstalledSkillMetaRecord>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.repositoryUrl !== "string" ||
      typeof parsed.skillPath !== "string" ||
      typeof parsed.installedAt !== "string"
    ) {
      return null;
    }
    return {
      id: parsed.id,
      name: parsed.name,
      repositoryUrl: parsed.repositoryUrl,
      skillPath: parsed.skillPath,
      installedAt: parsed.installedAt,
      mainAgentVisible:
        typeof parsed.mainAgentVisible === "boolean"
          ? parsed.mainAgentVisible
          : undefined,
      projectAgentVisible:
        typeof parsed.projectAgentVisible === "boolean"
          ? parsed.projectAgentVisible
          : undefined,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const readInstalledSkillMeta = async (
  skillDir: string,
  options?: { fallbackVisibility?: SkillVisibility },
): Promise<InstalledSkillMetaFile | null> => {
  const parsed = await readInstalledSkillMetaRecord(skillDir);
  if (!parsed) {
    return null;
  }

  return {
    id: parsed.id,
    name: parsed.name,
    repositoryUrl: parsed.repositoryUrl,
    skillPath: parsed.skillPath,
    installedAt: parsed.installedAt,
    ...resolveSkillVisibility(parsed, options?.fallbackVisibility),
  };
};

const listInstalledSkillMetas = async (): Promise<
  Array<InstalledSkillMetaFile & { installPath: string }>
> => {
  await migrateLegacyInstalledSkills();
  await ensureDir(INSTALLED_SKILLS_DIR);

  const entries = await fs.readdir(INSTALLED_SKILLS_DIR, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory());
  const metas: Array<InstalledSkillMetaFile & { installPath: string }> = [];

  for (const folder of folders) {
    const skillDir = path.join(INSTALLED_SKILLS_DIR, folder.name);
    const meta = await readInstalledSkillMeta(skillDir);
    if (!meta) {
      continue;
    }
    metas.push({
      ...meta,
      installPath: skillDir,
    });
  }

  return metas.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
};

const copyDirectory = async (
  sourceDir: string,
  targetDir: string,
  options?: { skip?: (entry: Dirent, relativePath: string) => boolean },
  currentRelativePath = "",
): Promise<void> => {
  await ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = currentRelativePath
      ? path.posix.join(currentRelativePath, entry.name)
      : entry.name;
    if (options?.skip?.(entry, relativePath)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, options, relativePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await ensureDir(path.dirname(targetPath));
    await fs.copyFile(sourcePath, targetPath);
  }
};

const writeInstalledSkillMeta = async (
  targetDir: string,
  meta: InstalledSkillMetaFile,
): Promise<void> => {
  await fs.writeFile(
    path.join(targetDir, SKILL_META_FILE),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );
};

const migrateLegacyInstalledSkills = async (): Promise<void> => {
  await ensureDir(INSTALLED_SKILLS_DIR);
  try {
    const entries = await fs.readdir(LEGACY_GLOBAL_SKILLS_DIR, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const legacySkillDir = path.join(LEGACY_GLOBAL_SKILLS_DIR, entry.name);
      const meta = await readInstalledSkillMeta(legacySkillDir);
      if (!meta) {
        continue;
      }

      const targetDir = getSkillDirByName(meta.name);
      if (targetDir !== legacySkillDir) {
        await fs.rm(targetDir, { recursive: true, force: true });
        await fs.rename(legacySkillDir, targetDir);
      }
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }
};

const collectLocalSkillPaths = async (rootDir: string): Promise<string[]> => {
  const skillPaths: string[] = [];

  const walk = async (relativePosixPath: string): Promise<void> => {
    const absoluteDir = relativePosixPath
      ? path.join(rootDir, ...relativePosixPath.split("/"))
      : rootDir;
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

    const hasSkillFile = entries.some(
      (entry) => entry.isFile() && entry.name === SKILL_FILE,
    );
    if (hasSkillFile && relativePosixPath) {
      skillPaths.push(relativePosixPath);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const nextRelativePath = relativePosixPath
        ? `${relativePosixPath}/${entry.name}`
        : entry.name;
      await walk(nextRelativePath);
    }
  };

  await walk("");

  return skillPaths.sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" }),
  );
};

const resolveBuiltinSkillsRoot = async (): Promise<{
  rootPath: string;
  skillPaths: string[];
} | null> => {
  for (const rootCandidate of Array.from(
    new Set(BUILTIN_SKILLS_ROOT_CANDIDATES),
  )) {
    try {
      const skillPaths = await collectLocalSkillPaths(rootCandidate);
      if (skillPaths.length > 0) {
        return {
          rootPath: rootCandidate,
          skillPaths,
        };
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT" || err.code === "ENOTDIR") {
        continue;
      }

      logger.warn(`检查内置技能目录失败：${rootCandidate}`, error);
    }
  }

  return null;
};

const installLocalSkillDirectory = async (input: {
  sourceDir: string;
  skillName: string;
  meta: InstalledSkillMetaFile;
}): Promise<string> => {
  const targetDir = getSkillDirByName(input.skillName);
  await ensureDir(targetDir);
  await copyDirectory(input.sourceDir, targetDir, {
    skip: (entry) => entry.name === SKILL_META_FILE,
  });
  await writeInstalledSkillMeta(targetDir, input.meta);
  return targetDir;
};

const installSkillDirectoryFromSource = async (input: {
  sourceDir: string;
  repositoryUrl: string;
  skillPath: string;
  skillName?: string;
  addRepositoryToConfig?: boolean;
}): Promise<InstalledSkillDTO> => {
  const normalizedSkillPath = normalizeSkillPath(input.skillPath);
  const sourceStat = await fs.stat(input.sourceDir);
  if (!sourceStat.isDirectory()) {
    throw new Error("技能路径不是目录，无法安装该技能");
  }

  if (!(await pathExists(path.join(input.sourceDir, SKILL_FILE)))) {
    throw new Error("未找到 SKILL.md，无法安装该技能");
  }

  const skillName =
    input.skillName?.trim() || path.posix.basename(normalizedSkillPath);
  const skillId = buildSkillId(input.repositoryUrl, normalizedSkillPath);
  const targetDir = getSkillDirByName(skillName);
  const existingMeta = await readInstalledSkillMetaRecord(targetDir);
  if (existingMeta && existingMeta.id !== skillId) {
    throw new Error(`已存在同名技能目录：${skillName}。请先卸载同名技能后再安装。`);
  }

  await fs.rm(targetDir, { recursive: true, force: true });
  const defaultVisibility = await readSkillDefaultVisibility(input.sourceDir);
  const installedAt =
    existingMeta?.id === skillId
      ? existingMeta.installedAt
      : new Date().toISOString();
  const meta: InstalledSkillMetaFile = {
    id: skillId,
    name: skillName,
    repositoryUrl: input.repositoryUrl,
    skillPath: normalizedSkillPath,
    installedAt,
    ...resolveSkillVisibility(existingMeta ?? {}, defaultVisibility),
  };
  const installPath = await installLocalSkillDirectory({
    sourceDir: input.sourceDir,
    skillName,
    meta,
  });
  await removeDuplicateSkillDirs(skillId, installPath);

  if (input.addRepositoryToConfig) {
    const config = await readSkillsConfig();
    if (!config.repositories.includes(input.repositoryUrl)) {
      config.repositories.push(input.repositoryUrl);
      await writeSkillsConfig(config);
    }
  }

  const presentation = await resolveInstalledSkillPresentation({
    ...meta,
    installPath,
  });
  return toInstalledSkillDTO(
    {
      ...meta,
      installPath,
    },
    presentation,
  );
};

const removeDuplicateSkillDirs = async (
  skillId: string,
  keepInstallPath: string,
): Promise<void> => {
  const installedMetas = await listInstalledSkillMetas();
  const duplicateMetas = installedMetas.filter(
    (meta) => meta.id === skillId && meta.installPath !== keepInstallPath,
  );

  for (const duplicate of duplicateMetas) {
    await fs.rm(duplicate.installPath, { recursive: true, force: true });
  }
};

const removeStaleBuiltinSkillDirs = async (
  activeBuiltinSkillPaths: string[],
): Promise<number> => {
  const activeBuiltinSkillPathSet = new Set(
    activeBuiltinSkillPaths.map((skillPath) => normalizeSkillPath(skillPath)),
  );
  const installedMetas = await listInstalledSkillMetas();
  const staleBuiltinMetas = installedMetas.filter(
    (meta) =>
      isBuiltinSkillRepositoryUrl(meta.repositoryUrl) &&
      !activeBuiltinSkillPathSet.has(normalizeSkillPath(meta.skillPath)),
  );

  for (const staleMeta of staleBuiltinMetas) {
    await fs.rm(staleMeta.installPath, { recursive: true, force: true });
  }

  return staleBuiltinMetas.length;
};

const getInstalledSkillById = async (
  skillId: string,
): Promise<(InstalledSkillMetaFile & { installPath: string }) | null> => {
  const installedMetas = await listInstalledSkillMetas();
  return installedMetas.find((meta) => meta.id === skillId) ?? null;
};

const cleanupLegacyAgentResourceDirectories = async (): Promise<void> => {
  await fs.rm(AGENT_RESOURCE_ROOT, { recursive: true, force: true });
};

const getMetadataFromCache = (
  cache: SkillMetadataCacheFile,
  repositoryUrl: string,
  skillPath: string,
): SkillMetadataEntry | null => {
  const repositoryCache = cache.repositories[getRepositoryCacheKey(repositoryUrl)];
  return repositoryCache?.skills[normalizeSkillPath(skillPath)] ?? null;
};

const readInstalledSkillMetadata = async (
  installPath: string,
): Promise<{ title: string; description: string } | null> => {
  try {
    const markdown = await fs.readFile(path.join(installPath, SKILL_FILE), "utf8");
    const parsed = extractSkillMetadataFromMarkdown(markdown);
    return {
      title: parsed.title.trim(),
      description: parsed.description.trim(),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      logger.warn(`读取已安装技能元信息失败：${installPath}`, error);
    }
    return null;
  }
};

const listActiveInstalledSkillsForScope = async (input: {
  scope: "main" | "project";
}): Promise<ActiveAgentSkillInfo[]> => {
  const installedMetas = await listInstalledSkillMetas();
  const visibleMetas = installedMetas.filter((meta) =>
    input.scope === "main" ? meta.mainAgentVisible : meta.projectAgentVisible,
  );

  const skills = await Promise.all(
    visibleMetas.map(async (meta) => {
      const metadata = await readInstalledSkillMetadata(meta.installPath);
      return {
        dirName: path.basename(meta.installPath),
        title: metadata?.title.trim() || meta.name,
        description: metadata?.description.trim() || "",
        skillFilePath: path.join(meta.installPath, SKILL_FILE),
      };
    }),
  );

  return skills.sort((left, right) =>
    left.title.localeCompare(right.title, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    }),
  );
};

const resolveInstalledSkillPresentation = async (
  meta: InstalledSkillMetaFile & { installPath: string },
  metadataCache?: SkillMetadataCacheFile,
): Promise<{ name: string; description: string }> => {
  const localMetadata = await readInstalledSkillMetadata(meta.installPath);
  if (localMetadata?.title && localMetadata.description) {
    return {
      name: localMetadata.title,
      description: localMetadata.description,
    };
  }

  const cacheMetadata = metadataCache
    ? getMetadataFromCache(metadataCache, meta.repositoryUrl, meta.skillPath)
    : null;

  const name =
    localMetadata?.title ||
    cacheMetadata?.title?.trim() ||
    meta.name;
  const description =
    localMetadata?.description ||
    cacheMetadata?.description?.trim() ||
    "";

  return {
    name,
    description,
  };
};

const toInstalledSkillDTO = (
  meta: InstalledSkillMetaFile & { installPath: string },
  presentation: { name: string; description: string },
): InstalledSkillDTO => ({
  id: meta.id,
  name: presentation.name,
  repositoryUrl: meta.repositoryUrl,
  skillPath: meta.skillPath,
  installPath: meta.installPath,
  description: presentation.description,
  installedAt: meta.installedAt,
  mainAgentVisible: meta.mainAgentVisible,
  projectAgentVisible: meta.projectAgentVisible,
});

export const skillService = {
  async syncBuiltinSkillsOnStartup(): Promise<void> {
    await migrateLegacyInstalledSkills();
    await cleanupLegacyAgentResourceDirectories();
    const builtinRootResult = await resolveBuiltinSkillsRoot();
    if (!builtinRootResult) {
      logger.info(
        `未找到内置技能目录，跳过同步。候选路径：${Array.from(new Set(BUILTIN_SKILLS_ROOT_CANDIDATES)).join(
          " | ",
        )}`,
      );
      return;
    }

    const builtinRoot = builtinRootResult.rootPath;
    const builtinSkillPaths = builtinRootResult.skillPaths;
    const removedCount = await removeStaleBuiltinSkillDirs(builtinSkillPaths);
    if (removedCount > 0) {
      logger.info(`已清理 ${removedCount} 个失效的内置技能目录`);
    }

    let syncedCount = 0;
    for (const builtinSkillPath of builtinSkillPaths) {
      const skillName = path.posix.basename(builtinSkillPath);
      const skillId = buildSkillId(BUILTIN_LOCAL_REPOSITORY_URL, builtinSkillPath);
      const sourceDir = path.join(builtinRoot, ...builtinSkillPath.split("/"));
      const defaultVisibility = await readSkillDefaultVisibility(sourceDir);
      const targetDir = getSkillDirByName(skillName);
      const existingMeta = await readInstalledSkillMetaRecord(targetDir);
      if (existingMeta && existingMeta.id !== skillId) {
        logger.warn(
          `内置技能同步跳过：目录 ${targetDir} 已被其他技能占用（${existingMeta.id}）`,
        );
        continue;
      }
      const installedAt =
        existingMeta?.id === skillId
          ? existingMeta.installedAt
          : new Date().toISOString();
      const meta: InstalledSkillMetaFile = {
        id: skillId,
        name: skillName,
        repositoryUrl: BUILTIN_LOCAL_REPOSITORY_URL,
        skillPath: builtinSkillPath,
        installedAt,
        ...resolveSkillVisibility(existingMeta ?? {}, defaultVisibility),
      };

      try {
        const installPath = await installLocalSkillDirectory({
          sourceDir,
          skillName,
          meta,
        });
        await removeDuplicateSkillDirs(skillId, installPath);
        syncedCount += 1;
      } catch (error) {
        logger.warn(`同步内置技能失败：${builtinSkillPath}`, error);
      }
    }

    logger.info(`内置技能同步完成，共 ${syncedCount}/${builtinSkillPaths.length} 个`);
  },

  async syncAgentResourceDirectories(): Promise<void> {
    await cleanupLegacyAgentResourceDirectories();
  },

  async listActiveSkillsForScope(input: {
    scope: "main" | "project";
    projectId?: string;
  }): Promise<ActiveAgentSkillInfo[]> {
    return listActiveInstalledSkillsForScope({
      scope: input.scope,
    });
  },

  async getConfig(): Promise<SkillConfigDTO> {
    const config = await readSkillsConfig();
    return toConfigDTO(config);
  },

  async addRepository(input: {
    repositoryUrl: string;
  }): Promise<SkillConfigDTO> {
    const repository = parseGitHubRepositoryUrl(input.repositoryUrl);
    const config = await readSkillsConfig();

    if (!config.repositories.includes(repository.canonicalUrl)) {
      config.repositories.push(repository.canonicalUrl);
      await writeSkillsConfig(config);
    }

    return toConfigDTO(config);
  },

  async listInstalledSkills(): Promise<InstalledSkillDTO[]> {
    const [installedMetas, metadataCache] = await Promise.all([
      listInstalledSkillMetas(),
      readSkillMetadataCache(),
    ]);
    return Promise.all(
      installedMetas.map(async (meta) => {
        const presentation = await resolveInstalledSkillPresentation(
          meta,
          metadataCache,
        );
        return toInstalledSkillDTO(meta, presentation);
      }),
    );
  },

  async listRepositorySkills(
    repositoryUrl: string,
  ): Promise<SkillListItemDTO[]> {
    const repository = parseGitHubRepositoryUrl(repositoryUrl);
    const [installedMetas, metadataCache] = await Promise.all([
      listInstalledSkillMetas(),
      readSkillMetadataCache(),
    ]);

    const installedSet = new Set(installedMetas.map((meta) => meta.id));
    const repositoryUrlLower = repository.canonicalUrl.toLowerCase();
    const repositoryInstalledPaths = installedMetas
      .filter((meta) => meta.repositoryUrl.toLowerCase() === repositoryUrlLower)
      .map((meta) => meta.skillPath);
    const repositoryCache =
      metadataCache.repositories[
        getRepositoryCacheKey(repository.canonicalUrl)
      ];
    const fallbackSkillPaths = Array.from(
      new Set([
        ...Object.keys(repositoryCache?.skills ?? {}),
        ...repositoryInstalledPaths,
      ]),
    ).sort((a, b) =>
      a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" }),
    );

    let snapshot: Array<{
      skillPath: string;
      skillFileSha: string;
      title: string;
      description: string;
      frontMatter: Record<string, string>;
    }>;
    try {
      snapshot = await readRepositorySkillSnapshot(repository);
    } catch (error) {
      if (fallbackSkillPaths.length > 0) {
        logger.warn(`读取仓库缓存失败，已回退本地元信息：${repository.canonicalUrl}`, error);
        return fallbackSkillPaths.map((skillPath) => {
          const id = buildSkillId(repository.canonicalUrl, skillPath);
          return {
            id,
            name: path.posix.basename(skillPath),
            repositoryUrl: repository.canonicalUrl,
            skillPath,
            description: repositoryCache?.skills[skillPath]?.description ?? "",
            installed: installedSet.has(id),
          } satisfies SkillListItemDTO;
        });
      }
      throw error;
    }

    const needsMetadataRefresh = snapshot.some((skill) => {
      const cached = repositoryCache?.skills[skill.skillPath];
      return (
        !cached ||
        cached.skillFileSha !== skill.skillFileSha ||
        cached.schemaVersion !== SKILL_METADATA_SCHEMA_VERSION
      );
    });

    if (needsMetadataRefresh) {
      void queueRepositoryMetadataRefresh(repository, { force: false }).catch(() => {
        // logged in queueRepositoryMetadataRefresh
      });
    }

    return snapshot.map((skill) => {
      const id = buildSkillId(repository.canonicalUrl, skill.skillPath);
      const description =
        repositoryCache?.skills[skill.skillPath]?.description ?? skill.description;
      return {
        id,
        name: path.posix.basename(skill.skillPath),
        repositoryUrl: repository.canonicalUrl,
        skillPath: skill.skillPath,
        description,
        installed: installedSet.has(id),
      } satisfies SkillListItemDTO;
    });
  },

  async refreshRepositoryMetadata(
    repositoryUrl: string,
  ): Promise<SkillMetadataRefreshResult> {
    const repository = parseGitHubRepositoryUrl(repositoryUrl);
    return queueRepositoryMetadataRefresh(repository, { force: true });
  },

  async installSkill(input: {
    repositoryUrl: string;
    skillPath: string;
  }): Promise<InstalledSkillDTO> {
    await migrateLegacyInstalledSkills();
    const repository = parseGitHubRepositoryUrl(input.repositoryUrl);
    const normalizedSkillPath = normalizeSkillPath(input.skillPath);
    const sourceDir = await resolveCachedSkillSourceDir(
      repository,
      normalizedSkillPath,
    );

    return installSkillDirectoryFromSource({
      sourceDir,
      repositoryUrl: repository.canonicalUrl,
      skillPath: normalizedSkillPath,
      addRepositoryToConfig: true,
    });
  },

  async installLocalSkillSources(input: {
    sourcePaths: string[];
  }): Promise<InstalledSkillDTO[]> {
    await migrateLegacyInstalledSkills();
    const sourceMap = new Map<string, SkillSourceDir>();
    for (const sourcePath of input.sourcePaths) {
      const sources = await collectSkillSourceDirsFromPath(sourcePath);
      for (const source of sources) {
        sourceMap.set(path.resolve(source.sourceDir), source);
      }
    }

    const sources = Array.from(sourceMap.values());
    if (sources.length === 0) {
      throw new Error("未找到可安装的技能（需要 SKILL.md）");
    }

    const installed: InstalledSkillDTO[] = [];
    for (const source of sources) {
      installed.push(
        await installSkillDirectoryFromSource({
          sourceDir: source.sourceDir,
          repositoryUrl: LOCAL_SKILL_REPOSITORY_URL,
          skillPath: source.skillPath,
          skillName: source.skillName,
        }),
      );
    }
    return installed;
  },

  async installSkillFromMarkdown(input: {
    markdown: string;
  }): Promise<InstalledSkillDTO> {
    await migrateLegacyInstalledSkills();
    const markdown = input.markdown.trim();
    const metadata = extractSkillMetadataFromMarkdown(markdown);
    const skillName = metadata.title.trim();
    if (!skillName) {
      throw new Error("SKILL.md 内容缺少 name、title 或一级标题");
    }

    const tempDir = await createTempImportDir("markdown");
    const sourceDir = path.join(tempDir, sanitizeDirName(skillName));
    try {
      await ensureDir(sourceDir);
      await fs.writeFile(
        path.join(sourceDir, SKILL_FILE),
        `${markdown}\n`,
        "utf8",
      );
      return await installSkillDirectoryFromSource({
        sourceDir,
        repositoryUrl: LOCAL_SKILL_REPOSITORY_URL,
        skillPath: skillName,
        skillName,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  },

  async installClawHubSkill(input: {
    input: string;
  }): Promise<InstalledSkillDTO[]> {
    await migrateLegacyInstalledSkills();
    if (!(await hasCommand("tar"))) {
      throw new Error("未检测到 tar 命令，无法解压 ClawHub 技能包");
    }

    const slug = parseClawHubSlug(input.input);
    const tempDir = await createTempImportDir("clawhub");
    const archivePath = path.join(tempDir, `${sanitizeDirName(slug)}.zip`);
    const extractDir = path.join(tempDir, "extract");
    try {
      await ensureDir(extractDir);
      const downloadUrl = `${CLAWHUB_DOWNLOAD_URL}?slug=${encodeURIComponent(
        slug,
      )}`;
      const response = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(ARCHIVE_DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new Error(
          `下载 ClawHub 技能包失败（${response.status}）${
            details.trim() ? `：${details.trim()}` : ""
          }`,
        );
      }

      const archiveBuffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(archivePath, archiveBuffer);
      await runCommand("tar", ["-xf", archivePath, "-C", extractDir]);

      const sources = await collectSkillSourceDirsFromDirectory(extractDir);
      if (sources.length === 0) {
        throw new Error("ClawHub 技能包中未找到 SKILL.md");
      }

      const repositoryUrl = `${CLAWHUB_REPOSITORY_URL_PREFIX}/${slug}`;
      const installed: InstalledSkillDTO[] = [];
      for (const source of sources) {
        const singleSkill = sources.length === 1;
        installed.push(
          await installSkillDirectoryFromSource({
            sourceDir: source.sourceDir,
            repositoryUrl,
            skillPath: singleSkill ? slug : `${slug}/${source.skillPath}`,
            skillName: singleSkill ? slug : source.skillName,
          }),
        );
      }
      return installed;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  },

  async updateInstalledSkillVisibility(input: {
    skillId: string;
    mainAgentVisible: boolean;
    projectAgentVisible: boolean;
  }): Promise<InstalledSkillDTO> {
    const installed = await getInstalledSkillById(input.skillId.trim());
    if (!installed) {
      throw new Error("技能尚未安装，无法更新可见性");
    }

    const nextMeta: InstalledSkillMetaFile = {
      id: installed.id,
      name: installed.name,
      repositoryUrl: installed.repositoryUrl,
      skillPath: installed.skillPath,
      installedAt: installed.installedAt,
      mainAgentVisible: input.mainAgentVisible,
      projectAgentVisible: input.projectAgentVisible,
    };
    await writeInstalledSkillMeta(installed.installPath, nextMeta);

    const presentation = await resolveInstalledSkillPresentation({
      ...nextMeta,
      installPath: installed.installPath,
    });
    return toInstalledSkillDTO(
      {
        ...nextMeta,
        installPath: installed.installPath,
      },
      presentation,
    );
  },

  async uninstallSkill(input: { skillId: string }): Promise<boolean> {
    const skillId = input.skillId.trim();
    const installed = await getInstalledSkillById(skillId);
    if (!installed) {
      throw new Error("技能尚未安装，无法卸载");
    }
    if (isBuiltinSkillRepositoryUrl(installed.repositoryUrl)) {
      throw new Error("内置技能不支持卸载");
    }

    await fs.rm(installed.installPath, { recursive: true, force: true });
    return true;
  },
};
