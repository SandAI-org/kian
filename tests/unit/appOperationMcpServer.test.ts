import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppOperationEvent, ProjectDTO } from "../../src/shared/types";
import { appOperationEvents } from "../../electron/main/services/appOperationEvents";
import { createAppOperationTools } from "../../electron/main/services/appOperationMcpServer";
import { toToolDefinition } from "../../electron/main/services/customTools";
import { agentGroupService } from "../../electron/main/services/agentGroupService";
import { repositoryService } from "../../electron/main/services/repositoryService";
import { settingsService } from "../../electron/main/services/settingsService";
import { settingsRuntimeService } from "../../electron/main/services/settingsRuntimeService";

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: {
    listProjects: vi.fn(),
    getProjectById: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    buildAppWorkspace: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/agentGroupService", () => ({
  agentGroupService: {
    createGroup: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/settingsService", () => ({
  settingsService: {
    getClaudeStatus: vi.fn(),
    setLastSelectedModel: vi.fn(),
    setLastSelectedThinkingLevel: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/settingsRuntimeService", () => ({
  settingsRuntimeService: {
    reload: vi.fn(),
  },
}));

const mockedRepositoryService = vi.mocked(repositoryService);
const mockedAgentGroupService = vi.mocked(agentGroupService);
const mockedSettingsService = vi.mocked(settingsService);
const mockedSettingsRuntimeService = vi.mocked(settingsRuntimeService);

const createClaudeStatus = () => ({
  providers: {
    openai: {
      configured: true,
      enabled: true,
      apiKey: "sk-test",
      customModels: [],
      enabledModels: ["gpt-5.4"],
    },
  },
  allEnabledModels: [
    {
      provider: "openai",
      modelId: "gpt-5.4",
      modelName: "GPT-5.4",
    },
    {
      provider: "anthropic",
      modelId: "claude-test",
      modelName: "Claude Test",
    },
  ],
  lastSelectedModel: undefined,
  lastSelectedThinkingLevel: undefined,
});

const createProjectDto = (
  overrides: Partial<ProjectDTO> = {},
): ProjectDTO => ({
  id: "agent-a",
  name: "阿青",
  description: "内容策划 Agent",
  cover: null,
  createdAt: "2026-03-10T10:00:00.000Z",
  updatedAt: "2026-03-10T10:00:00.000Z",
  ...overrides,
});

