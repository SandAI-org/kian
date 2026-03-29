import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>(),
  saveClaudeConfig: vi.fn(),
  reload: vi.fn(),
  loggerError: vi.fn(),
}));

const createServiceProxy = () =>
  new Proxy(
    {},
    {
      get: () => vi.fn(),
    },
  );

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
      state.handlers.set(channel, handler);
    }),
  },
  shell: {
    showItemInFolder: vi.fn(),
    openPath: vi.fn(),
  },
}));

vi.mock("../../electron/main/services/repositoryService", () => ({
  repositoryService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/chatService", () => ({
  chatService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/settingsService", () => ({
  settingsService: {
    ...createServiceProxy(),
    saveClaudeConfig: state.saveClaudeConfig,
  },
}));

vi.mock("../../electron/main/services/skillService", () => ({
  skillService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/chatChannelService", () => ({
  chatChannelService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/logger", () => ({
  logger: {
    error: state.loggerError,
  },
}));

vi.mock("../../electron/main/services/taskService", () => ({
  taskService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/onboardingService", () => ({
  onboardingService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/updateService", () => ({
  updateService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/appPreviewWindowService", () => ({
  appPreviewWindowService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/agentService", () => ({
  agentService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/linkOpenService", () => ({
  linkOpenService: createServiceProxy(),
}));

vi.mock("../../electron/main/services/localMediaPath", () => ({
  resolveLocalMediaPath: vi.fn(),
}));

vi.mock("../../electron/main/services/settingsRuntimeService", () => ({
  settingsRuntimeService: {
    reload: state.reload,
  },
}));

vi.mock("../../electron/main/services/chatChannel/weixinChannelService", () => ({
  weixinChannelService: createServiceProxy(),
}));

describe("registerHandlers", () => {
  beforeEach(() => {
    vi.resetModules();
    state.handlers.clear();
    state.saveClaudeConfig.mockReset();
    state.reload.mockReset();
    state.loggerError.mockReset();
  });

  it("passes custom provider displayName through the settings save handler", async () => {
    const { registerHandlers } = await import("../../electron/main/ipc/registerHandlers");

    registerHandlers();

    const handler = state.handlers.get("settings:saveClaudeApiKey");
    expect(handler).toBeTypeOf("function");

    const result = await handler?.(
      {},
      {
        provider: "custom-api__moonshot-demo",
        displayName: "Moonshot Proxy",
        enabled: false,
        secret: "sk-test",
        baseUrl: "https://proxy.example.com/v1",
        api: "openai-completions",
        customModels: [],
        enabledModels: [],
      },
    );

    expect(state.saveClaudeConfig).toHaveBeenCalledWith({
      provider: "custom-api__moonshot-demo",
      displayName: "Moonshot Proxy",
      enabled: false,
      secret: "sk-test",
      baseUrl: "https://proxy.example.com/v1",
      api: "openai-completions",
      customModels: [],
      enabledModels: [],
    });
    expect(state.reload).toHaveBeenCalledWith({
      targets: ["renderer", "agentSessions"],
    });
    expect(result).toEqual({
      ok: true,
      data: true,
    });
  });
});
