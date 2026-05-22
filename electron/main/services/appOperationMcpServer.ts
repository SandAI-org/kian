import { Type } from "@mariozechner/pi-ai";
import type {
  ChatModuleType,
  ChatScope,
  ChatThinkingLevel,
  DocumentDTO,
  ProjectDTO,
} from "@shared/types";
import path from "node:path";
import { appOperationEvents } from "./appOperationEvents";
import type { CustomToolDef } from "./customTools";
import { repositoryService } from "./repositoryService";
import { settingsService } from "./settingsService";
import { settingsRuntimeService } from "./settingsRuntimeService";
import { WORKSPACE_ROOT } from "./workspacePaths";

const MODULE_LABELS: Record<ChatModuleType, string> = {
  main: "聊天",
  docs: "文档",
  creation: "音视频",
  assets: "素材",
  app: "应用",
};
const MAIN_AGENT_SCOPE_ID = "main-agent";
const MAIN_AGENT_NAME = "主 Agent";

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const normalizeText = (value: string): string => value.trim().toLowerCase();

const normalizeDocumentPath = (value: string): string =>
  value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "")
    .replace(/^docs\/files\//, "")
    .replace(/^docs\//, "")
    .replace(/^files\//, "");

const describeProject = (project: ProjectDTO): string =>
  project.name === project.id ? project.id : `${project.name} (${project.id})`;

const createMainAgentProjectDto = (): ProjectDTO => {
  const timestamp = new Date(0).toISOString();
  return {
    id: MAIN_AGENT_SCOPE_ID,
    name: MAIN_AGENT_NAME,
    description: null,
    cover: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const sortProjectsByUpdatedAtDesc = (projects: ProjectDTO[]): ProjectDTO[] =>
  [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const resolveMostLikelyProjectMatch = (
  projects: ProjectDTO[],
  rawQuery: string,
): { project: ProjectDTO; reason: string } => {
  const query = rawQuery.trim();
  if (!query) {
    throw new Error("Agent 标识不能为空");
  }
  const keyword = normalizeText(query);

  const exactMatches = projects.filter((item) => {
    const id = normalizeText(item.id);
    const name = normalizeText(item.name);
    return id === keyword || name === keyword;
  });
  if (exactMatches.length > 0) {
    const sorted = sortProjectsByUpdatedAtDesc(exactMatches);
    if (exactMatches.length === 1) {
      return { project: sorted[0], reason: `精确匹配"${query}"` };
    }
    return {
      project: sorted[0],
      reason: `存在 ${exactMatches.length} 个精确匹配，按最近更新时间选中`,
    };
  }

  const fuzzyMatches = projects.filter((item) => {
    const id = normalizeText(item.id);
    const name = normalizeText(item.name);
    return id.includes(keyword) || name.includes(keyword);
  });
  if (fuzzyMatches.length > 0) {
    const sorted = sortProjectsByUpdatedAtDesc(fuzzyMatches);
    if (fuzzyMatches.length === 1) {
      return { project: sorted[0], reason: `模糊匹配"${query}"` };
    }
    return {
      project: sorted[0],
      reason: `存在 ${fuzzyMatches.length} 个模糊匹配，按最近更新时间选中`,
    };
  }

  const tokens = keyword.split(/[\s_-]+/).filter((item) => item.length > 1);
  const tokenScored = projects
    .map((project) => {
      const id = normalizeText(project.id);
      const name = normalizeText(project.name);
      let score = 0;
      for (const token of tokens) {
        if (id.includes(token)) score += 2;
        if (name.includes(token)) score += 2;
      }
      return { project, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.project.updatedAt.localeCompare(a.project.updatedAt);
    });

  if (tokenScored.length > 0) {
    return {
      project: tokenScored[0].project,
      reason: `按关键词分词匹配"${query}"并结合最近更新时间选中`,
    };
  }

  throw new Error(`未找到 Agent：${query}`);
};

const resolveProject = async (
  fallbackProjectId: string,
  rawProjectQuery?: string,
): Promise<ProjectDTO> => {
  const query = rawProjectQuery?.trim();
  if (
    (!query && fallbackProjectId.trim() === MAIN_AGENT_SCOPE_ID) ||
    query === MAIN_AGENT_SCOPE_ID ||
    query === MAIN_AGENT_NAME
  ) {
    return createMainAgentProjectDto();
  }

  if (query) {
    const projects = await repositoryService.listProjects();
    if (projects.length === 0) {
      throw new Error("当前没有可用 Agent");
    }
    return resolveMostLikelyProjectMatch(projects, query).project;
  }

  const fallback = await repositoryService.getProjectById(fallbackProjectId);
  if (fallback) {
    return fallback;
  }

  const projects = await repositoryService.listProjects();
  if (projects.length === 0) {
    throw new Error("当前没有可用 Agent");
  }
  return projects[0];
};

const isChatThinkingLevel = (value: unknown): value is ChatThinkingLevel =>
  value === "low" || value === "medium" || value === "high";

const getOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const getAgentScope = (projectId: string): ChatScope => ({
  type: "project",
  projectId,
});

const parseModelKey = (
  modelKey: string,
): { provider: string; modelId: string } => {
  const delimiterIndex = modelKey.indexOf(":");
  const provider = modelKey.slice(0, delimiterIndex).trim();
  const modelId = modelKey.slice(delimiterIndex + 1).trim();
  if (delimiterIndex <= 0 || !provider || !modelId) {
    throw new Error("默认模型格式必须是 provider:modelId");
  }
  return { provider, modelId };
};

const resolveAgentDefaultModel = async (rawModel?: string): Promise<string> => {
  const status = await settingsService.getClaudeStatus();
  const requestedModel = rawModel?.trim();
  if (!requestedModel) {
    const latestModel = status.allEnabledModels[0];
    if (!latestModel) {
      throw new Error("当前没有已启用的默认模型");
    }
    return `${latestModel.provider}:${latestModel.modelId}`;
  }

  const { provider, modelId } = parseModelKey(requestedModel);
  const providerConfig = status.providers[provider];
  if (!providerConfig?.enabled || !providerConfig.enabledModels.includes(modelId)) {
    throw new Error(`默认模型未启用：${requestedModel}`);
  }
  return `${provider}:${modelId}`;
};

const resolveThinkingLevel = (
  value: unknown,
  fallback: ChatThinkingLevel,
): ChatThinkingLevel => {
  if (value === undefined) return fallback;
  if (isChatThinkingLevel(value)) return value;
  throw new Error("思考等级必须是 low、medium 或 high");
};

const applyAgentDefaults = async (input: {
  projectId: string;
  model?: string;
  thinkingLevel?: ChatThinkingLevel;
}): Promise<void> => {
  const scope = getAgentScope(input.projectId);
  if (input.model) {
    await settingsService.setLastSelectedModel(scope, input.model);
  }
  if (input.thinkingLevel) {
    await settingsService.setLastSelectedThinkingLevel(
      scope,
      input.thinkingLevel,
    );
  }
};

const resolveUniqueDocumentMatch = (
  docs: DocumentDTO[],
  rawQuery: string,
): DocumentDTO => {
  const query = rawQuery.trim();
  if (!query) {
    throw new Error("文档标识不能为空");
  }

  const normalizedQuery = normalizeDocumentPath(query).toLowerCase();
  const queryBaseName = path.basename(normalizedQuery);

  const exactMatches = docs.filter((doc) => {
    const normalizedId = normalizeDocumentPath(doc.id).toLowerCase();
    return (
      normalizedId === normalizedQuery ||
      doc.id.toLowerCase() === query.toLowerCase()
    );
  });
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw new Error(
      `匹配到多个文档：${exactMatches
        .slice(0, 8)
        .map((item) => item.id)
        .join("，")}`,
    );
  }

  const baseNameMatches = docs.filter((doc) => {
    const normalizedId = normalizeDocumentPath(doc.id).toLowerCase();
    return path.basename(normalizedId) === queryBaseName;
  });
  if (baseNameMatches.length === 1) return baseNameMatches[0];
  if (baseNameMatches.length > 1) {
    throw new Error(
      `文档名"${queryBaseName}"匹配到多个文件：${baseNameMatches
        .slice(0, 8)
        .map((item) => item.id)
        .join("，")}`,
    );
  }

  const fuzzyMatches = docs.filter((doc) => {
    const normalizedId = normalizeDocumentPath(doc.id).toLowerCase();
    return (
      normalizedId.includes(normalizedQuery) ||
      path.basename(normalizedId).includes(queryBaseName)
    );
  });
  if (fuzzyMatches.length === 1) return fuzzyMatches[0];
  if (fuzzyMatches.length > 1) {
    throw new Error(
      `文档"${query}"匹配不唯一：${fuzzyMatches
        .slice(0, 8)
        .map((item) => item.id)
        .join("，")}`,
    );
  }

  const sampleIds = docs.slice(0, 10).map((item) => item.id);
  throw new Error(
    `未找到文档：${query}${sampleIds.length > 0 ? `。可选示例：${sampleIds.join("，")}` : ""}`,
  );
};

const emitNavigate = (input: {
  projectId: string;
  module?: ChatModuleType;
  documentId?: string;
}): void => {
  appOperationEvents.emit({
    type: "navigate",
    projectId: input.projectId,
    module: input.module,
    documentId: input.documentId,
  });
};

const emitAppPreviewRefreshed = (projectId: string): void => {
  appOperationEvents.emit({
    type: "app_preview_refreshed",
    projectId,
  });
};

export const createAppOperationTools = (
  currentProjectId: string,
  scopeType: ChatScope["type"],
): CustomToolDef[] => {
  const projectAgentOnlyToolNames = new Set(["SwitchModule", "OpenDocument"]);
  const tools: CustomToolDef[] = [
    {
      name: "SwitchModule",
      label: "SwitchModule",
      description:
        "切换当前应用模块。支持 main(聊天)、docs(文档)、assets(素材)、app(应用)。",
      parameters: Type.Object({
        module: Type.Union(
          [
            Type.Literal("main"),
            Type.Literal("docs"),
            Type.Literal("assets"),
            Type.Literal("app"),
          ],
          { description: "目标模块：main | docs | assets | app" },
        ),
        project_id: Type.Optional(
          Type.String({
            description:
              "兼容旧参数。可选，目标 Agent ID；不传则使用当前对话 Agent",
          }),
        ),
        agent_id: Type.Optional(
          Type.String({
            description: "可选，目标 Agent ID；不传则使用当前对话 Agent",
          }),
        ),
      }),
      async handler(input) {
        try {
          const module = input.module as ChatModuleType;
          const projectId =
            (input.agent_id as string | undefined) ??
            (input.project_id as string | undefined);
          const project = await resolveProject(currentProjectId, projectId);
          emitNavigate({ projectId: project.id, module });
          return {
            text: `已切换到 Agent ${describeProject(project)} 的 ${MODULE_LABELS[module]} 模块。`,
          };
        } catch (error) {
          return {
            text: `SwitchModule failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "BuildAndRefreshApp",
      label: "BuildAndRefreshApp",
      description: "构建应用并刷新预览（构建并预览）。",
      parameters: Type.Object({
        project_id: Type.Optional(
          Type.String({
            description:
              "兼容旧参数。可选，目标 Agent ID；不传则使用当前对话 Agent",
          }),
        ),
        agent_id: Type.Optional(
          Type.String({
            description: "可选，目标 Agent ID；不传则使用当前对话 Agent",
          }),
        ),
        switch_to_app: Type.Optional(
          Type.Boolean({
            description: "构建完成后是否切换到应用模块，默认 true",
          }),
        ),
      }),
      async handler(input) {
        try {
          const projectId =
            (input.agent_id as string | undefined) ??
            (input.project_id as string | undefined);
          const switchToApp =
            (input.switch_to_app as boolean | undefined) ?? true;
          const project = await resolveProject(currentProjectId, projectId);
          const buildResult = await repositoryService.buildAppWorkspace(
            project.id,
          );

          if (switchToApp) {
            emitNavigate({ projectId: project.id, module: "app" });
          }
          emitAppPreviewRefreshed(project.id);

          return {
            text: [
              `已完成 Agent ${describeProject(project)} 的"构建并预览"。`,
              `预览入口：${buildResult.distIndexPath}`,
              `构建时间：${buildResult.builtAt}`,
              buildResult.installedDependencies
                ? "已自动安装缺失依赖。"
                : "依赖已就绪，直接完成构建。",
              switchToApp
                ? "已切换到应用模块并刷新预览。"
                : "未切换模块，但已刷新应用预览。",
            ].join("\n"),
          };
        } catch (error) {
          return {
            text: `BuildAndRefreshApp failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "ReloadSettings",
      label: "ReloadSettings",
      description:
        "重新加载并应用当前设置，让快捷键、聊天通道和后续 Agent 会话按最新配置生效。",
      parameters: Type.Object({}),
      async handler() {
        try {
          await settingsRuntimeService.reload();
          return {
            text: "已重新加载并应用最新设置；新的快捷键、通道配置和后续 Agent 会话都会按最新配置生效。",
          };
        } catch (error) {
          return {
            text: `ReloadSettings failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "ListAgents",
      label: "ListAgents",
      description:
        "列出全部 Agent，并按最近更新时间排序；可传 query 返回最可能的委派目标。",
      parameters: Type.Object({
        query: Type.Optional(
          Type.String({
            description:
              "可选，Agent 名称/ID/关键词；传入后将返回最可能的目标 Agent",
          }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "可选，返回条数上限，默认 20" }),
        ),
      }),
      async handler(input) {
        try {
          const query = input.query as string | undefined;
          const limit = (input.limit as number | undefined) ?? 20;
          const projects = await repositoryService.listProjects();
          if (projects.length === 0) {
            return { text: "当前没有可用 Agent。" };
          }

          const rows = projects.slice(0, limit);
          const lines = [
            `共 ${projects.length} 个 Agent（按最近更新时间排序）：`,
            ...rows.map((project, index) => {
              const marks: string[] = [];
              if (project.id === currentProjectId) marks.push("当前");
              const marker = marks.length > 0 ? ` [${marks.join(" / ")}]` : "";
              const description = project.description?.trim()
                ? ` · ${project.description.trim()}`
                : "";
              return `${index + 1}. ${describeProject(project)}${marker} · 更新时间：${project.updatedAt}${description}`;
            }),
          ];

          if (query && query.trim()) {
            const matched = resolveMostLikelyProjectMatch(projects, query);
            lines.push(
              `最可能切换目标：${describeProject(matched.project)}（${matched.reason}）`,
            );
          }

          return { text: lines.join("\n") };
        } catch (error) {
          return {
            text: `ListAgents failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "ListAvailableModels",
      label: "ListAvailableModels",
      description:
        "列出当前已启用的 Agent 模型，返回可用于 CreateAgent 和 UpdateAgent 的 provider:modelId。",
      parameters: Type.Object({}),
      async handler() {
        try {
          const status = await settingsService.getClaudeStatus();
          if (status.allEnabledModels.length === 0) {
            return { text: "当前没有已启用的 Agent 模型。" };
          }

          const lines = [
            `当前已启用 ${status.allEnabledModels.length} 个 Agent 模型：`,
            ...status.allEnabledModels.map((model, index) => {
              const modelKey = `${model.provider}:${model.modelId}`;
              return `${index + 1}. ${modelKey} · ${model.modelName}`;
            }),
          ];
          return { text: lines.join("\n") };
        } catch (error) {
          return {
            text: `ListAvailableModels failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "CreateAgent",
      label: "CreateAgent",
      description:
        "新建一个智能体，name 应该基于上下文生成一个合理的像人一样的名字，例如用户明确要求使用的名字，而不是一个纯容器式的名字。可设置默认模型和思考等级；未指定默认模型时使用最新已启用模型，并使用 medium 思考等级。若用户没有明确要求把当前任务或后续定时任务交给该 Agent，默认仍由主 Agent 继续执行。",
      parameters: Type.Object({
        name: Type.Optional(
          Type.String({
            description: "智能体的名称",
          }),
        ),
        description: Type.Optional(
          Type.String({
            description: "智能体的描述",
          }),
        ),
        default_model: Type.Optional(
          Type.String({
            description:
              "默认模型，格式为 provider:modelId；不传则使用最新已启用模型",
          }),
        ),
        model: Type.Optional(
          Type.String({
            description: "兼容参数。默认模型，格式为 provider:modelId",
          }),
        ),
        thinking_level: Type.Optional(
          Type.Union(
            [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
            { description: "默认思考等级：low | medium | high，默认 medium" },
          ),
        ),
      }),
      async handler(input) {
        try {
          const name = input.name as string | undefined;
          const description = input.description as string | undefined;
          const defaultModel = await resolveAgentDefaultModel(
            getOptionalString(input.default_model) ?? getOptionalString(input.model),
          );
          const thinkingLevel = resolveThinkingLevel(
            input.thinking_level,
            "medium",
          );
          const project = await repositoryService.createProject({
            name,
            description: description?.trim() ? description : undefined,
            source: "agent",
          });
          await applyAgentDefaults({
            projectId: project.id,
            model: defaultModel,
            thinkingLevel,
          });

          const workspaceDir = path.join(WORKSPACE_ROOT, project.id);
          return {
            text: [
              `Agent 已创建：${describeProject(project)}`,
              `Agent ID：${project.id}`,
              `工作目录：${workspaceDir}`,
              `默认模型：${defaultModel}`,
              `思考等级：${thinkingLevel}`,
              "如果用户没有明确指定目标 Agent，后续任务默认继续由主 Agent 处理。",
              "如需进入该 Agent 工作区，请调用 OpenAgent。",
            ].join("\n"),
          };
        } catch (error) {
          return {
            text: `CreateAgent failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "UpdateAgent",
      label: "UpdateAgent",
      description:
        "修改指定 Agent 的基础信息，包括名称、描述、默认模型和思考等级。不传的字段保持不变。",
      parameters: Type.Object({
        agent: Type.Optional(
          Type.String({
            description: "目标 Agent 的名称、ID 或关键词；不传则使用当前对话 Agent",
          }),
        ),
        project_id: Type.Optional(
          Type.String({
            description: "兼容旧参数。可选，目标 Agent ID",
          }),
        ),
        agent_id: Type.Optional(
          Type.String({
            description: "兼容旧参数。可选，目标 Agent ID",
          }),
        ),
        name: Type.Optional(
          Type.String({
            description: "新的 Agent 名称",
          }),
        ),
        description: Type.Optional(
          Type.String({
            description: "新的 Agent 描述；传空字符串可清空描述",
          }),
        ),
        default_model: Type.Optional(
          Type.String({
            description: "默认模型，格式为 provider:modelId",
          }),
        ),
        model: Type.Optional(
          Type.String({
            description: "兼容参数。默认模型，格式为 provider:modelId",
          }),
        ),
        thinking_level: Type.Optional(
          Type.Union(
            [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
            { description: "思考等级：low | medium | high" },
          ),
        ),
      }),
      async handler(input) {
        try {
          const projectQuery =
            getOptionalString(input.agent) ??
            getOptionalString(input.agent_id) ??
            getOptionalString(input.project_id);
          const project = await resolveProject(currentProjectId, projectQuery);
          if (project.id === MAIN_AGENT_SCOPE_ID) {
            throw new Error("主 Agent 暂不支持修改基础信息");
          }

          const modelRequested =
            input.default_model !== undefined || input.model !== undefined;
          const defaultModel = modelRequested
            ? await resolveAgentDefaultModel(
                getOptionalString(input.default_model) ??
                  getOptionalString(input.model),
              )
            : undefined;
          const thinkingLevel =
            input.thinking_level !== undefined
              ? resolveThinkingLevel(input.thinking_level, "medium")
              : undefined;

          const name = getOptionalString(input.name);
          const description = getOptionalString(input.description);
          const projectUpdateRequested =
            input.name !== undefined || input.description !== undefined;
          const updatedProject = projectUpdateRequested
            ? await repositoryService.updateProject({
                id: project.id,
                name,
                description:
                  input.description !== undefined
                    ? description?.trim()
                      ? description
                      : null
                    : undefined,
              })
            : project;

          await applyAgentDefaults({
            projectId: project.id,
            model: defaultModel,
            thinkingLevel,
          });

          const lines = [`Agent 已更新：${describeProject(updatedProject)}`];
          if (defaultModel) {
            lines.push(`默认模型：${defaultModel}`);
          }
          if (thinkingLevel) {
            lines.push(`思考等级：${thinkingLevel}`);
          }
          if (!projectUpdateRequested && !defaultModel && !thinkingLevel) {
            lines.push("未提供需要修改的字段。");
          }
          return { text: lines.join("\n") };
        } catch (error) {
          return {
            text: `UpdateAgent failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "OpenAgent",
      label: "OpenAgent",
      description: "打开指定 Agent，并自动切换到对应 Agent workspace。",
      parameters: Type.Object({
        agent: Type.String({
          description: "目标 Agent 的名称、ID 或关键词",
        }),
        module: Type.Optional(
          Type.Union(
            [
              Type.Literal("main"),
              Type.Literal("docs"),
              Type.Literal("assets"),
              Type.Literal("app"),
            ],
            { description: "打开后进入的模块，默认 docs" },
          ),
        ),
        project_id: Type.Optional(
          Type.String({
            description: "兼容旧参数。可选，目标 Agent ID",
          }),
        ),
        agent_id: Type.Optional(
          Type.String({
            description: "兼容旧参数。可选，目标 Agent ID",
          }),
        ),
      }),
      async handler(input) {
        try {
          const projectQuery =
            (input.agent as string | undefined) ??
            (input.agent_id as string | undefined) ??
            (input.project_id as string | undefined);
          const module = (input.module as ChatModuleType | undefined) ?? "docs";
          const project = await resolveProject(currentProjectId, projectQuery);

          emitNavigate({ projectId: project.id, module });

          return {
            text: `已打开 Agent ${describeProject(project)}，并切换到 ${MODULE_LABELS[module]} 模块。`,
          };
        } catch (error) {
          return {
            text: `OpenAgent failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "OpenDocument",
      label: "OpenDocument",
      description: "打开指定文档并切换到文档模块。",
      parameters: Type.Object({
        document: Type.String({
          description:
            "文档路径/文件名/关键词，例如 note-1.md 或 docs/story/outline.md",
        }),
        project_id: Type.Optional(
          Type.String({
            description:
              "兼容旧参数。可选，目标 Agent ID；不传则使用当前对话 Agent",
          }),
        ),
        agent_id: Type.Optional(
          Type.String({
            description: "可选，目标 Agent ID；不传则使用当前对话 Agent",
          }),
        ),
      }),
      async handler(input) {
        try {
          const document = input.document as string;
          const projectId =
            (input.agent_id as string | undefined) ??
            (input.project_id as string | undefined);
          const project = await resolveProject(currentProjectId, projectId);
          const docs = await repositoryService.listDocuments(project.id);
          if (docs.length === 0) {
            throw new Error(`Agent ${describeProject(project)} 下暂无文档`);
          }

          const matched = resolveUniqueDocumentMatch(docs, document);
          emitNavigate({
            projectId: project.id,
            module: "docs",
            documentId: matched.id,
          });

          return {
            text: `已打开 Agent ${describeProject(project)} 的文档：${matched.id}。`,
          };
        } catch (error) {
          return {
            text: `OpenDocument failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
  ];

  if (scopeType === "project") {
    return tools;
  }

  return tools.filter((tool) => !projectAgentOnlyToolNames.has(tool.name));
};
