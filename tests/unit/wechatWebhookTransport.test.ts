import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWechatWebhookMessage } from "../../electron/main/services/chatChannel/wechatWebhookTransport";

const originalFetch = globalThis.fetch;

const createJsonResponse = (payload: unknown): Response =>
  ({
    ok: true,
    headers: {
      get: vi.fn().mockReturnValue("application/json"),
    },
    json: vi.fn().mockResolvedValue(payload),
  }) as unknown as Response;

describe("sendWechatWebhookMessage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(createJsonResponse({ errcode: 0 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("wraps plain text as markdown webhook payload", async () => {
    await sendWechatWebhookMessage(
      "https://example.com/webhook",
      "正文\n\n<font color=\"comment\">来自 vivid</font>",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));

    expect(body).toEqual({
      msgtype: "markdown",
      markdown: {
        content: "正文\n\n<font color=\"comment\">来自 vivid</font>",
      },
    });
  });

  it("passes explicit json payload through unchanged", async () => {
    const rawJson =
      '{"msgtype":"text","text":{"content":"raw payload should stay as-is"}}';

    await sendWechatWebhookMessage("https://example.com/webhook", rawJson);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));

    expect(body).toEqual({
      msgtype: "text",
      text: {
        content: "raw payload should stay as-is",
      },
    });
  });
});
