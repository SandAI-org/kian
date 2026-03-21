import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspaceRoot: "/tmp/kian-agent-delegation",
  appendMessage: vi.fn(),
  chatSend: vi.fn(),
  createSessionAssistantReplyStreamer: vi.fn(),
  createAgentAssistantMirrorStreamer: vi.fn(),
  assistantMirrorPushEvent: vi.fn(),
  assistantMirrorFinalize: vi.fn(),
  listProjects: vi.fn(),
  listMessages: vi.fn(),
  createChatSession: vi.fn(),
  getChatSession: vi.fn(),
  getProjectById: vi.fn(),
  setChatSessionSdkSessionId: vi.fn(),
  getModel: vi.fn(),
  createAgentSession: vi.fn(),
  continueRecent: vi.fn(),
  createSessionManager: vi.fn(),
  getClaudeStatus: vi.fn(),
  getMcpServers: vi.fn(),
  getAgentSystemPrompt: vi.fn(),
  getClaudeSecret: vi.fn(),
  resolveAgentModel: vi.fn(),
  listActiveSkillsForScope: vi.fn(),
  buildSessionSystemPrompt: vi.fn(),
  buildMcpServerSignature: vi.fn(),
  createMcpRuntime: vi.fn(),
  sendCustomMessage: vi.fn(),
  followUp: vi.fn(),
  customTools: [] as Array<{
    name?: string;
    handler?: (...args: any[]) => Promise<any>;
  }>,
  sendCustomMessageCallCount: 0,
  prompt: vi.fn(),
  sendUserMessage: vi.fn(),
  sessionListener: undefined as ((event: { type: string }) => void) | undefined,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock("@mariozechner/pi-ai", () => ({
  Type: {
    Object: (value: unknown) => value,
    Optional: (value: unknown) => value,
    String: (value: unknown) => value,
    Union: (value: unknown) => value,
    Literal: (value: unknown) => value,
    Array: (value: unknown) => value,
  },
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: {
    inMemory: () => ({
      setRuntimeApiKey: vi.fn(),
    }),
  },
  createAgentSession: (...args: unknown[]) => state.createAgentSession(...args),
  createCodingTools: () => [],
  DefaultResourceLoader: class {
    private readonly options: {
      systemPromptOverride?: () => string;
    };

    constructor(options: { systemPromptOverride?: () => string }) {
      this.options = options;
    }

    async reload(): Promise<void> {
      this.options.systemPromptOverride?.();
    }

    getSkills(): { skills: never[] } {
      return { skills: [] };
    }
  },
  SessionManager: {
    continueRecent: (...args: unknown[]) => state.continueRecent(...args),
    create: (...args: unknown[]) => state.createSessionManager(...args),
  },
}));

vi.mock("../../electron/main/services/workspacePaths", () => ({
  get GLOBAL_CONFIG_DIR() {
    return path.join(state.workspaceRoot, ".global");
  },
  get WORKSPACE_ROOT() {
    return state.workspaceRoot;
  },
  get INTERNAL_ROOT() {
    return path.join(state.workspaceRoot, ".kian");
  },
}));

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: {
    appendMessage: (...args: unknown[]) => state.appendMessage(...args),
    listProjects: (...args: unknown[]) => state.listProjects(...args),
    listMessages: (...args: unknown[]) => state.listMessages(...args),
    createChatSession: (...args: unknown[]) => state.createChatSession(...args),
    getChatSession: (...args: unknown[]) => state.getChatSession(...args),
    getProjectById: (...args: unknown[]) => state.getProjectById(...args),
    setChatSessionSdkSessionId: (...args: unknown[]) =>
      state.setChatSessionSdkSessionId(...args),
  },
}));

vi.mock("../../electron/main/services/settingsService", () => ({
  settingsService: {
    getClaudeStatus: (...args: unknown[]) => state.getClaudeStatus(...args),
    getMcpServers: (...args: unknown[]) => state.getMcpServers(...args),
    getAgentSystemPrompt: (...args: unknown[]) =>
      state.getAgentSystemPrompt(...args),
    getClaudeSecret: (...args: unknown[]) => state.getClaudeSecret(...args),
    resolveAgentModel: (...args: unknown[]) => state.resolveAgentModel(...args),
  },
}));

