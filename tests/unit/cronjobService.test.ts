import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: {
    listCronJobs: vi.fn(),
    getProjectById: vi.fn(),
    listChatSessions: vi.fn(),
    createChatSession: vi.fn(),
    logCronJobExecution: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/chatService", () => ({
  chatService: {
    send: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/chatChannelService", () => ({
  chatChannelService: {
    createCronJobAssistantMirrorStreamer: vi.fn(),
  },
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

const flushAsyncWork = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
};

describe("cronjobService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches cron jobs to the target agent when targetAgentId is configured", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const { chatService } = await import("../../electron/main/services/chatService");
    const { chatChannelService } = await import(
      "../../electron/main/services/chatChannelService"
    );
    const { cronjobService } = await import(
      "../../electron/main/services/cronjobService"
    );

    const assistantMirrorStreamer = {
      pushEvent: vi.fn(),
      finalize: vi.fn(),
    };

    vi.mocked(repositoryService.listCronJobs).mockResolvedValue([
      {
        id: "cronjob-1",
        cron: "* * * * *",
        timeSummary: "每分钟",
        content: "整理日报",
        status: "active",
        targetAgentId: "agent-a",
        targetAgentName: "阿青",
      },
    ]);
    vi.mocked(repositoryService.getProjectById).mockResolvedValue({
      id: "agent-a",
      name: "阿青",
      description: "内容 Agent",
      cover: null,
      createdAt: "2026-03-10T08:00:00.000Z",
      updatedAt: "2026-03-10T08:00:00.000Z",
    });
    vi.mocked(repositoryService.listChatSessions).mockResolvedValue([]);
    vi.mocked(repositoryService.createChatSession).mockResolvedValue({
      id: "session-agent-a",
      scopeType: "project",
      projectId: "agent-a",
      module: "docs",
      kind: "normal",
      hidden: true,
      title: "",
      sdkSessionId: null,
      createdAt: "2026-03-10T09:00:00.000Z",
      updatedAt: "2026-03-10T09:00:00.000Z",
    });
    vi.mocked(chatChannelService.createCronJobAssistantMirrorStreamer).mockReturnValue(
      assistantMirrorStreamer,
    );
    vi.mocked(chatService.send).mockResolvedValue({
      assistantMessage: "已完成",
      toolActions: ["调用了工具"],
    });

    cronjobService.start();
    await flushAsyncWork();
    cronjobService.stop();

    expect(repositoryService.listChatSessions).not.toHaveBeenCalled();
    expect(repositoryService.createChatSession).toHaveBeenCalledWith({
      scope: {
        type: "project",
        projectId: "agent-a",
      },
      module: "docs",
      title: "",
      hidden: true,
    });
    expect(chatService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          type: "project",
          projectId: "agent-a",
        },
        module: "docs",
        sessionId: "session-agent-a",
        message: "整理日报",
      }),
    );
    expect(assistantMirrorStreamer.pushEvent).not.toHaveBeenCalled();
    expect(assistantMirrorStreamer.finalize).toHaveBeenCalledWith({
      fallbackAssistantMessage: "已完成",
    });
    expect(repositoryService.logCronJobExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "cronjob-1",
        status: "dispatched",
        projectId: "agent-a",
        projectName: "阿青",
        sessionId: "session-agent-a",
        assistantMessage: "已完成",
      }),
    );
  });

  it("falls back to the main agent when targetAgentId is missing or invalid", async () => {
    const { repositoryService } = await import(
      "../../electron/main/services/repositoryService"
    );
    const { chatService } = await import("../../electron/main/services/chatService");
    const { chatChannelService } = await import(
      "../../electron/main/services/chatChannelService"
    );
    const { cronjobService } = await import(
      "../../electron/main/services/cronjobService"
    );

    const assistantMirrorStreamer = {
      pushEvent: vi.fn(),
      finalize: vi.fn(),
    };

    vi.mocked(repositoryService.listCronJobs).mockResolvedValue([
      {
        id: "cronjob-1",
        cron: "* * * * *",
        timeSummary: "每分钟",
        content: "汇总看板",
        status: "active",
        targetAgentId: "missing-agent",
      },
    ]);
    vi.mocked(repositoryService.getProjectById).mockResolvedValue(null);
    vi.mocked(repositoryService.createChatSession).mockResolvedValue({
      id: "session-main",
      scopeType: "main",
      module: "main",
      kind: "normal",
      hidden: true,
      title: "",
      sdkSessionId: null,
      createdAt: "2026-03-10T09:00:00.000Z",
      updatedAt: "2026-03-10T09:00:00.000Z",
    });
    vi.mocked(chatChannelService.createCronJobAssistantMirrorStreamer).mockReturnValue(
      assistantMirrorStreamer,
    );
    vi.mocked(chatService.send).mockResolvedValue({
      assistantMessage: "已完成",
      toolActions: [],
    });

    cronjobService.start();
    await flushAsyncWork();
    cronjobService.stop();

    expect(repositoryService.listChatSessions).not.toHaveBeenCalled();
    expect(repositoryService.createChatSession).toHaveBeenCalledWith({
      scope: {
        type: "main",
      },
      module: "main",
      title: "",
      hidden: true,
    });
    expect(chatService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          type: "main",
        },
        module: "main",
        sessionId: "session-main",
        message: "汇总看板",
      }),
    );
    expect(assistantMirrorStreamer.pushEvent).not.toHaveBeenCalled();
    expect(assistantMirrorStreamer.finalize).toHaveBeenCalledWith({
      fallbackAssistantMessage: "已完成",
    });
    expect(repositoryService.logCronJobExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "cronjob-1",
        status: "dispatched",
        projectId: "main-agent",
        projectName: "主 Agent",
        sessionId: "session-main",
        assistantMessage: "已完成",
      }),
    );
  });
});
