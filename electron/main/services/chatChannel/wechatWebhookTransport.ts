import { assertHttpOk } from "./transportCommon";

interface WechatWebhookResponse {
  errcode?: number;
  errmsg?: string;
}

const tryParseWechatWebhookPayload = (
  rawText: string,
): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const msgType = (parsed as { msgtype?: unknown }).msgtype;
    if (typeof msgType !== "string" || !msgType.trim()) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const sendWechatWebhookMessage = async (
  webhook: string,
  text: string,
): Promise<void> => {
  const normalizedWebhook = webhook.trim();
  if (!normalizedWebhook) {
    throw new Error("企业微信 Webhook 不能为空");
  }

  const payload = text.trim();
  if (!payload) {
    throw new Error("广播消息不能为空");
  }

  const parsedPayload = tryParseWechatWebhookPayload(payload);
  const requestPayload =
    parsedPayload ??
    ({
      msgtype: "markdown",
      markdown: {
        content: payload,
      },
    } as const);

  const response = await fetch(normalizedWebhook, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  });
  await assertHttpOk(response, "企业微信", "Webhook 消息发送");

  const body = (await response.json().catch(() => null)) as
    | WechatWebhookResponse
    | null;
  if (!body || typeof body !== "object") {
    return;
  }

  const code =
    typeof body.errcode === "number" ? body.errcode : 0;
  if (code === 0) {
    return;
  }

  const message =
    (typeof body.errmsg === "string" && body.errmsg.trim()) ||
    "企业微信 Webhook 消息发送失败";
  throw new Error(message);
};