describe("createAppOperationTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSettingsService.getClaudeStatus.mockResolvedValue(createClaudeStatus());
  });

  it("runs app operation tools sequentially in multi-tool turns", () => {
    const tools = createAppOperationTools("current-agent", "main");
    const createAgentTool = tools.find((item) => item.name === "CreateAgent");
    const listAgentsTool = tools.find((item) => item.name === "ListAgents");

    expect(createAgentTool?.executionMode).toBe("sequential");
    expect(listAgentsTool?.executionMode).toBe("sequential");
    expect(toToolDefinition(createAgentTool!).executionMode).toBe("sequential");
    expect(toToolDefinition(listAgentsTool!).executionMode).toBe("sequential");
  });

  it("exposes CreateGroup as a normal app operation tool", async () => {
    mockedAgentGroupService.createGroup.mockResolvedValue({
      id: "g-team",
      name: "Research Team",
      description: "Work together",
      memberProjectIds: ["agent-a", "agent-b"],
      createdAt: "2026-03-10T10:00:00.000Z",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });

    const tool = createAppOperationTools("current-agent", "main").find(
      (item) => item.name === "CreateGroup",
    );

    expect(tool).toBeDefined();

    const result = await tool!.handler({
      name: "Research Team",
      description: "Work together",
      memberProjectIds: ["agent-a", "agent-b"],
    });

    expect(mockedAgentGroupService.createGroup).toHaveBeenCalledWith({
      name: "Research Team",
      description: "Work together",
      memberProjectIds: ["agent-a", "agent-b"],
    });
    expect(result).toEqual({
      text: [
        "群聊已创建：Research Team (g-team)",
        "描述：Work together",
        "成员 Agent ID：agent-a，agent-b",
      ].join("\n"),
    });
  });

  it("CreateAgent no longer exposes auto-open params and does not navigate", async () => {
    const events: AppOperationEvent[] = [];
    const dispose = appOperationEvents.on((event) => {
      events.push(event);
    });
    const createdProject = createProjectDto();
    mockedRepositoryService.createProject.mockResolvedValue(createdProject);

    try {
      const tool = createAppOperationTools("current-agent", "main").find(
        (item) => item.name === "CreateAgent",
      );

      expect(tool).toBeDefined();
      const schema = tool?.parameters as {
        properties?: Record<string, unknown>;
      };
      expect(schema.properties).not.toHaveProperty("open_after_create");
      expect(schema.properties).not.toHaveProperty("module");

      const result = await tool!.handler({
        name: "阿青",
        description: "内容策划 Agent",
      });

      expect(mockedRepositoryService.createProject).toHaveBeenCalledWith({
        name: "阿青",
        description: "内容策划 Agent",
        source: "agent",
      });
      expect(events).toEqual([]);
      expect(result).toEqual({
        text: [
          "Agent 已创建：阿青 (agent-a)",
          "Agent ID：agent-a",
          "工作目录：/Users/lei/KianWorkspaceTest/agent-a",
          "默认模型：openai:gpt-5.4",
          "思考等级：medium",
          "如果用户没有明确指定目标 Agent，后续任务默认继续由主 Agent 处理。",
          "如需进入该 Agent 工作区，请调用 OpenAgent。",
        ].join("\n"),
      });
      expect(mockedSettingsService.setLastSelectedModel).toHaveBeenCalledWith(
        { type: "project", projectId: "agent-a" },
        "openai:gpt-5.4",
      );
      expect(
        mockedSettingsService.setLastSelectedThinkingLevel,
      ).toHaveBeenCalledWith({ type: "project", projectId: "agent-a" }, "medium");
    } finally {
      dispose();
    }
  });

  it("CreateAgent accepts explicit default model and thinking level", async () => {
    const createdProject = createProjectDto();
    mockedRepositoryService.createProject.mockResolvedValue(createdProject);

    const tool = createAppOperationTools("current-agent", "main").find(
      (item) => item.name === "CreateAgent",
    );

    expect(tool).toBeDefined();

    const result = await tool!.handler({
      name: "阿青",
      default_model: "openai:gpt-5.4",
      thinking_level: "high",
    });

    expect(result.text).toContain("默认模型：openai:gpt-5.4");
    expect(result.text).toContain("思考等级：high");
    expect(mockedSettingsService.setLastSelectedModel).toHaveBeenCalledWith(
      { type: "project", projectId: "agent-a" },
      "openai:gpt-5.4",
    );
    expect(mockedSettingsService.setLastSelectedThinkingLevel).toHaveBeenCalledWith(
      { type: "project", projectId: "agent-a" },
      "high",
    );
  });

  it("UpdateAgent updates metadata and defaults", async () => {
    mockedRepositoryService.listProjects.mockResolvedValue([createProjectDto()]);
    mockedRepositoryService.updateProject.mockResolvedValue(
      createProjectDto({
        name: "阿青 Pro",
        description: "新的描述",
        updatedAt: "2026-03-11T10:00:00.000Z",
      }),
    );

    const tool = createAppOperationTools("current-agent", "main").find(
      (item) => item.name === "UpdateAgent",
    );

    expect(tool).toBeDefined();

    const result = await tool!.handler({
      agent: "阿青",
      name: "阿青 Pro",
      description: "新的描述",
      default_model: "openai:gpt-5.4",
      thinking_level: "low",
    });

    expect(mockedRepositoryService.updateProject).toHaveBeenCalledWith({
      id: "agent-a",
      name: "阿青 Pro",
      description: "新的描述",
    });
    expect(mockedSettingsService.setLastSelectedModel).toHaveBeenCalledWith(
      { type: "project", projectId: "agent-a" },
      "openai:gpt-5.4",
    );
    expect(mockedSettingsService.setLastSelectedThinkingLevel).toHaveBeenCalledWith(
      { type: "project", projectId: "agent-a" },
      "low",
    );
    expect(result).toEqual({
      text: [
        "Agent 已更新：阿青 Pro (agent-a)",
        "默认模型：openai:gpt-5.4",
        "思考等级：low",
      ].join("\n"),
    });
  });

  it("ListAvailableModels returns enabled model keys for agent defaults", async () => {
    const tool = createAppOperationTools("current-agent", "main").find(
      (item) => item.name === "ListAvailableModels",
    );

    expect(tool).toBeDefined();

    const result = await tool!.handler({});

    expect(result).toEqual({
      text: [
        "当前已启用 2 个 Agent 模型：",
        "1. openai:gpt-5.4 · GPT-5.4",
        "2. anthropic:claude-test · Claude Test",
      ].join("\n"),
    });
  });

  it("OpenAgent resolves the target agent and emits navigate event", async () => {
    const events: AppOperationEvent[] = [];
    const dispose = appOperationEvents.on((event) => {
      events.push(event);
    });
    mockedRepositoryService.listProjects.mockResolvedValue([
      createProjectDto(),
      createProjectDto({
        id: "agent-b",
        name: "小白",
        updatedAt: "2026-03-09T10:00:00.000Z",
      }),
    ]);

    try {
      const tool = createAppOperationTools("current-agent", "main").find(
        (item) => item.name === "OpenAgent",
      );

      expect(tool).toBeDefined();

      const result = await tool!.handler({ agent: "阿青" });

      expect(events).toEqual([
        {
          type: "navigate",
          projectId: "agent-a",
          module: "docs",
        },
      ]);
      expect(result).toEqual({
        text: "已打开 Agent 阿青 (agent-a)，并切换到 文档 模块。",
      });
    } finally {
      dispose();
    }
  });

  it("BuildAndRefreshApp defaults to the main agent app in main scope", async () => {
    const events: AppOperationEvent[] = [];
    const dispose = appOperationEvents.on((event) => {
      events.push(event);
    });
    mockedRepositoryService.buildAppWorkspace.mockResolvedValue({
      projectId: "main-agent",
      appDir: "/Users/lei/KianWorkspaceTest/.kian/main-agent/app",
      distIndexPath:
        "/Users/lei/KianWorkspaceTest/.kian/main-agent/app/dist/index.html",
      builtAt: "2026-05-13T17:02:45.117Z",
      installedDependencies: false,
    });

    try {
      const tool = createAppOperationTools("main-agent", "main").find(
        (item) => item.name === "BuildAndRefreshApp",
      );

      expect(tool).toBeDefined();

      const result = await tool!.handler({});

      expect(mockedRepositoryService.listProjects).not.toHaveBeenCalled();
      expect(mockedRepositoryService.getProjectById).not.toHaveBeenCalled();
      expect(mockedRepositoryService.buildAppWorkspace).toHaveBeenCalledWith(
        "main-agent",
      );
      expect(events).toEqual([
        {
          type: "navigate",
          projectId: "main-agent",
          module: "app",
        },
        {
          type: "app_preview_refreshed",
          projectId: "main-agent",
        },
      ]);
      expect(result).toEqual({
        text: [
          '已完成 Agent 主 Agent (main-agent) 的"构建并预览"。',
          "预览入口：/Users/lei/KianWorkspaceTest/.kian/main-agent/app/dist/index.html",
          "构建时间：2026-05-13T17:02:45.117Z",
          "依赖已就绪，直接完成构建。",
          "已切换到应用模块并刷新预览。",
        ].join("\n"),
      });
    } finally {
      dispose();
    }
  });

  it("ReloadSettings reloads and reapplies runtime settings", async () => {
    const tool = createAppOperationTools("current-agent", "main").find(
      (item) => item.name === "ReloadSettings",
    );

    expect(tool).toBeDefined();

    const result = await tool!.handler({});

    expect(mockedSettingsRuntimeService.reload).toHaveBeenCalledWith();
    expect(result).toEqual({
      text: "已重新加载并应用最新设置；新的快捷键、通道配置和后续 Agent 会话都会按最新配置生效。",
    });
  });
});
