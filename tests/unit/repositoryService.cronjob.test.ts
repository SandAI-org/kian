import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspaceRoot: "",
  systemPrompt: "# test prompt\n",
}));

vi.mock("../../electron/main/services/workspacePaths", () => ({
  get WORKSPACE_ROOT() {
    return state.workspaceRoot;
  },
  get INTERNAL_ROOT() {
    return path.join(state.workspaceRoot, ".kian");
  },
  get GLOBAL_CONFIG_DIR() {
    return path.join(state.workspaceRoot, ".global");
  },
  get GLOBAL_CONFIG_PATH() {
    return path.join(state.workspaceRoot, ".global", "config.json");
  },
}));

vi.mock("../../electron/main/services/settingsService", () => ({
  settingsService: {
    getAgentSystemPrompt: vi.fn(async () => state.systemPrompt),
  },
}));

describe("repositoryService cronjob", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kian-cronjob-repo-"));
    state.workspaceRoot = tempRoot;
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("lists cron jobs with target agent info and keeps legacy payload compatibility", async () => {
    const { repositoryService } =
      await import("../../electron/main/services/repositoryService");
    const agent = await repositoryService.createProject({
      name: "阿青",
    });

    await fs.writeFile(
      path.join(tempRoot, "cronjob.json"),
      JSON.stringify(
        [
          {
            cron: "0 9 * * *",
            content: "主 Agent 执行",
            status: "active",
          },
          {
            cron: "0 10 * * *",
            content: "子智能体 执行",
            status: "active",
            targetAgentId: agent.id,
          },
          {
            cron: "0 11 * * *",
            content: "兼容旧字段",
            status: "paused",
            projectId: agent.id,
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const jobs = await repositoryService.listCronJobs();

    expect(jobs).toEqual([
      expect.objectContaining({
        id: "cronjob-1",
        targetAgentId: null,
        targetAgentName: null,
      }),
      expect.objectContaining({
        id: "cronjob-2",
        targetAgentId: agent.id,
        targetAgentName: "阿青",
      }),
      expect.objectContaining({
        id: "cronjob-3",
        targetAgentId: agent.id,
        targetAgentName: "阿青",
      }),
    ]);
  });

  it("setCronJobStatus preserves targetAgentId metadata", async () => {
    const { repositoryService } =
      await import("../../electron/main/services/repositoryService");
    const agent = await repositoryService.createProject({
      name: "小白",
    });

    await fs.writeFile(
      path.join(tempRoot, "cronjob.json"),
      JSON.stringify(
        [
          {
            cron: "*/15 * * * *",
            content: "保留目标 Agent",
            status: "paused",
            targetAgentId: agent.id,
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const updated = await repositoryService.setCronJobStatus({
      id: "cronjob-1",
      status: "active",
    });
    const persisted = JSON.parse(
      await fs.readFile(path.join(tempRoot, "cronjob.json"), "utf8"),
    ) as Array<Record<string, unknown>>;

    expect(updated).toMatchObject({
      id: "cronjob-1",
      status: "active",
      targetAgentId: agent.id,
      targetAgentName: "小白",
    });
    expect(persisted[0]).toMatchObject({
      status: "active",
      targetAgentId: agent.id,
    });
  });

  it("includes the latest execution feedback on cron job cards", async () => {
    const { repositoryService } =
      await import("../../electron/main/services/repositoryService");

    await fs.writeFile(
      path.join(tempRoot, "cronjob.json"),
      JSON.stringify(
        [
          {
            cron: "26 17 21 5 *",
            content: "创建提醒文件",
            status: "active",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    await repositoryService.logCronJobExecution({
      executedAt: "2026-05-21T09:25:00.000Z",
      jobId: "cronjob-1",
      cron: "26 17 21 5 *",
      content: "创建提醒文件",
      status: "failed",
      error: "first failure",
    });
    await repositoryService.logCronJobExecution({
      executedAt: "2026-05-21T09:26:00.000Z",
      jobId: "cronjob-1",
      cron: "26 17 21 5 *",
      content: "创建提醒文件",
      status: "dispatched",
      sessionId: "session-cron",
      assistantMessage: "文件已创建",
    });

    const jobs = await repositoryService.listCronJobs();

    expect(jobs[0]).toMatchObject({
      id: "cronjob-1",
      lastExecution: {
        executedAt: "2026-05-21T09:26:00.000Z",
        status: "dispatched",
        sessionId: "session-cron",
        assistantMessage: "文件已创建",
      },
    });
  });
});
