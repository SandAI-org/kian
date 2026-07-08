import path from "node:path";

type SnapshotModuleKey = "docs" | "creation" | "app";

const KNOWN_MODULE_KEYS: SnapshotModuleKey[] = [
  "docs",
  "creation",
  "app",
];

const SNAPSHOT_MODULE_KEYS: SnapshotModuleKey[] = [
  "docs",
  "app",
];

const MODULE_DESCRIPTIONS: Record<SnapshotModuleKey, string> = {
  docs: "管理用户的文字知识，包括笔记、日记、资料等，也可以通过文档模块获取当前 Agent 更多的信息。",
  creation: "进行专业的视频创作。",
  app: "参考 app-creator 技能使用 React 前端技术栈开发前端应用、小游戏、小工具等。",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const summarizeContextValue = (value: unknown): string => {
  if (value === undefined) return "未提供";
  if (value === null) return "null";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : "(空字符串)";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const preview = value
      .slice(0, 6)
      .map((item) => summarizeContextValue(item));
    const suffix = value.length > 6 ? `, ...(+${value.length - 6})` : "";
    return `[${preview.join(", ")}${suffix}]`;
  }
  if (isRecord(value)) {
    try {
      const json = JSON.stringify(value);
      return json.length > 220 ? `${json.slice(0, 217)}...` : json;
    } catch {
      return "[对象]";
    }
  }
  return String(value);
};

