import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendFeishuWebhookInteractiveCard,
  sendFeishuWebhookMessage,
} from "../../electron/main/services/chatChannel/feishuWebhookTransport";

const originalFetch = globalThis.fetch;
const createJsonResponse = (payload: unknown): Response =>
  ({
    ok: true,
    headers: {
      get: vi.fn().mockReturnValue("application/json"),
    },
    json: vi.fn().mockResolvedValue(payload),
  }) as unknown as Response;

const createMarkdownCardPayload = (content: string): Record<string, unknown> => ({
  msg_type: "interactive",
  card: {
    schema: "2.0",
    config: {
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content,
        },
      ],
    },
  },
});

describe("sendFeishuWebhookMessage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(createJsonResponse({ StatusCode: 0 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("wraps plain text as single markdown card payload", async () => {
    await sendFeishuWebhookMessage("https://example.com/webhook", "hello world");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));

    expect(body).toEqual(createMarkdownCardPayload("hello world"));
  });

  it("treats JSON string as markdown content", async () => {
    const rawJson = '{"foo":"bar"}';

    await sendFeishuWebhookMessage("https://example.com/webhook", rawJson);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));

    expect(body).toEqual(createMarkdownCardPayload(rawJson));
  });

  it("uploads markdown image and replaces image url with image_key", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          code: 0,
          data: {
            image_key: "img_v3_001",
          },
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ StatusCode: 0 }));

    await sendFeishuWebhookMessage(
      "https://example.com/webhook",
      "图像示例：![示例图](data:image/png;base64,aGVsbG8=)",
      { token: "tenant_access_token_value" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [uploadUrl, uploadRequestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(uploadUrl).toBe("https://open.feishu.cn/open-apis/im/v1/images");
    expect(uploadRequestInit.method).toBe("POST");
    expect(uploadRequestInit.headers).toEqual({
      authorization: "Bearer tenant_access_token_value",
    });

    const [, webhookRequestInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(webhookRequestInit.body));
    expect(body).toEqual(
      createMarkdownCardPayload("图像示例：![示例图](img_v3_001)"),
    );
  });

  it("strips unsupported attachment token and appends webhook limitation note", async () => {
    await sendFeishuWebhookMessage(
      "https://example.com/webhook",
      [
        "正文开始",
        "@[attachment](/tmp/demo.txt)",
        "正文结束",
      ].join("\n"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));

    expect(body).toEqual(
      createMarkdownCardPayload(
        [
          "正文开始",
          "",
          "正文结束",
          "",
          "附件说明：当前飞书 Webhook 通道不支持文件消息，未发送以下附件：",
          "- demo.txt",
        ].join("\n"),
      ),
    );
  });

  it("converts image attachment token to inline image markdown", async () => {
    await sendFeishuWebhookMessage(
      "https://example.com/webhook",
      [
        "正文开始",
        "@[attachment](/tmp/demo.png)",
        "正文结束",
      ].join("\n"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));

    expect(body).toEqual(
      createMarkdownCardPayload(
        [
          "正文开始",
          "![demo.png](/tmp/demo.png)",
          "正文结束",
        ].join("\n"),
      ),
    );
  });

  it("sends raw interactive card payload for Feishu webhooks", async () => {
    const card = {
      schema: "2.0",
      body: {
        elements: [
          {
            tag: "div",
            text: {
              tag: "plain_text",
              content: "hello card",
            },
          },
        ],
      },
    };

    await sendFeishuWebhookInteractiveCard("https://example.com/webhook", card);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));

    expect(body).toEqual({
      msg_type: "interactive",
      card,
    });
  });
});
