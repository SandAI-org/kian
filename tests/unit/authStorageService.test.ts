import type { AuthInteraction } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  readStoredCredential: vi.fn(),
  openExternal: vi.fn(async () => {}),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: state.create },
  readStoredCredential: state.readStoredCredential,
}));
vi.mock("electron", () => ({ shell: { openExternal: state.openExternal } }));
vi.mock("../../electron/main/services/workspacePaths", () => ({ GLOBAL_CONFIG_DIR: "/test/kian" }));
vi.mock("../../electron/main/services/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  state.create.mockResolvedValue({ login: state.login, logout: state.logout });
  state.openExternal.mockResolvedValue(undefined);
});

describe("pi model runtime authentication", () => {
  it("keeps Kian credentials isolated and reads saved OAuth status", async () => {
    const service = await import("../../electron/main/services/authStorageService");
    const runtime = service.getSharedModelRuntime();
    expect(service.getSharedModelRuntime()).toBe(runtime);
    await runtime;
    expect(state.create).toHaveBeenCalledExactlyOnceWith({
      authPath: "/test/kian/auth.json",
      modelsPath: null,
      modelsStore: expect.objectContaining({ read: expect.any(Function), write: expect.any(Function) }),
    });
    state.readStoredCredential.mockReturnValue({ type: "oauth" });
    expect(service.hasOAuthCredential("anthropic")).toBe(true);
    expect(state.readStoredCredential).toHaveBeenCalledWith("anthropic", "/test/kian/auth.json");
  });

  it("handles the new OAuth interaction callbacks and manual code submission", async () => {
    let submittedCode = "";
    state.login.mockImplementation(async (_provider: string, type: string, interaction: AuthInteraction) => {
      expect(type).toBe("oauth");
      expect(await interaction.prompt({ type: "select", message: "Method", options: [{ id: "browser", label: "Browser" }] })).toBe("browser");
      interaction.notify({ type: "auth_url", url: "https://example.com/oauth" });
      submittedCode = await interaction.prompt({ type: "manual_code", message: "Code" });
      return { type: "oauth" };
    });
    const service = await import("../../electron/main/services/authStorageService");
    const login = await service.startOAuthLogin("anthropic");
    expect(login.authUrl).toBe("https://example.com/oauth");
    expect(state.openExternal).toHaveBeenCalledWith(login.authUrl);
    expect(service.getAuthGeneration()).toBe(0);
    service.submitOAuthLoginCode(login.loginId, " code-123 ");
    await expect(service.waitOAuthLogin(login.loginId)).resolves.toBe("anthropic");
    expect(submittedCode).toBe("code-123");
    expect(service.getAuthGeneration()).toBe(1);
  });

  it("waits for logout persistence before invalidating active sessions", async () => {
    let finishLogout!: () => void;
    state.logout.mockImplementation(() => new Promise<void>((resolve) => { finishLogout = resolve; }));
    const service = await import("../../electron/main/services/authStorageService");
    await service.getSharedModelRuntime();
    const pending = service.oauthLogout("anthropic");
    await Promise.resolve();
    expect(state.logout).toHaveBeenCalledWith("anthropic");
    expect(service.getAuthGeneration()).toBe(0);
    finishLogout();
    await pending;
    expect(service.getAuthGeneration()).toBe(1);
  });
});
