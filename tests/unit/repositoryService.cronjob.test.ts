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

  it("keeps basic cron job listing independent from execution logs", async () => {
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
    await fs.writeFile(
      path.join(tempRoot, "cronjob-log.jsonl"),
      "{not valid json}\n",
      "utf8",
    );

    const jobs = await repositoryService.listCronJobs();

    expect(jobs[0]).toMatchObject({
      id: "cronjob-1",
      cron: "26 17 21 5 *",
      content: "创建提醒文件",
      lastExecution: null,
    });
  });

  it("includes the latest matching execution feedback on cron job cards", async () => {
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
    await repositoryService.logCronJobExecution({
      executedAt: "2026-05-21T09:27:00.000Z",
      jobId: "cronjob-1",
      cron: "27 17 21 5 *",
      content: "另一个任务",
      status: "dispatched",
      sessionId: "session-other",
      assistantMessage: "不应匹配",
    });

    const jobs = await repositoryService.listCronJobsWithLastExecution();

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

  it("uses execution project metadata to disambiguate matching cron jobs", async () => {
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
            cron: "0 18 * * *",
            content: "整理日报",
            status: "active",
          },
          {
            cron: "0 18 * * *",
            content: "整理日报",
            status: "active",
            targetAgentId: agent.id,
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    await repositoryService.logCronJobExecution({
      executedAt: "2026-05-21T10:00:00.000Z",
      jobId: "cronjob-1",
      cron: "0 18 * * *",
      content: "整理日报",
      status: "dispatched",
      projectId: agent.id,
      projectName: "阿青",
      sessionId: "session-agent",
      assistantMessage: "日报已整理",
    });

    const jobs = await repositoryService.listCronJobsWithLastExecution();

    expect(jobs[0].lastExecution).toBeNull();
    expect(jobs[1]).toMatchObject({
      id: "cronjob-2",
      targetAgentId: agent.id,
      lastExecution: {
        executedAt: "2026-05-21T10:00:00.000Z",
        status: "dispatched",
        sessionId: "session-agent",
        assistantMessage: "日报已整理",
      },
    });
  });

  it("uses execution job IDs to disambiguate identical cron jobs", async () => {
    const { repositoryService } =
      await import("../../electron/main/services/repositoryService");

    await fs.writeFile(
      path.join(tempRoot, "cronjob.json"),
      JSON.stringify(
        [
          {
            cron: "0 18 * * *",
            content: "整理日报",
            status: "active",
          },
          {
            cron: "0 18 * * *",
            content: "整理日报",
            status: "active",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    await repositoryService.logCronJobExecution({
      executedAt: "2026-05-21T10:00:00.000Z",
      jobId: "cronjob-1",
      cron: "0 18 * * *",
      content: "整理日报",
      status: "dispatched",
      sessionId: "session-first",
      assistantMessage: "第一条任务完成",
    });
    await repositoryService.logCronJobExecution({
      executedAt: "2026-05-21T10:01:00.000Z",
      jobId: "cronjob-2",
      cron: "0 18 * * *",
      content: "整理日报",
      status: "dispatched",
      sessionId: "session-second",
      assistantMessage: "第二条任务完成",
    });

    const jobs = await repositoryService.listCronJobsWithLastExecution();

    expect(jobs[0]).toMatchObject({
      id: "cronjob-1",
      lastExecution: {
        sessionId: "session-first",
        assistantMessage: "第一条任务完成",
      },
    });
    expect(jobs[1]).toMatchObject({
      id: "cronjob-2",
      lastExecution: {
        sessionId: "session-second",
        assistantMessage: "第二条任务完成",
      },
    });
  });

  it("finds the latest matching execution beyond the recent log window", async () => {
    const { repositoryService } =
      await import("../../electron/main/services/repositoryService");

    await fs.writeFile(
      path.join(tempRoot, "cronjob.json"),
      JSON.stringify(
        [
          {
            cron: "0 9 * * *",
            content: "生成日报",
            status: "active",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    await repositoryService.logCronJobExecution({
      executedAt: "2026-05-21T09:00:00.000Z",
      jobId: "cronjob-1",
      cron: "0 9 * * *",
      content: "生成日报",
      status: "dispatched",
      sessionId: "session-report",
      assistantMessage: "日报已生成",
    });

    for (let index = 0; index < 220; index += 1) {
      await repositoryService.logCronJobExecution({
        executedAt: `2026-05-21T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
        jobId: "cronjob-2",
        cron: "0 10 * * *",
        content: `无关任务 ${index}`,
        status: "dispatched",
        sessionId: `session-other-${index}`,
      });
    }

    const jobs = await repositoryService.listCronJobsWithLastExecution();

    expect(jobs[0]).toMatchObject({
      lastExecution: {
        executedAt: "2026-05-21T09:00:00.000Z",
        status: "dispatched",
        sessionId: "session-report",
        assistantMessage: "日报已生成",
      },
    });
  });

  it("preserves multibyte cron log lines split across read chunks", async () => {
    const { repositoryService } =
      await import("../../electron/main/services/repositoryService");

    await fs.writeFile(
      path.join(tempRoot, "cronjob.json"),
      JSON.stringify(
        [
          {
            cron: "0 9 * * *",
            content: "生成日报",
            status: "active",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const matchingLine = `${JSON.stringify({
      executedAt: "2026-05-21T09:00:00.000Z",
      jobId: "cronjob-1",
      cron: "0 9 * * *",
      content: "生成日报",
      status: "dispatched",
      reason: null,
      error: null,
      project: {
        id: null,
        name: null,
      },
      sessionId: "session-report",
      assistantMessage: "日报已生成",
    })}\n`;
    const lineBytes = Buffer.byteLength(matchingLine, "utf8");
    const splitOffset =
      Buffer.byteLength(
        matchingLine.slice(0, matchingLine.indexOf("生成日报")),
        "utf8",
      ) + 1;
    const fillerLength = 256 * 1024 - lineBytes + splitOffset;

    await fs.writeFile(
      path.join(tempRoot, "cronjob-log.jsonl"),
      `${matchingLine}${" ".repeat(fillerLength - 1)}\n`,
      "utf8",
    );

    const jobs = await repositoryService.listCronJobsWithLastExecution();

    expect(jobs[0]).toMatchObject({
      lastExecution: {
        executedAt: "2026-05-21T09:00:00.000Z",
        status: "dispatched",
        sessionId: "session-report",
        assistantMessage: "日报已生成",
      },
    });
  });
});