const formatFieldValue = (value: unknown): string => {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.map((item) => formatFieldValue(item)).join(", ")}]`;
  }
  if (isRecord(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return "[对象]";
    }
  }
  return String(value);
};

const normalizeDisplayPath = (filePath: string): string =>
  path.resolve(filePath).replace(/\\/g, "/").replace(/\/+$/, "");

const appendExtraModuleFields = (
  lines: string[],
  moduleContext: Record<string, unknown>,
  handledKeys: string[],
): void => {
  const handledKeySet = new Set(handledKeys);
  for (const [key, value] of Object.entries(moduleContext)) {
    if (handledKeySet.has(key)) continue;
    lines.push(`- ${key}：${summarizeContextValue(value)}`);
  }
};

const buildDocsModuleLines = (
  moduleContext: unknown,
  projectCwd: string,
): string[] => {
  const record = isRecord(moduleContext) ? moduleContext : {};
  const lines = [
    "## 文档模块（docs）",
    `- 模块描述：${MODULE_DESCRIPTIONS.docs}`,
    `- 文档存放目录：${normalizeDisplayPath(path.join(projectCwd, "docs"))}`,
    `- 当前文档ID：${formatFieldValue(record.activeDocId)}`,
    `- 当前文档标题：${formatFieldValue(record.activeDocTitle)}`,
    `- 文档数量：${formatFieldValue(record.docCount)}`,
  ];
  appendExtraModuleFields(lines, record, [
    "activeDocId",
    "activeDocTitle",
    "docCount",
  ]);
  return lines;
};

const buildCreationModuleLines = (
  moduleContext: unknown,
  projectCwd: string,
): string[] => {
  const record = isRecord(moduleContext) ? moduleContext : {};
  const lines = [
    "## 创作模块（creation）",
    `- 模块描述：${MODULE_DESCRIPTIONS.creation}`,
    `- 视频创作工作目录：${normalizeDisplayPath(path.join(projectCwd, "creation"))}`,
    `- 场景数量：${formatFieldValue(record.sceneCount)}`,
    `- 镜头数量：${formatFieldValue(record.shotCount)}`,
    `- 更新时间：${formatFieldValue(record.updatedAt)}`,
  ];
  appendExtraModuleFields(lines, record, ["sceneCount", "shotCount", "updatedAt"]);
  return lines;
};

const buildAppModuleLines = (
  moduleContext: unknown,
  projectCwd: string,
): string[] => {
  const record = isRecord(moduleContext) ? moduleContext : {};
  const appDir =
    typeof record.appDir === "string" && record.appDir.trim()
      ? record.appDir
      : path.join(projectCwd, "app");
  const lines = [
    "## 应用模块（app）",
    `- 模块描述：${MODULE_DESCRIPTIONS.app}`,
    `- 应用目录：${normalizeDisplayPath(appDir)}`,
    `- 应用类型：${formatFieldValue(record.appType)}`,
    `- 应用名称：${formatFieldValue(record.appName)}`,
    `- 初始化状态：${formatFieldValue(record.initialized)}`,
    `- 依赖安装状态：${formatFieldValue(record.dependenciesInstalled)}`,
    `- 构建状态：${formatFieldValue(record.hasBuild)}`,
    `- 构建时间：${formatFieldValue(record.builtAt)}`,
  ];
  appendExtraModuleFields(lines, record, [
    "appDir",
    "appType",
    "appName",
    "initialized",
    "dependenciesInstalled",
    "hasBuild",
    "builtAt",
  ]);
  return lines;
};

const buildModuleSummaryLines = (input: {
  moduleKey: SnapshotModuleKey;
  moduleContext: unknown;
  projectCwd: string;
}): string[] => {
  switch (input.moduleKey) {
    case "docs":
      return buildDocsModuleLines(input.moduleContext, input.projectCwd);
    case "creation":
      return buildCreationModuleLines(input.moduleContext, input.projectCwd);
    case "app":
      return buildAppModuleLines(input.moduleContext, input.projectCwd);
  }
};

export const buildContextSnapshotSection = (input: {
  projectId: string;
  projectName: string;
  projectDescription?: string | null;
  module: string;
  projectCwd: string;
  contextSnapshot: unknown;
  moduleKeys?: SnapshotModuleKey[];
  includeAgentSummary?: boolean;
  includeSummaryHeading?: boolean;
}): string => {
  const contextRecord = isRecord(input.contextSnapshot)
    ? input.contextSnapshot
    : null;
  const handledKeys = new Set<string>();
  const moduleLines: string[] = [];
  const moduleKeys = input.moduleKeys ?? SNAPSHOT_MODULE_KEYS;
  const includeAgentSummary = input.includeAgentSummary ?? true;
  const includeSummaryHeading = input.includeSummaryHeading ?? true;

  for (const moduleKey of moduleKeys) {
    handledKeys.add(moduleKey);
    moduleLines.push(
      ...buildModuleSummaryLines({
        moduleKey,
        moduleContext: contextRecord ? contextRecord[moduleKey] : undefined,
        projectCwd: input.projectCwd,
      }),
      "",
    );
  }

  if (contextRecord) {
    const extras = Object.entries(contextRecord).filter(
      ([key]) => !handledKeys.has(key) && !KNOWN_MODULE_KEYS.includes(key as SnapshotModuleKey),
    );
    if (extras.length > 0) {
      moduleLines.push("## 其他上下文字段");
      for (const [key, value] of extras.slice(0, 10)) {
        moduleLines.push(`- ${key}：${summarizeContextValue(value)}`);
      }
      if (extras.length > 10) {
        moduleLines.push(`- ...其余 ${extras.length - 10} 项已省略`);
      }
    }
  } else if (input.contextSnapshot !== undefined) {
    moduleLines.push("## 原始 Context Snapshot");
    moduleLines.push(`- 摘要：${summarizeContextValue(input.contextSnapshot)}`);
  }

  return [
    ...(includeAgentSummary
      ? [
          `- Agent 名称：${input.projectName}`,
          `- Agent 描述：${input.projectDescription?.trim() || "未提供"}`,
          `- Agent ID：${input.projectId}`,
          `- 当前模块：${input.module}`,
          "",
        ]
      : []),
    ...(includeSummaryHeading ? ["# 核心功能模块摘要", ""] : []),
    ...moduleLines,
  ]
    .join("\n")
    .trim();
};
