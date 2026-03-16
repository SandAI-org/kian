import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SHORTCUT_CONFIG } from "../../src/shared/utils/shortcuts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appPath: "",
  workspaceRoot: "",
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: () => state.appPath,
  },
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

describe("settingsService.getAgentSystemPrompt", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kian-settings-service-"));
    state.appPath = tempRoot;
    state.workspaceRoot = tempRoot;
    await fs.mkdir(path.join(tempRoot, ".kian"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "default-system-prompt.md"),
      "sub-agent prompt",
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, "default-main-system-prompt.md"),
      "main-agent prompt",
      "utf8",
    );
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("loads different bundled prompt templates for main and project agents", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await expect(settingsService.getAgentSystemPrompt("main")).resolves.toBe(
      "main-agent prompt",
    );
    await expect(settingsService.getAgentSystemPrompt("project")).resolves.toBe(
      "sub-agent prompt",
    );
  });

  it("returns default shortcut config when settings file has no shortcut section", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await expect(settingsService.getShortcutConfig()).resolves.toEqual(
      DEFAULT_SHORTCUT_CONFIG,
    );
  });

  it("persists custom shortcut config", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    const customShortcutConfig = {
      sendMessage: {
        code: "NumpadEnter",
        key: "Enter",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      insertNewline: {
        code: "Enter",
        key: "Enter",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      focusMainAgentInput: {
        code: "KeyK",
        key: "k",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      },
      openSettingsPage: {
        code: "Comma",
        key: ",",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      newChatSession: {
        code: "KeyN",
        key: "n",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      quickLauncher: {
        code: "KeyK",
        key: "k",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      },
    };

    await settingsService.saveShortcutConfig(customShortcutConfig);
    await expect(settingsService.getShortcutConfig()).resolves.toEqual(
      customShortcutConfig,
    );
  });

  it("fills missing shortcut entries with defaults", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".kian", "settings.json"),
      JSON.stringify(
        {
          providers: [],
          mediaProviders: [],
          shortcuts: {
            sendMessage: {
              code: "Enter",
              key: "Enter",
              metaKey: false,
              ctrlKey: false,
              altKey: false,
              shiftKey: false,
            },
            insertNewline: {
              code: "Enter",
              key: "Enter",
              metaKey: false,
              ctrlKey: false,
              altKey: false,
              shiftKey: true,
            },
            focusMainAgentInput: {
              code: "KeyK",
              key: "k",
              metaKey: true,
              ctrlKey: false,
              altKey: false,
              shiftKey: false,
            },
          },
          mcpServers: [],
          chatChannels: {
            telegram: {
              enabled: false,
              botToken: "",
              userIds: [],
              lastUpdateId: 0,
            },
            discord: {
              enabled: false,
              botToken: "",
              serverIds: [],
              channelIds: [],
            },
            feishu: {
              enabled: false,
              userIds: [],
              appId: "",
              appSecret: "",
            },
            broadcastChannels: [],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await expect(settingsService.getShortcutConfig()).resolves.toEqual({
      sendMessage: {
        code: "Enter",
        key: "Enter",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      insertNewline: {
        code: "Enter",
        key: "Enter",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      },
      focusMainAgentInput: {
        code: "KeyK",
        key: "k",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      openSettingsPage: DEFAULT_SHORTCUT_CONFIG.openSettingsPage,
      newChatSession: DEFAULT_SHORTCUT_CONFIG.newChatSession,
      quickLauncher: DEFAULT_SHORTCUT_CONFIG.quickLauncher,
    });
  });

  it("stores global dismiss flags alongside workspaceRoot", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await settingsService.saveGeneralConfig({
      workspaceRoot: "/tmp/next-workspace",
      language: "en-US",
      linkOpenMode: "system",
      mainSubModeEnabled: true,
      quickGuideDismissed: true,
      chatInputShortcutTipDismissed: true,
    });

    await expect(
      fs.readFile(path.join(tempRoot, ".global", "config.json"), "utf8"),
    ).resolves.toBe(
      '{\n  "workspaceRoot": "/tmp/next-workspace",\n  "language": "en-US",\n  "linkOpenMode": "system",\n  "quickGuideDismissed": true,\n  "chatInputShortcutTipDismissed": true\n}\n',
    );
  });

  it("hydrates missing global dismiss flags from legacy config", async () => {
    await fs.mkdir(path.join(tempRoot, ".global"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, ".global", "config.json"),
      JSON.stringify(
        {
          workspaceRoot: "/tmp/legacy-workspace",
        },
        null,
        2,
      ),
      "utf8",
    );

    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await expect(settingsService.getGeneralConfig()).resolves.toEqual({
      workspaceRoot: "/tmp/legacy-workspace",
      language: "zh-CN",
      linkOpenMode: "builtin",
      mainSubModeEnabled: true,
      quickGuideDismissed: false,
      chatInputShortcutTipDismissed: false,
    });
  });

  it("migrates legacy workspace settings.json into .kian/settings.json", async () => {
    await fs.writeFile(
      path.join(tempRoot, "settings.json"),
      JSON.stringify(
        {
          defaultProvider: "openrouter",
          defaultModel: "google/gemini-3.1-pro-preview",
        },
        null,
        2,
      ),
      "utf8",
    );

    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await expect(settingsService.getClaudeStatus()).resolves.toMatchObject({
      lastSelectedModel: "openrouter:google/gemini-3.1-pro-preview",
    });
    await expect(
      fs.readFile(path.join(tempRoot, ".kian", "settings.json"), "utf8"),
    ).resolves.toContain(
      '"lastSelectedModel": "openrouter:google/gemini-3.1-pro-preview"',
    );
    await expect(fs.stat(path.join(tempRoot, "settings.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("hydrates missing lastSelectedModel from legacy workspace settings.json", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".kian", "settings.json"),
      JSON.stringify(
        {
          providers: [],
          mediaProviders: [],
          shortcuts: DEFAULT_SHORTCUT_CONFIG,
          mcpServers: [],
          chatChannels: {
            telegram: {
              enabled: false,
              botToken: "",
              userIds: [],
              lastUpdateId: 0,
            },
            discord: {
              enabled: false,
              botToken: "",
              serverIds: [],
              channelIds: [],
            },
            feishu: {
              enabled: false,
              userIds: [],
              appId: "",
              appSecret: "",
            },
            broadcastChannels: [],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, "settings.json"),
      JSON.stringify(
        {
          defaultProvider: "openrouter",
          defaultModel: "google/gemini-3.1-pro-preview",
        },
        null,
        2,
      ),
      "utf8",
    );

    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await expect(settingsService.getClaudeStatus()).resolves.toMatchObject({
      lastSelectedModel: "openrouter:google/gemini-3.1-pro-preview",
    });
    await expect(fs.stat(path.join(tempRoot, "settings.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
