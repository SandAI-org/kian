import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspaceRoot: "",
}));

vi.mock("../../electron/main/services/workspacePaths", () => ({
  get WORKSPACE_ROOT() {
    return state.workspaceRoot;
  },
}));

describe("taskService task directory scanning", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kian-task-service-"));
    state.workspaceRoot = tempRoot;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats a missing tasks directory as no active tasks", async () => {
    const readdirSpy = vi.spyOn(fs, "readdir").mockImplementation((async (targetPath) => {
      if (String(targetPath).endsWith(path.join(".tasks"))) {
        const error = Object.assign(new Error("ENOENT: no such file or directory, scandir"), {
          code: "ENOENT",
        });
        throw error;
      }
      return [];
    }) as typeof fs.readdir);

    const { taskService } = await import("../../electron/main/services/taskService");

    await expect(taskService.listActiveTasks()).resolves.toEqual([]);
    await expect(taskService.shutdownRunningTasks()).resolves.toBeUndefined();
    expect(readdirSpy).toHaveBeenCalled();
  });
});
