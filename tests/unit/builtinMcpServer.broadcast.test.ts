import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getBroadcastChannelById: vi.fn(),
  getFeishuChatChannelRuntime: vi.fn(),
  sendFeishuWebhookInteractiveCard: vi.fn(),
  sendFeishuWebhookMessage: vi.fn(),
  sendWechatWebhookMessage: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => "Test Computer\n"),
}));

vi.mock("../../electron/main/services/browserUseTools", () => ({
  createBrowserUseTools: vi.fn(() => []),
}));

vi.mock("../../electron/main/services/chatChannel/feishuWebhookTransport", () => ({
  sendFeishuWebhookInteractiveCard: state.sendFeishuWebhookInteractiveCard,
  sendFeishuWebhookMessage: state.sendFeishuWebhookMessage,
}));

vi.mock("../../electron/main/services/chatChannel/wechatWebhookTransport", () => ({
  sendWechatWebhookMessage: state.sendWechatWebhookMessage,
}));

vi.mock("../../electron/main/services/modelProviders/falProvider", () => ({
  createFalProvider: vi.fn(),
  formatFalErrorMessage: vi.fn((error: unknown) => String(error)),
  formatFalModelsForError: vi.fn(() => ""),
  getFalModelById: vi.fn(),
  isFalModelSupported: vi.fn(() => false),
}));

vi.mock("../../electron/main/services/settingsService", () => ({
  settingsService: {
    getBroadcastChannelById: state.getBroadcastChannelById,
    getFeishuChatChannelRuntime: state.getFeishuChatChannelRuntime,
    getModelProviderRuntime: vi.fn(),
    getBroadcastChannels: vi.fn(),
  },
}));

const getBroadcastTool = async () => {
  const { createBuiltinTools } = await import(
    "../../electron/main/services/builtinMcpServer"
  );
  const tool = createBuiltinTools("/tmp/project").find(
    (item) => item.name === "broadcast",
  );
  expect(tool).toBeDefined();
  return tool!;
};

describe("builtin broadcast tool", () => {
  beforeEach(() => {
    vi.resetModules();
    state.getBroadcastChannelById.mockReset();
    state.getFeishuChatChannelRuntime.mockReset();
    state.sendFeishuWebhookInteractiveCard.mockReset();
    state.sendFeishuWebhookMessage.mockReset();
    state.sendWechatWebhookMessage.mockReset();
  });

  it("sends Feishu interactive card when provided", async () => {
    const card = {
      schema: "2.0",
      body: {
        elements: [
          {
            tag: "markdown",
            content: "card content",
          },
        ],
      },
    };
    state.getBroadcastChannelById.mockResolvedValue({
      id: "1",
      name: "Feishu",
      type: "feishu",
      webhook: "https://example.com/feishu",
    });

    const tool = await getBroadcastTool();
    const result = await tool.handler({
      id: "1",
      message: "fallback markdown",
      feishuCard: card,
    });

    expect(result.isError).toBeUndefined();
    expect(state.sendFeishuWebhookInteractiveCard).toHaveBeenCalledWith(
      "https://example.com/feishu",
      card,
    );
    expect(state.sendFeishuWebhookMessage).not.toHaveBeenCalled();
    expect(state.getFeishuChatChannelRuntime).not.toHaveBeenCalled();
  });

  it("uses markdown fallback for WeChat when Feishu card is provided", async () => {
    state.getBroadcastChannelById.mockResolvedValue({
      id: "2",
      name: "WeChat",
      type: "wechat",
      webhook: "https://example.com/wechat",
    });

    const tool = await getBroadcastTool();
    const result = await tool.handler({
      id: "2",
      message: "fallback markdown",
      feishuCard: {
        schema: "2.0",
      },
    });

    expect(result.isError).toBeUndefined();
    expect(state.sendWechatWebhookMessage).toHaveBeenCalledWith(
      "https://example.com/wechat",
      "fallback markdown\n\n<font color=\"comment\">来自 Test Computer</font>",
    );
    expect(state.sendFeishuWebhookInteractiveCard).not.toHaveBeenCalled();
    expect(state.sendFeishuWebhookMessage).not.toHaveBeenCalled();
  });
});
