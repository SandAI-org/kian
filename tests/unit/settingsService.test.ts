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
    await fs.writeFile(
      path.join(tempRoot, "default-avatar-system-prompt.md"),
      "avatar-agent prompt",
      "utf8",
    );
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refreshes one provider, shares enabled models and restores the catalog offline", async () => {
    const { settingsService } = await import("../../electron/main/services/settingsService");
    const { getSharedModelRuntime } = await import("../../electron/main/services/authStorageService");
    const runtime = await getSharedModelRuntime();
    const model = { ...runtime.getModel("openai", "gpt-4o")!, id: "catalog-new-model", name: "Catalog New Model" };
    const request = vi.fn(async (_input: unknown, _init?: unknown) => new Response(JSON.stringify([model]), {
      headers: { "content-type": "application/json", "last-modified": "Thu, 01 Jan 2099 00:00:00 GMT" },
    }));
    vi.stubGlobal("fetch", request);
    try {
      await settingsService.saveClaudeConfig({
        provider: "openai", enabled: true, secret: "catalog-test-key", customModels: [], enabledModels: [],
      });
      expect((await settingsService.getAvailableModels("openai")).some((item) => item.id === model.id)).toBe(false);
      expect(request).not.toHaveBeenCalled();
      expect(await settingsService.refreshAvailableModels("openai")).toContainEqual(expect.objectContaining({ id: model.id }));
      expect(request).toHaveBeenCalledTimes(1);
      expect(String(request.mock.calls[0][0])).toContain("/api/models/providers/openai?");
      expect(JSON.stringify(request.mock.calls)).not.toContain("catalog-test-key");
      await settingsService.saveClaudeConfig({
        provider: "openai", enabled: true, customModels: [], enabledModels: [model.id],
      });
      const main = await settingsService.getClaudeStatus({ type: "main" }, "session-a");
      const other = await settingsService.getClaudeStatus({ type: "project", projectId: "agent-b" }, "session-b");
      expect(main.allEnabledModels).toEqual([{ provider: "openai", modelId: model.id, modelName: model.name }]);
      expect(other.allEnabledModels).toEqual(main.allEnabledModels);
      expect(await settingsService.resolveAgentModel("openai", model.id)).toMatchObject(model);
      expect(await fs.readFile(path.join(tempRoot, ".global", "auth.json"), "utf8")).not.toContain("catalog-test-key");

      request.mockImplementation(async () => new Response("unavailable", { status: 400 }));
      await expect(settingsService.refreshAvailableModels("openai")).rejects.toThrow("400");
      expect(await settingsService.resolveAgentModel("openai", model.id)).toMatchObject(model);

      vi.resetModules();
      const restarted = (await import("../../electron/main/services/settingsService")).settingsService;
      request.mockClear();
      expect(await restarted.getAvailableModels("openai")).toContainEqual(expect.objectContaining({ id: model.id }));
      expect(await restarted.resolveAgentModel("openai", model.id)).toMatchObject(model);
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["openai", "openai-codex", "anthropic", "openrouter"])(
    "refreshes %s without enabling the provider or configuring credentials",
    async (provider) => {
      for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_FEDERATION_RULE_ID", "OPENROUTER_API_KEY"]) {
        vi.stubEnv(name, "");
      }
      vi.stubEnv("PI_OFFLINE", undefined);
      const { settingsService } = await import("../../electron/main/services/settingsService");
      const { getSharedModelRuntime } = await import("../../electron/main/services/authStorageService");
      const runtime = await getSharedModelRuntime();
      const model = { ...runtime.getModels(provider)[0], id: "public-new-model", name: "Public New Model" };
      const request = vi.fn(async (_input: unknown, _init?: unknown) => new Response(JSON.stringify([model]), {
        headers: { "content-type": "application/json", "last-modified": "Thu, 01 Jan 2099 00:00:00 GMT" },
      }));
      vi.stubGlobal("fetch", request);
      try {
        await settingsService.saveClaudeConfig({
          provider, enabled: false, customModels: [], enabledModels: [],
        });
        expect(await runtime.checkAuth(provider)).toBeUndefined();
        expect(await settingsService.refreshAvailableModels(provider)).toContainEqual(expect.objectContaining({ id: model.id }));
        expect(request).toHaveBeenCalledTimes(1);
        expect(String(request.mock.calls[0][0])).toContain(`/api/models/providers/${provider}?`);
        expect(request.mock.calls[0][1]).toMatchObject({ headers: expect.not.objectContaining({ authorization: expect.anything() }) });
        const status = await settingsService.getClaudeStatus();
        expect(status.providers[provider]).toMatchObject({ configured: false, enabled: false });
        expect(status.allEnabledModels).toEqual([]);
        expect(await settingsService.resolveAgentModel(provider, model.id)).toMatchObject({ id: model.id });
        vi.resetModules();
        const restarted = (await import("../../electron/main/services/settingsService")).settingsService;
        request.mockClear();
        expect(await restarted.getAvailableModels(provider)).toContainEqual(expect.objectContaining({ id: model.id }));
        expect(request).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    },
  );

  it("keeps model choices per session while enabled models remain shared", async () => {
    const { settingsService } = await import("../../electron/main/services/settingsService");
    const scope = { type: "main" } as const;
    await settingsService.setLastSelectedModel(scope, "openai:gpt-4o");
    await settingsService.setLastSelectedModel(scope, "openai:gpt-4o", "session-a");
    await settingsService.setLastSelectedModel(scope, "anthropic:claude-b", "session-b");
    await settingsService.setLastSelectedModel(scope, "openai:gpt-new-default");
    expect((await settingsService.getClaudeStatus(scope, "session-a")).lastSelectedModel).toBe("openai:gpt-4o");
    expect((await settingsService.getClaudeStatus(scope, "session-b")).lastSelectedModel).toBe("anthropic:claude-b");
    expect((await settingsService.getClaudeStatus(scope)).lastSelectedModel).toBe("openai:gpt-new-default");
    const otherScope = { type: "project", projectId: "agent-b" } as const;
    await settingsService.setLastSelectedModel(otherScope, "openai:other", "session-a");
    expect((await settingsService.getClaudeStatus(scope, "session-a")).lastSelectedModel).toBe("openai:gpt-4o");
    vi.resetModules();
    const restarted = (await import("../../electron/main/services/settingsService")).settingsService;
    expect((await restarted.getClaudeStatus(scope, "session-b")).lastSelectedModel).toBe("anthropic:claude-b");
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
    await expect(
      settingsService.getAgentSystemPrompt("main", "digital_avatar"),
    ).resolves.toBe("avatar-agent prompt");
    await expect(
      settingsService.getAgentSystemPrompt("main", "channel_runtime"),
    ).resolves.toBe("avatar-agent prompt");
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
      themeMode: "dark",
      linkOpenMode: "system",
      mainSubModeEnabled: true,
      quickGuideDismissed: true,
      chatInputShortcutTipDismissed: true,
      chatEditMessageTipDismissed: true,
      showHiddenSessions: true,
    });

    const rawConfig = await fs.readFile(
      path.join(tempRoot, ".global", "config.json"),
      "utf8",
    );
    expect(JSON.parse(rawConfig)).toEqual({
      workspaceRoot: "/tmp/next-workspace",
      language: "en-US",
      themeMode: "dark",
      linkOpenMode: "system",
      quickGuideDismissed: true,
      chatInputShortcutTipDismissed: true,
      chatEditMessageTipDismissed: true,
      showHiddenSessions: true,
      openaiCompatServer: {
        enabled: false,
        port: 23333,
        requireToken: true,
        token: "",
      },
    });
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
      workspaceRootRestartRequired: true,
      language: "zh-CN",
      themeMode: "system",
      linkOpenMode: "builtin",
      mainSubModeEnabled: true,
      quickGuideDismissed: false,
      chatInputShortcutTipDismissed: false,
      chatEditMessageTipDismissed: false,
      showHiddenSessions: false,
      openaiCompatServer: {
        enabled: false,
        port: 23333,
        requireToken: true,
        token: "",
      },
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

  it("persists provider baseUrl override and custom models using pi-mono style config", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await settingsService.saveClaudeConfig({
      provider: "custom-api",
      enabled: true,
      secret: "sk-test-custom-provider",
      baseUrl: "https://proxy.example.com/v1",
      api: "openai-completions",
      customModels: [
        {
          id: "gpt-4.1-custom",
          name: "GPT 4.1 Custom",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 256000,
          maxTokens: 32768,
        },
      ],
      enabledModels: ["gpt-4.1-custom"],
    });

    await expect(settingsService.getClaudeStatus()).resolves.toMatchObject({
      providers: {
        "custom-api": {
          enabled: true,
          apiKey: "sk-test-custom-provider",
          baseUrl: "https://proxy.example.com/v1",
          api: "openai-completions",
          customModels: [
            {
              id: "gpt-4.1-custom",
              name: "GPT 4.1 Custom",
              reasoning: true,
              input: ["text", "image"],
              contextWindow: 256000,
              maxTokens: 32768,
            },
          ],
          enabledModels: ["gpt-4.1-custom"],
        },
      },
      allEnabledModels: [
        {
          provider: "custom-api",
          modelId: "gpt-4.1-custom",
          modelName: "GPT 4.1 Custom",
        },
      ],
    });

    await expect(
      settingsService.getAvailableModels("custom-api"),
    ).resolves.toEqual([
      {
        id: "gpt-4.1-custom",
        name: "GPT 4.1 Custom",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 256000,
        maxTokens: 32768,
        source: "custom",
      },
    ]);

    await expect(
      settingsService.resolveAgentModel(
        "custom-api",
        "gpt-4.1-custom",
      ),
    ).resolves.toMatchObject({
      provider: "custom-api",
      id: "gpt-4.1-custom",
      api: "openai-completions",
      baseUrl: "https://proxy.example.com/v1",
      compat: {
        supportsDeveloperRole: false,
      },
    });
  });

  it("includes legacy Custom API provider when it already exists in settings", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await settingsService.saveClaudeConfig({
      provider: "custom-api",
      displayName: "Custom API",
      enabled: false,
      baseUrl: "http://localhost:2276/v1",
      api: "openai-completions",
      customModels: [],
      enabledModels: [],
    });

    await expect(settingsService.getAvailableProviders()).resolves.toEqual(
      expect.arrayContaining([
        {
          id: "custom-api",
          name: "Custom API",
        },
      ]),
    );
  });

  it("lists saved custom providers with their display names", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await settingsService.saveClaudeConfig({
      provider: "custom-api__moonshot-demo",
      displayName: "Moonshot Proxy",
      enabled: false,
      baseUrl: "https://proxy.example.com/v1",
      api: "openai-completions",
      customModels: [],
      enabledModels: [],
    });

    await expect(settingsService.getAvailableProviders()).resolves.toEqual(
      expect.arrayContaining([
        {
          id: "custom-api__moonshot-demo",
          name: "Moonshot Proxy",
        },
      ]),
    );
  });

  it.each(["custom-api", "custom-api__proxy"])(
    "deletes %s and its model selections while preserving other providers",
    async (provider) => {
      const { settingsService } = await import(
        "../../electron/main/services/settingsService"
      );
      const otherProvider = `${provider}__other`;
      for (const id of [provider, otherProvider, "openai"]) {
        await settingsService.saveClaudeConfig({
          provider: id,
          enabled: true,
          secret: `test-key-${id}`,
          baseUrl: "https://proxy.example.com/v1",
          api: "openai-completions",
          customModels: [{
            id: "model:custom",
            reasoning: false,
            input: ["text"],
            contextWindow: 128000,
            maxTokens: 4096,
          }],
          enabledModels: ["model:custom"],
        });
      }
      const main = { type: "main" } as const;
      const project = { type: "project", projectId: "agent-a" } as const;
      await settingsService.setLastSelectedModel(main, `${provider}:model:custom`);
      await settingsService.setLastSelectedModel(main, `${provider}:model:custom`, "session-a");
      await settingsService.setLastSelectedModel(main, `${otherProvider}:model:custom`, "session-b");
      await settingsService.setLastSelectedModel(project, "openai:model:custom");
      await settingsService.setLastSelectedModel(project, `${provider}:model:custom`, "session-a");
      await settingsService.deleteCustomProvider(provider);

      const status = await settingsService.getClaudeStatus(main, "session-a");
      expect(status.providers).not.toHaveProperty(provider);
      expect(status.providers[otherProvider]).toMatchObject({ enabled: true, apiKey: `test-key-${otherProvider}` });
      expect(status.providers.openai).toMatchObject({ enabled: true, apiKey: "test-key-openai" });
      expect(status.allEnabledModels.map((model) => model.provider)).toEqual([otherProvider, "openai"]);
      expect(status.lastSelectedModel).toBeUndefined();
      expect((await settingsService.getClaudeStatus(main, "session-b")).lastSelectedModel).toBe(`${otherProvider}:model:custom`);
      expect((await settingsService.getClaudeStatus(project, "session-a")).lastSelectedModel).toBe("openai:model:custom");
      expect((await settingsService.getAvailableProviders()).map((entry) => entry.id)).not.toContain(provider);
      expect(await settingsService.getAvailableModels(provider)).toEqual([]);
      expect(await settingsService.getClaudeSecret(provider)).toBeNull();
      const stored = JSON.parse(await fs.readFile(path.join(tempRoot, ".kian", "settings.json"), "utf8"));
      expect(stored.lastSelectedModel).toBeUndefined();
      expect(stored.lastSelectedModelByScope).toEqual({ "project:agent-a": "openai:model:custom" });
      expect(stored.lastSelectedModelBySession).toEqual({ "main:session-b": `${otherProvider}:model:custom` });
      vi.resetModules();
      const restarted = (await import("../../electron/main/services/settingsService")).settingsService;
      expect((await restarted.getClaudeStatus()).providers).not.toHaveProperty(provider);
      expect((await restarted.getAvailableProviders()).map((entry) => entry.id)).not.toContain(provider);
    },
  );

  it("rejects deleting a built-in provider without changing its configuration", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );
    await settingsService.saveClaudeConfig({
      provider: "openai", enabled: false, secret: "test-key", customModels: [], enabledModels: [],
    });
    const before = await fs.readFile(path.join(tempRoot, ".kian", "settings.json"), "utf8");
    await expect(settingsService.deleteCustomProvider("openai")).rejects.toThrow("Only custom providers can be deleted");
    expect(await fs.readFile(path.join(tempRoot, ".kian", "settings.json"), "utf8")).toBe(before);
  });

  it("treats Custom API as configured without an API key when URL, API type, and custom models are present", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await settingsService.saveClaudeConfig({
      provider: "custom-api",
      enabled: true,
      baseUrl: "http://localhost:2276/v1",
      api: "openai-completions",
      customModels: [
        {
          id: "qwen3.5-small-9b",
          reasoning: true,
          input: ["text"],
          contextWindow: 131072,
          maxTokens: 8192,
        },
      ],
      enabledModels: ["qwen3.5-small-9b"],
    });

    await expect(settingsService.getClaudeStatus()).resolves.toMatchObject({
      providers: {
        "custom-api": {
          configured: true,
          apiKey: "",
          baseUrl: "http://localhost:2276/v1",
          api: "openai-completions",
          enabledModels: ["qwen3.5-small-9b"],
        },
      },
      allEnabledModels: [
        {
          provider: "custom-api",
          modelId: "qwen3.5-small-9b",
          modelName: "qwen3.5-small-9b",
        },
      ],
    });

    await expect(settingsService.getClaudeSecret("custom-api")).resolves.toBe(
      "kian-custom-api-no-auth",
    );
  });

  it("preserves Azure credentials and scoped model selections after the provider rename", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".kian", "settings.json"),
      JSON.stringify({
        providers: [{
          provider: "azure-openai-responses",
          enabled: true,
          apiKey: "azure-test-key",
          baseUrl: "https://example.openai.azure.com",
          enabledModels: ["gpt-4o"],
        }],
        lastSelectedModel: "azure-openai-responses:gpt-4o",
        lastSelectedModelByScope: {
          "project:azure-project": "azure-openai-responses:gpt-4o",
        },
      }),
    );
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    const status = await settingsService.getClaudeStatus();
    expect(status.providers.azure).toMatchObject({
      apiKey: "azure-test-key",
      enabled: true,
      enabledModels: ["gpt-4o"],
    });
    expect(status.providers["azure-openai-responses"]).toBeUndefined();
    expect(status.lastSelectedModel).toBe("azure:gpt-4o");
    await expect(settingsService.getClaudeStatus({ type: "project", projectId: "azure-project" }))
      .resolves.toMatchObject({ lastSelectedModel: "azure:gpt-4o" });
    await expect(settingsService.resolveAgentModel("azure", "gpt-4o"))
      .resolves.toMatchObject({ provider: "azure", baseUrl: "https://example.openai.azure.com" });
  });

  it("persists model selection separately for main and project scopes", async () => {
    const { settingsService } = await import(
      "../../electron/main/services/settingsService"
    );

    await settingsService.setLastSelectedModel(
      { type: "main" },
      "anthropic:claude-main",
    );
    await settingsService.setLastSelectedThinkingLevel(
      { type: "main" },
      "medium",
    );
    await settingsService.setLastSelectedModel(
      { type: "project", projectId: "agent-alpha" },
      "openrouter:deepseek-chat",
    );
    await settingsService.setLastSelectedThinkingLevel(
      { type: "project", projectId: "agent-alpha" },
      "high",
    );

    await expect(
      settingsService.getClaudeStatus({ type: "main" }),
    ).resolves.toMatchObject({
      lastSelectedModel: "anthropic:claude-main",
      lastSelectedThinkingLevel: "medium",
    });
    await expect(
      settingsService.getClaudeStatus({
        type: "project",
        projectId: "agent-alpha",
      }),
    ).resolves.toMatchObject({
      lastSelectedModel: "openrouter:deepseek-chat",
      lastSelectedThinkingLevel: "high",
    });

    await expect(
      fs.readFile(path.join(tempRoot, ".kian", "settings.json"), "utf8"),
    ).resolves.toContain('"lastSelectedModelByScope": {');
  });
});
