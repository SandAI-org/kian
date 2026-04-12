import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspaceRoot: "",
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

describe("skillService active visibility", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kian-skill-service-"));
    state.workspaceRoot = tempRoot;

    const projectId = "p-2026-03-09-1";
    await fs.mkdir(path.join(tempRoot, projectId), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, projectId, "project.json"),
      JSON.stringify(
        {
          id: projectId,
          name: "Demo Project",
          createdAt: "2026-03-09T00:00:00.000Z",
          updatedAt: "2026-03-09T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("filters active skills directly from installed skill visibility", async () => {
    const { skillService } = await import(
      "../../electron/main/services/skillService"
    );

    await skillService.syncBuiltinSkillsOnStartup();
    const installed = await skillService.listInstalledSkills();
    expect(installed.length).toBeGreaterThan(0);

    const target = installed.find(
      (skill) => skill.mainAgentVisible && skill.projectAgentVisible
    );
    expect(target).toBeDefined();
    if (!target) {
      throw new Error("missing visible skill for sync test");
    }
    const [mainSkillsBefore, projectSkillsBefore] = await Promise.all([
      skillService.listActiveSkillsForScope({ scope: "main" }),
      skillService.listActiveSkillsForScope({
        scope: "project",
        projectId: "p-2026-03-09-1",
      }),
    ]);
    expect(
      mainSkillsBefore.some((skill) => skill.skillFilePath === path.join(target.installPath, "SKILL.md")),
    ).toBe(true);
    expect(
      projectSkillsBefore.some((skill) => skill.skillFilePath === path.join(target.installPath, "SKILL.md")),
    ).toBe(true);
    await expect(
      fs.access(path.join(tempRoot, ".kian", "agent-resources")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    const updated = await skillService.updateInstalledSkillVisibility({
      skillId: target.id,
      mainAgentVisible: false,
      projectAgentVisible: true,
    });

    expect(updated.mainAgentVisible).toBe(false);
    expect(updated.projectAgentVisible).toBe(true);

    const [mainSkillsAfter, projectSkillsAfter] = await Promise.all([
      skillService.listActiveSkillsForScope({ scope: "main" }),
      skillService.listActiveSkillsForScope({
        scope: "project",
        projectId: "p-2026-03-09-1",
      }),
    ]);
    expect(
      mainSkillsAfter.some((skill) => skill.skillFilePath === path.join(target.installPath, "SKILL.md")),
    ).toBe(false);
    expect(
      projectSkillsAfter.some((skill) => skill.skillFilePath === path.join(target.installPath, "SKILL.md")),
    ).toBe(true);
  });

  it("applies builtin default visibility by skill name", async () => {
    const { skillService } = await import(
      "../../electron/main/services/skillService"
    );

    await skillService.syncBuiltinSkillsOnStartup();
    const installed = await skillService.listInstalledSkills();

    const expectedVisibility = new Map([
      ["html-ppt-creator", { mainAgentVisible: false, projectAgentVisible: true }],
      ["docs-manager", { mainAgentVisible: true, projectAgentVisible: true }],
      ["app-creator", { mainAgentVisible: false, projectAgentVisible: true }],
      ["video-creator", { mainAgentVisible: false, projectAgentVisible: true }],
      ["self-management", { mainAgentVisible: true, projectAgentVisible: false }],
      ["skill-management", { mainAgentVisible: true, projectAgentVisible: true }],
      ["task-manager", { mainAgentVisible: true, projectAgentVisible: true }],
      ["programer", { mainAgentVisible: true, projectAgentVisible: true }],
      ["cronjob-scheduler", { mainAgentVisible: true, projectAgentVisible: true }],
      ["browser", { mainAgentVisible: true, projectAgentVisible: true }],
    ]);

    for (const [skillName, visibility] of expectedVisibility) {
      const skill = installed.find((item) => item.name === skillName);
      expect(skill, `missing builtin skill ${skillName}`).toBeDefined();
      expect(skill).toMatchObject(visibility);
    }
  });

  it("preserves existing visibility in skill meta when syncing builtin skills", async () => {
    const { skillService } = await import(
      "../../electron/main/services/skillService"
    );

    await skillService.syncBuiltinSkillsOnStartup();
    const installed = await skillService.listInstalledSkills();
    const target = installed.find((skill) => skill.name === "app-creator");
    expect(target).toBeDefined();
    if (!target) {
      throw new Error("missing app-creator skill");
    }

    const metaPath = path.join(target.installPath, ".skill.json");
    const customVisibility = {
      mainAgentVisible: false,
      projectAgentVisible: true,
    };
    const rawBefore = await fs.readFile(metaPath, "utf8");
    const metaBefore = JSON.parse(rawBefore) as Record<string, unknown>;
    await fs.writeFile(
      metaPath,
      `${JSON.stringify({ ...metaBefore, ...customVisibility }, null, 2)}\n`,
      "utf8",
    );

    await skillService.syncBuiltinSkillsOnStartup();

    const rawAfter = await fs.readFile(metaPath, "utf8");
    const metaAfter = JSON.parse(rawAfter) as Record<string, unknown>;
    expect(metaAfter.mainAgentVisible).toBe(customVisibility.mainAgentVisible);
    expect(metaAfter.projectAgentVisible).toBe(customVisibility.projectAgentVisible);
  });

  it("backfills builtin default visibility when legacy installed meta misses visibility flags", async () => {
    const { skillService } = await import(
      "../../electron/main/services/skillService"
    );

    await skillService.syncBuiltinSkillsOnStartup();
    const installed = await skillService.listInstalledSkills();
    const target = installed.find((skill) => skill.name === "app-creator");
    expect(target).toBeDefined();
    if (!target) {
      throw new Error("missing app-creator skill");
    }

    const metaPath = path.join(target.installPath, ".skill.json");
    const rawBefore = await fs.readFile(metaPath, "utf8");
    const metaBefore = JSON.parse(rawBefore) as Record<string, unknown>;
    delete metaBefore.mainAgentVisible;
    delete metaBefore.projectAgentVisible;
    await fs.writeFile(
      metaPath,
      `${JSON.stringify(metaBefore, null, 2)}\n`,
      "utf8",
    );

    await skillService.syncBuiltinSkillsOnStartup();

    const rawAfter = await fs.readFile(metaPath, "utf8");
    const metaAfter = JSON.parse(rawAfter) as Record<string, unknown>;
    expect(metaAfter.mainAgentVisible).toBe(false);
    expect(metaAfter.projectAgentVisible).toBe(true);
  });

  it("removes installed builtin skill directories when the builtin skill no longer exists", async () => {
    const { skillService } = await import(
      "../../electron/main/services/skillService"
    );

    await skillService.syncBuiltinSkillsOnStartup();

    const staleSkillDir = path.join(tempRoot, ".kian", "skills", "installed", "legacy-builtin");
    await fs.mkdir(staleSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(staleSkillDir, "SKILL.md"),
      "# legacy-builtin\n\nremoved builtin skill\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(staleSkillDir, ".skill.json"),
      `${JSON.stringify(
        {
          id: "builtin://kian::legacy-builtin",
          name: "legacy-builtin",
          repositoryUrl: "builtin://kian",
          skillPath: "legacy-builtin",
          installedAt: "2026-03-09T00:00:00.000Z",
          mainAgentVisible: true,
          projectAgentVisible: true,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await skillService.syncBuiltinSkillsOnStartup();

    await expect(fs.access(staleSkillDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("lists the effective active skills from installed skill directories", async () => {
    const { skillService } = await import(
      "../../electron/main/services/skillService"
    );

    await skillService.syncBuiltinSkillsOnStartup();

    const [mainSkills, projectSkills] = await Promise.all([
      skillService.listActiveSkillsForScope({ scope: "main" }),
      skillService.listActiveSkillsForScope({
        scope: "project",
        projectId: "p-2026-03-09-1",
      }),
    ]);

    expect(mainSkills.length).toBeGreaterThan(0);
    expect(projectSkills.length).toBeGreaterThan(0);
    expect(mainSkills.some((skill) => skill.title === "programer")).toBe(
      true,
    );
    expect(
      projectSkills.some((skill) => skill.title === "programer"),
    ).toBe(true);
    expect(mainSkills.some((skill) => skill.title === "html-ppt-creator")).toBe(
      false,
    );
    expect(
      projectSkills.some((skill) => skill.title === "html-ppt-creator"),
    ).toBe(true);
    expect(
      mainSkills.some((skill) => skill.title === "self-management"),
    ).toBe(true);
    expect(
      projectSkills.some((skill) => skill.title === "self-management"),
    ).toBe(false);
    expect(
      mainSkills.some((skill) => skill.title === "skill-management"),
    ).toBe(true);
    expect(
      projectSkills.some((skill) => skill.title === "skill-management"),
    ).toBe(true);
    expect(
      mainSkills.every((skill) => skill.skillFilePath.includes(path.join(".kian", "skills", "installed"))),
    ).toBe(true);
  });

  it("loads active skill files with DefaultResourceLoader explicit skill paths", async () => {
    const { skillService } = await import(
      "../../electron/main/services/skillService"
    );

    await skillService.syncBuiltinSkillsOnStartup();

    const mainSkills = await skillService.listActiveSkillsForScope({
      scope: "main",
    });
    const loader = new DefaultResourceLoader({
      cwd: path.join(tempRoot, "p-2026-03-09-1"),
      agentDir: path.join(tempRoot, ".kian", "isolated-agent"),
      noSkills: true,
      additionalSkillPaths: mainSkills.map((skill) => skill.skillFilePath),
    });

    await loader.reload();

    const loadedSkills = loader.getSkills();
    expect(loadedSkills.diagnostics).toEqual([]);
    expect(loadedSkills.skills.some((skill) => skill.name === "programer")).toBe(
      true,
    );
    expect(
      loadedSkills.skills.some((skill) => skill.name === "html-ppt-creator"),
    ).toBe(false);
  });
});