vi.mock("../../electron/main/services/skillService", () => ({
  skillService: {
    listActiveSkillsForScope: (...args: unknown[]) =>
      state.listActiveSkillsForScope(...args),
  },
}));

vi.mock("../../electron/main/services/agentPrompt", () => ({
  buildSessionSystemPrompt: (...args: unknown[]) =>
    state.buildSessionSystemPrompt(...args),
}));

vi.mock("../../electron/main/services/appOperationMcpServer", () => ({
  createAppOperationTools: () => [],
}));

vi.mock("../../electron/main/services/builtinMcpServer", () => ({
  createBuiltinTools: () => [],
}));

vi.mock("../../electron/main/services/customTools", () => ({
  toToolDefinition: (tool: unknown) => tool,
}));

vi.mock("../../electron/main/services/chatEvents", () => ({
  chatEvents: {
    emitStream: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/mediaMarkdown", () => ({
  buildExtendedMarkdown: vi.fn(),
  buildMediaMarkdown: vi.fn(),
  detectAttachmentMediaKind: vi.fn(),
  normalizeMediaMarkdownInText: (text: string) => text,
  resolveAttachmentAbsolutePath: vi.fn(),
}));

vi.mock("../../electron/main/services/mcpRuntime", () => ({
  buildMcpServerSignature: (...args: unknown[]) =>
    state.buildMcpServerSignature(...args),
  createMcpRuntime: (...args: unknown[]) => state.createMcpRuntime(...args),
}));

vi.mock("../../electron/main/services/chatService", () => ({
  chatService: {
    send: (...args: unknown[]) => state.chatSend(...args),
  },
}));

vi.mock("../../electron/main/services/chatChannelService", () => ({
  chatChannelService: {
    createSessionAssistantReplyStreamer: (...args: unknown[]) =>
      state.createSessionAssistantReplyStreamer(...args),
    createAgentAssistantMirrorStreamer: (...args: unknown[]) =>
      state.createAgentAssistantMirrorStreamer(...args),
  },
}));

describe("agentService delegation reporting", () => {
  beforeEach(() => {
    vi.resetModules();
    state.sessionListener = undefined;
    state.appendMessage.mockReset().mockResolvedValue(undefined);
    state.chatSend.mockReset().mockResolvedValue({
      assistantMessage: "主 Agent 已处理回报",
      toolActions: [],
    });
    state.createSessionAssistantReplyStreamer.mockReset().mockReturnValue(null);
    state.assistantMirrorPushEvent.mockReset();
    state.assistantMirrorFinalize.mockReset().mockResolvedValue(undefined);
    state.createAgentAssistantMirrorStreamer.mockReset().mockReturnValue({
      pushEvent: (...args: unknown[]) =>
        state.assistantMirrorPushEvent(...args),
      finalize: (...args: unknown[]) => state.assistantMirrorFinalize(...args),
    });
    state.listProjects.mockReset().mockResolvedValue([]);
    state.listMessages.mockReset().mockResolvedValue([]);
    state.createChatSession.mockReset().mockResolvedValue({
      id: "sub-session-1",
    });
    state.getChatSession.mockReset().mockResolvedValue(null);
    state.getProjectById.mockReset().mockResolvedValue({
      id: "agent-a",
      name: "Agent A",
    });
    state.setChatSessionSdkSessionId.mockReset().mockResolvedValue(undefined);
    state.resolveAgentModel.mockReset().mockResolvedValue({
      provider: "anthropic",
      id: "claude-test",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      name: "Claude Test",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    });
    state.continueRecent.mockReset().mockReturnValue({
      buildSessionContext: () => ({ model: null }),
    });
    state.createSessionManager.mockReset().mockReturnValue({
      buildSessionContext: () => ({ model: null }),
    });
    state.getClaudeStatus.mockReset().mockResolvedValue({
      allEnabledModels: [{ provider: "anthropic", modelId: "claude-test" }],
      providers: {
        anthropic: {
          apiKey: "test-key",
        },
      },
    });
    state.getMcpServers.mockReset().mockResolvedValue([]);
    state.getAgentSystemPrompt.mockReset().mockResolvedValue("system prompt");
    state.getClaudeSecret.mockReset().mockResolvedValue("");
    state.listActiveSkillsForScope.mockReset().mockResolvedValue([]);
    state.buildSessionSystemPrompt
      .mockReset()
      .mockImplementation((prompt) => prompt);
    state.buildMcpServerSignature.mockReset().mockReturnValue("mcp-signature");
    state.createMcpRuntime.mockReset().mockResolvedValue({
      tools: [],
      warnings: [],
      dispose: vi.fn().mockResolvedValue(undefined),
    });
    state.customTools = [];
    state.sendCustomMessageCallCount = 0;
    state.sendCustomMessage.mockReset().mockImplementation(async (...args) => {
      state.sendCustomMessageCallCount += 1;
      state.sessionListener?.({ type: "agent_end" });
      return args;
    });
    state.followUp.mockReset().mockResolvedValue(undefined);
    state.prompt.mockReset().mockResolvedValue(undefined);
    state.sendUserMessage.mockReset().mockResolvedValue(undefined);
    state.createAgentSession.mockReset().mockImplementation(async (options) => {
      state.customTools = ((options as { customTools?: Array<any> })
        .customTools ?? []) as Array<{
        name?: string;
        handler?: (...args: any[]) => Promise<any>;
      }>;
      return {
        session: {
          sessionId: "sdk-session-1",
          subscribe: (listener: (event: { type: string }) => void) => {
            state.sessionListener = listener;
            return () => {
              state.sessionListener = undefined;
            };
          },
          setThinkingLevel: vi.fn(),
          sendCustomMessage: (...args: unknown[]) =>
            state.sendCustomMessage(...args),
          followUp: (...args: unknown[]) => state.followUp(...args),
          prompt: (...args: unknown[]) => state.prompt(...args),
          sendUserMessage: (...args: unknown[]) =>
            state.sendUserMessage(...args),
        },
      };
    });
  });

  it("marks auto report as completed when tool output can be forwarded", async () => {
    const { buildAutomaticDelegationReport } =
      await import("../../electron/main/services/agentService");

    const report = buildAutomaticDelegationReport({
      reason: "completed",
      finalMessage: "已处理请求，但未收到 Agent 文本回复。",
      toolOutputs: ["创建 docs/summary.md", "产出最终结论"],
    });

    expect(report.status).toBe("completed");
    expect(report.result).toContain("Agent 未输出最终文字说明");
    expect(report.result).toContain("1. 创建 docs/summary.md");
    expect(report.result).toContain("2. 产出最终结论");
  });

  it("marks empty missing-call auto report as failed", async () => {
    const { buildAutomaticDelegationReport } =
      await import("../../electron/main/services/agentService");

    const report = buildAutomaticDelegationReport({
      reason: "completed",
      finalMessage: "已处理请求，但未收到 Agent 文本回复。",
      toolOutputs: [],
    });

    expect(report.status).toBe("failed");
    expect(report.result).toContain("已处理请求，但未收到 Agent 文本回复。");
  });

  it("returns a neutral final message when only tool output is available", async () => {
    const { agentService } =
      await import("../../electron/main/services/agentService");

    state.prompt.mockReset().mockImplementation(async () => {
      state.sessionListener?.({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "writeDocument",
        result: {
          content: [{ type: "text", text: "已写入 docs/summary.md" }],
        },
      });
      state.sessionListener?.({ type: "agent_end" });
    });

    const result = await agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session",
      requestId: "main-request-tool-only",
      message: "只需要执行工具",
    });

    expect(result.assistantMessage).toBe("已处理完成。");
  });

  it("surfaces assistant error messages emitted at message_end", async () => {
    const { agentService } =
      await import("../../electron/main/services/agentService");

    state.prompt.mockReset().mockImplementation(async () => {
      state.sessionListener?.({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          errorMessage: "模型调用失败",
        },
      });
      state.sessionListener?.({ type: "agent_end" });
    });

    const result = await agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session",
      requestId: "main-request-assistant-error",
      message: "测试模型失败透传",
    });

    expect(result.assistantMessage).toBe("处理失败：模型调用失败");
  });

  it("does not expose callMainAgent for delegated project sessions", async () => {
    const { createDelegationTools } =
      await import("../../electron/main/services/agentService");

    const tools = createDelegationTools({
      scope: { type: "project", projectId: "agent-a" },
      runtime: {
        chatSessionId: "session-1",
        delegationContext: {
          delegationId: "delegation-1",
          mainSessionId: "main-session",
          source: "main",
          projectId: "agent-a",
          projectName: "Agent A",
        },
        delegationReportState: { reported: false },
      },
    });

    expect(tools.find((item) => item.name === "callMainAgent")).toBeUndefined();
  });

  it("keeps an active main-agent request open for merged follow-up turns", async () => {
    const { agentService, deliverDelegationReportToMainAgent } =
      await import("../../electron/main/services/agentService");

    let releaseInitialTurn: (() => void) | undefined;
    state.prompt.mockImplementation(async () => {
      state.sessionListener?.({ type: "turn_start" });
      await new Promise<void>((resolve) => {
        releaseInitialTurn = resolve;
      });
      setTimeout(() => {
        state.sessionListener?.({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "主 Agent 初始回复",
          },
        });
        state.sessionListener?.({
          type: "turn_end",
          message: {
            role: "assistant",
          },
          toolResults: [],
        });
      }, 0);
    });
    state.followUp.mockImplementation(async () => {
      setTimeout(() => {
        state.sessionListener?.({ type: "turn_start" });
        state.sessionListener?.({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "，已合并子智能体 回报",
          },
        });
        state.sessionListener?.({
          type: "turn_end",
          message: {
            role: "assistant",
          },
          toolResults: [],
        });
        state.sessionListener?.({ type: "agent_end" });
      }, 0);
    });

    const sendPromise = agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session",
      requestId: "main-request-1",
      message: "请处理并等待子智能体 回报",
    });

    await vi.waitFor(() => {
      expect(state.prompt).toHaveBeenCalledTimes(1);
      expect(state.sessionListener).toBeTypeOf("function");
    });

    await deliverDelegationReportToMainAgent({
      delegationContext: {
        delegationId: "delegation-1",
        mainSessionId: "main-session",
        source: "main",
        projectId: "agent-a",
        projectName: "Agent A",
      },
      sourceProjectId: "agent-a",
      sourceProjectName: "Agent A",
      status: "completed",
      result: "子智能体 已完成",
      delegationReportState: { reported: false },
    });

    releaseInitialTurn?.();

    const result = await sendPromise;

    expect(state.followUp).toHaveBeenCalledTimes(1);
    expect(state.followUp.mock.calls[0]?.[0]).toContain("子智能体 已完成");
    expect(result.assistantMessage).toContain("主 Agent 初始回复");
    expect(result.assistantMessage).toContain("已合并子智能体 回报");
  });

  it("retries main-agent processing without appending the report twice", async () => {
    const { deliverDelegationReportToMainAgent } =
      await import("../../electron/main/services/agentService");

    const delegationReportState = {
      reported: false,
      appendedReport: {
        status: "completed" as const,
        result: "这是首次写入的回报",
      },
    };

    await deliverDelegationReportToMainAgent({
      delegationContext: {
        delegationId: "delegation-1",
        mainSessionId: "main-session",
        source: "main",
        projectId: "agent-a",
        projectName: "Agent A",
      },
      sourceProjectId: "agent-a",
      sourceProjectName: "Agent A",
      status: "failed",
      result: "不应覆盖已写入的回报",
      delegationReportState,
    });

    expect(state.appendMessage).not.toHaveBeenCalled();
    expect(state.chatSend).toHaveBeenCalledTimes(1);
    expect(state.chatSend.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "main-session",
      requestId: "main-report-delegation-1",
    });
    expect(state.chatSend.mock.calls[0]?.[0].message).toContain(
      "这是首次写入的回报",
    );
    expect(state.chatSend.mock.calls[0]?.[0].message).not.toContain(
      "不应覆盖已写入的回报",
    );
    expect(delegationReportState.reported).toBe(true);
  });

  it("dispatches delegation tasks to sub agents without persisting a duplicate user message", async () => {
    state.listProjects.mockResolvedValue([
      {
        id: "agent-a",
        name: "Agent A",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    ]);

    const { createDelegationTools } =
      await import("../../electron/main/services/agentService");

    const [tool] = createDelegationTools({
      scope: { type: "main" },
      runtime: {
        chatSessionId: "main-session",
      },
    }).filter((item) => item.name === "callSubAgent");

    const result = await tool.handler({
      agent: "agent-a",
      module: "docs",
      task: "请整理 docs/summary.md",
    });

    expect(result.isError).toBeUndefined();
    expect(state.appendMessage).toHaveBeenCalledTimes(2);
    expect(state.appendMessage.mock.calls[0]?.[0]).toMatchObject({
      scope: { type: "project", projectId: "agent-a" },
      sessionId: "sub-session-1",
      role: "system",
      content: expect.stringContaining("委派编号："),
    });
    expect(state.appendMessage.mock.calls[1]?.[0]).toMatchObject({
      scope: { type: "main" },
      sessionId: "main-session",
      role: "system",
      content: "已委派给：**Agent A**",
      metadataJson: expect.stringContaining('"kind":"delegation_receipt"'),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.chatSend).toHaveBeenCalledTimes(1);
    expect(state.chatSend.mock.calls[0]?.[0]).toMatchObject({
      scope: { type: "project", projectId: "agent-a" },
      module: "docs",
      sessionId: "sub-session-1",
      skipUserMessagePersistence: true,
      delegationContext: expect.objectContaining({
        projectId: "agent-a",
        projectName: "Agent A",
      }),
    });
  });

  it("reuses the same delegated sub-agent session within one main session", async () => {
    state.listProjects.mockResolvedValue([
      {
        id: "agent-a",
        name: "Agent A",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    ]);
    state.listMessages
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "msg-1",
          sessionId: "main-session",
          role: "system",
          content: "已委派给：**Agent A**",
          metadataJson: JSON.stringify({
            kind: "delegation_receipt",
            delegationId: "delegation-1",
            targetProjectId: "agent-a",
            targetProjectName: "Agent A",
            targetSessionId: "sub-session-1",
          }),
          createdAt: "2026-03-09T10:00:00.000Z",
        },
      ]);
    state.getChatSession.mockResolvedValue({
      id: "sub-session-1",
      scopeType: "project",
      projectId: "agent-a",
      module: "docs",
      title: "Agent A Agent 会话",
      sdkSessionId: null,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
    });

    const { createDelegationTools } =
      await import("../../electron/main/services/agentService");

    const [tool] = createDelegationTools({
      scope: { type: "main" },
      runtime: {
        chatSessionId: "main-session",
      },
    }).filter((item) => item.name === "callSubAgent");

    await tool.handler({
      agent: "agent-a",
      module: "docs",
      task: "第一次委派",
    });
    await tool.handler({
      agent: "agent-a",
      module: "docs",
      task: "第二次委派",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.createChatSession).toHaveBeenCalledTimes(1);
    expect(state.getChatSession).toHaveBeenCalledWith(
      { type: "project", projectId: "agent-a" },
      "sub-session-1",
    );
    expect(state.chatSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        scope: { type: "project", projectId: "agent-a" },
        sessionId: "sub-session-1",
        message: "第二次委派",
      }),
      expect.any(Function),
    );
  });

  it("sends delegated task context as a custom sdk message instead of a user prompt", async () => {
    const { agentService } =
      await import("../../electron/main/services/agentService");

    await agentService.send({
      scope: { type: "project", projectId: "agent-a" },
      module: "docs",
      sessionId: "sub-session-1",
      message: "请整理 docs/summary.md",
      delegationContext: {
        delegationId: "delegation-1",
        mainSessionId: "main-session",
        source: "main",
        projectId: "agent-a",
        projectName: "Agent A",
      },
      skipUserMessagePersistence: true,
    });

    expect(state.sendCustomMessage).toHaveBeenCalledTimes(1);
    expect(state.prompt).not.toHaveBeenCalled();
    expect(state.sendUserMessage).not.toHaveBeenCalled();
    expect(state.sendCustomMessage.mock.calls[0]?.[0]).toMatchObject({
      customType: "delegation_task",
      display: false,
      content: expect.stringContaining("委派编号：delegation-1"),
    });
    expect(state.sendCustomMessage.mock.calls[0]?.[1]).toEqual({
      triggerTurn: true,
    });
  });

  it("logs the final system prompt as rendered markdown in development mode", async () => {
    const { logger } = await import("../../electron/main/services/logger");
    const mockedLoggerInfo = vi.mocked(logger.info);
    mockedLoggerInfo.mockClear();

    state.getAgentSystemPrompt
      .mockReset()
      .mockResolvedValue("# 标题\n\n- 条目 A");
    state.buildSessionSystemPrompt
      .mockReset()
      .mockImplementation((prompt) => `${prompt}\n\n## 扩展\n内容`);
    state.prompt.mockReset().mockImplementation(async () => {
      state.sessionListener?.({ type: "agent_end" });
    });

    const { agentService } =
      await import("../../electron/main/services/agentService");

    await agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session",
      requestId: "main-request-system-prompt-log",
      message: "测试开发环境 system prompt 日志",
    });

    expect(mockedLoggerInfo).toHaveBeenCalledWith(
      "Final system prompt metadata (development)",
      {
        scope: "main-agent",
        chatSessionId: "main-session",
      },
    );

    const markdownLog = mockedLoggerInfo.mock.calls.find(
      ([message]) =>
        typeof message === "string" &&
        message.includes("Final system prompt Markdown (development)"),
    );

    expect(markdownLog?.[0]).toContain(
      "Final system prompt Markdown (development)\n\n# 标题\n\n- 条目 A",
    );
    expect(markdownLog?.[0]).toContain("## 扩展\n内容");
  });

  it("passes global config dir and build version into runtime environment section", async () => {
    state.buildSessionSystemPrompt.mockReset().mockImplementation((prompt) => prompt);
    state.prompt.mockReset().mockImplementation(async () => {
      state.sessionListener?.({ type: "agent_end" });
    });

    const { agentService } =
      await import("../../electron/main/services/agentService");

    await agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session-runtime-env",
      requestId: "main-request-runtime-env",
      message: "测试运行环境字段",
    });

    expect(state.buildSessionSystemPrompt).toHaveBeenCalledWith(
      "system prompt",
      expect.objectContaining({
        runtimeEnvironmentSection: expect.stringContaining(
          `- 全局配置目录（<GlobalConfigDir>）：${path.join(state.workspaceRoot, ".global")}`,
        ),
      }),
    );
    expect(state.buildSessionSystemPrompt).toHaveBeenCalledWith(
      "system prompt",
      expect.objectContaining({
        runtimeEnvironmentSection: expect.stringContaining(
          "- 当前构建版本：dev build",
        ),
      }),
    );
  });

  it("refreshes runtime sessions without dropping persisted history after the current turn", async () => {
    const continuedSessionManager = {
      buildSessionContext: () => ({
        model: {
          provider: "anthropic",
          modelId: "claude-test",
        },
      }),
    };
    state.continueRecent.mockReset().mockReturnValue(continuedSessionManager);
    state.createSessionManager.mockReset().mockReturnValue({
      buildSessionContext: () => ({ model: null }),
    });

    const { agentService } =
      await import("../../electron/main/services/agentService");

    let promptCount = 0;
    state.prompt.mockReset().mockImplementation(async () => {
      promptCount += 1;
      if (promptCount === 1) {
        agentService.refreshAllSessionsForNextPrompt();
      }
      state.sessionListener?.({ type: "agent_end" });
    });
    state.setChatSessionSdkSessionId.mockClear();

    await agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session",
      requestId: "main-request-before-settings-reload",
      message: "第一轮对话",
    });

    await agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session",
      requestId: "main-request-after-settings-reload",
      message: "继续刚才的话题",
    });

    expect(state.createAgentSession).toHaveBeenCalledTimes(2);
    expect(state.continueRecent).toHaveBeenCalledTimes(2);
    expect(state.createSessionManager).not.toHaveBeenCalled();
    expect(state.setChatSessionSdkSessionId).toHaveBeenCalledTimes(2);
    expect(state.setChatSessionSdkSessionId).toHaveBeenNthCalledWith(1, {
      scope: { type: "main" },
      sessionId: "main-session",
      sdkSessionId: "sdk-session-1",
    });
    expect(state.setChatSessionSdkSessionId).toHaveBeenNthCalledWith(2, {
      scope: { type: "main" },
      sessionId: "main-session",
      sdkSessionId: "sdk-session-1",
    });
  });

  it("reuses delegated sessions and auto reports the latest output", async () => {
    const { agentService } =
      await import("../../electron/main/services/agentService");

    await agentService.send({
      scope: { type: "project", projectId: "agent-a" },
      module: "docs",
      sessionId: "sub-session-1",
      message: "第一次委派",
      delegationContext: {
        delegationId: "delegation-1",
        mainSessionId: "main-session",
        source: "main",
        projectId: "agent-a",
        projectName: "Agent A",
      },
      skipUserMessagePersistence: true,
    });

    state.appendMessage.mockClear();
    state.chatSend.mockClear();
    state.sendCustomMessage.mockReset().mockImplementation(async () => {
      state.sendCustomMessageCallCount += 1;
      state.sessionListener?.({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "第二次委派已正常回报",
        },
      });
      state.sessionListener?.({ type: "agent_end" });
    });

    await agentService.send({
      scope: { type: "project", projectId: "agent-a" },
      module: "docs",
      sessionId: "sub-session-1",
      message: "第二次委派",
      delegationContext: {
        delegationId: "delegation-2",
        mainSessionId: "main-session",
        source: "main",
        projectId: "agent-a",
        projectName: "Agent A",
      },
      skipUserMessagePersistence: true,
    });

    expect(state.createAgentSession).toHaveBeenCalledTimes(1);
    expect(state.appendMessage).toHaveBeenCalledTimes(1);
    expect(state.appendMessage.mock.calls[0]?.[0]).toMatchObject({
      scope: { type: "main" },
      sessionId: "main-session",
      metadataJson: expect.stringContaining('"delegationId":"delegation-2"'),
    });
    expect(state.chatSend).toHaveBeenCalledTimes(1);
    expect(state.chatSend.mock.calls[0]?.[0].message).toContain(
      "第二次委派已正常回报",
    );
    expect(state.chatSend.mock.calls[0]?.[0].message).not.toContain(
      "子智能体 的结果已自动回报给主 Agent",
    );
  });

  it("keeps persisted session context when switching models", async () => {
    const continuedSessionManager = {
      buildSessionContext: () => ({
        model: {
          provider: "anthropic",
          modelId: "claude-old",
        },
      }),
    };
    state.continueRecent.mockReset().mockReturnValue(continuedSessionManager);
    state.createSessionManager.mockReset().mockReturnValue({
      buildSessionContext: () => ({ model: null }),
    });
    state.getClaudeStatus.mockReset().mockResolvedValue({
      allEnabledModels: [{ provider: "openai", modelId: "gpt-5" }],
      providers: {
        anthropic: {
          apiKey: "anthropic-key",
        },
        openai: {
          apiKey: "openai-key",
        },
      },
    });
    state.resolveAgentModel.mockReset().mockResolvedValue({
      provider: "openai",
      id: "gpt-5",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      name: "GPT-5",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    });
    state.prompt.mockReset().mockImplementation(async () => {
      state.sessionListener?.({ type: "agent_end" });
    });

    const { agentService } =
      await import("../../electron/main/services/agentService");

    await agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session",
      requestId: "main-request-model-switch",
      message: "继续当前会话",
      model: "openai:gpt-5",
    });

    expect(state.continueRecent).toHaveBeenCalledTimes(1);
    expect(state.createSessionManager).not.toHaveBeenCalled();
    expect(state.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionManager: continuedSessionManager,
      }),
    );
  });

  it("rebuilds a reused session when the resolved model runtime config changes", async () => {
    const oldRuntimeModel = {
      provider: "custom-api",
      id: "qwen3.5-small-9b",
      api: "openai-completions",
      baseUrl: "http://localhost:2276/v1/chat",
      name: "Qwen",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
      compat: { supportsDeveloperRole: false },
    };
    const newRuntimeModel = {
      ...oldRuntimeModel,
      baseUrl: "http://localhost:2276/v1",
    };
    state.resolveAgentModel.mockReset().mockImplementation(async () => {
      const callIndex = state.resolveAgentModel.mock.calls.length;
      return callIndex <= 2 ? oldRuntimeModel : newRuntimeModel;
    });
    state.getClaudeStatus.mockReset().mockResolvedValue({
      allEnabledModels: [{ provider: "custom-api", modelId: "qwen3.5-small-9b" }],
      providers: {
        "custom-api": {
          apiKey: "test-key",
        },
      },
    });
    state.prompt.mockReset().mockImplementation(async () => {
      state.sessionListener?.({ type: "agent_end" });
    });

    const { agentService } =
      await import("../../electron/main/services/agentService");

    await agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session",
      requestId: "main-request-old-runtime",
      message: "first",
      model: "custom-api:qwen3.5-small-9b",
    });

    await agentService.send({
      scope: { type: "main" },
      module: "main",
      sessionId: "main-session",
      requestId: "main-request-new-runtime",
      message: "second",
      model: "custom-api:qwen3.5-small-9b",
    });

    expect(state.createAgentSession).toHaveBeenCalledTimes(2);
  });

  it("uses the scope-specific saved model when no payload model is provided", async () => {
    state.getClaudeStatus.mockReset().mockResolvedValue({
      allEnabledModels: [{ provider: "anthropic", modelId: "claude-test" }],
      providers: {
        anthropic: {
          apiKey: "anthropic-key",
        },
        openai: {
          apiKey: "openai-key",
        },
      },
      lastSelectedModel: "openai:gpt-5-mini",
      lastSelectedThinkingLevel: "high",
    });
    state.resolveAgentModel.mockReset().mockResolvedValue({
      provider: "openai",
      id: "gpt-5-mini",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      name: "GPT-5 Mini",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    });
    state.prompt.mockReset().mockImplementation(async () => {
      state.sessionListener?.({ type: "agent_end" });
    });

    const { agentService } =
      await import("../../electron/main/services/agentService");

    await agentService.send({
      scope: { type: "project", projectId: "agent-a" },
      module: "docs",
      sessionId: "sub-session-saved-model",
      requestId: "sub-request-saved-model",
      message: "继续处理这个任务",
    });

    expect(state.getClaudeStatus).toHaveBeenCalledWith({
      type: "project",
      projectId: "agent-a",
    });
    expect(state.resolveAgentModel).toHaveBeenCalledWith(
      "openai",
      "gpt-5-mini",
    );
  });

  it("uses the current chat scope for send preflight model resolution", async () => {
    state.getClaudeStatus.mockReset().mockImplementation(async (scope) => {
      if (
        scope &&
        typeof scope === "object" &&
        "type" in scope &&
        scope.type === "project"
      ) {
        return {
          allEnabledModels: [{ provider: "openai", modelId: "gpt-5-mini" }],
          providers: {
            openai: {
              apiKey: "openai-key",
            },
          },
          lastSelectedModel: "openai:gpt-5-mini",
          lastSelectedThinkingLevel: "high",
        };
      }

      return {
        allEnabledModels: [{ provider: "custom-api", modelId: "missing-model" }],
        providers: {
          "custom-api": {
            apiKey: "custom-api-key",
          },
        },
        lastSelectedModel: "custom-api:missing-model",
        lastSelectedThinkingLevel: "high",
      };
    });
    state.resolveAgentModel.mockReset().mockImplementation(async (provider, modelId) => {
      if (provider === "openai" && modelId === "gpt-5-mini") {
        return {
          provider: "openai",
          id: "gpt-5-mini",
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          name: "GPT-5 Mini",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: 8192,
        };
      }
      return null;
    });
    state.prompt.mockReset().mockImplementation(async () => {
      state.sessionListener?.({ type: "agent_end" });
    });

    const { agentService } =
      await import("../../electron/main/services/agentService");

    await expect(
      agentService.send({
        scope: { type: "project", projectId: "agent-a" },
        module: "docs",
        sessionId: "sub-session-scope-preflight",
        requestId: "sub-request-scope-preflight",
        message: "继续处理这个任务",
      }),
    ).resolves.toMatchObject({
      assistantMessage: "已处理请求，但未收到 Agent 文本回复。",
    });

    expect(state.getClaudeStatus).toHaveBeenNthCalledWith(1, {
      type: "project",
      projectId: "agent-a",
    });
    expect(state.resolveAgentModel).toHaveBeenCalledWith(
      "openai",
      "gpt-5-mini",
    );
  });
});
