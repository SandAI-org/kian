import path from "node:path";
import { assertHttpOk } from "./transportCommon";
import {
  buildFeishuMarkdownCard,
  normalizeFeishuMarkdownContent,
  resolveFeishuAccessToken,
} from "./feishuTransport";
import {
  detectMediaKindFromPath,
  extractExtendedMarkdownTokens,
} from "../mediaMarkdown";

interface FeishuWebhookResponse {
  StatusCode?: number;
  StatusMessage?: string;
  code?: number;
  msg?: string;
  message?: string;
}

const FEISHU_IMAGE_MARKDOWN_MARKER_PATTERN =
  /!\[[^\]]*\]\([^)]+\)|@\[(?:image)(?:\|[^\]]*)?\]\([^)]+\)/i;

const removeUnsupportedWebhookAttachmentTokens = (content: string): {
  text: string;
  attachmentLabels: string[];
} => {
  const tokens = extractExtendedMarkdownTokens(content).filter(
    (token) => token.kind === "attachment" || token.kind === "file",
  );
  if (tokens.length === 0) {
    return {
      text: content,
      attachmentLabels: [],
    };
  }

  const sortedTokens = [...tokens].sort((left, right) => left.index - right.index);
  const segments: string[] = [];
  const labels: string[] = [];
  let cursor = 0;
  for (const token of sortedTokens) {
    const start = Math.max(0, token.index);
    const end = start + token.raw.length;
    if (start < cursor) continue;
    segments.push(content.slice(cursor, start));
    const normalizedPath = token.path.trim();
    if (detectMediaKindFromPath(normalizedPath) === "image") {
      segments.push(`@[image](${normalizedPath})`);
    } else {
      const label = path.basename(normalizedPath) || normalizedPath;
      if (label) {
        labels.push(label);
      }
    }
    cursor = end;
  }
  segments.push(content.slice(cursor));

  const normalized = segments
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    text: normalized,
    attachmentLabels: Array.from(new Set(labels)),
  };
};

export const sendFeishuWebhookMessage = async (
  webhook: string,
  text: string,
  options?: {
    token?: string;
  },
): Promise<void> => {
  const normalizedWebhook = webhook.trim();
  if (!normalizedWebhook) {
    throw new Error("飞书 Webhook 不能为空");
  }

  const payload = text.trim();
  if (!payload) {
    throw new Error("广播消息不能为空");
  }
  const {
    text: sanitizedPayload,
    attachmentLabels,
  } = removeUnsupportedWebhookAttachmentTokens(payload);

  const sourceToken = options?.token?.trim() ?? "";
  const accessToken =
    sourceToken && FEISHU_IMAGE_MARKDOWN_MARKER_PATTERN.test(sanitizedPayload)
      ? await resolveFeishuAccessToken(sourceToken)
      : undefined;
  const markdownContent = await normalizeFeishuMarkdownContent(sanitizedPayload, {
    accessToken,
  });
  const finalContent =
    attachmentLabels.length === 0
      ? markdownContent
      : `${markdownContent}\n\n附件说明：当前飞书 Webhook 通道不支持文件消息，未发送以下附件：\n${attachmentLabels
          .map((item) => `- ${item}`)
          .join("\n")}`.trim();
  const requestPayload = {
    msg_type: "interactive",
    card: buildFeishuMarkdownCard(finalContent),
  } as const;

  const response = await fetch(normalizedWebhook, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  });
  await assertHttpOk(response, "飞书", "Webhook 消息发送");

  const body = (await response.json().catch(() => null)) as
    | FeishuWebhookResponse
    | null;
  if (!body || typeof body !== "object") {
    return;
  }

  const code =
    typeof body.StatusCode === "number"
      ? body.StatusCode
      : typeof body.code === "number"
        ? body.code
        : 0;
  if (code === 0) {
    return;
  }

  const message =
    (typeof body.StatusMessage === "string" && body.StatusMessage.trim()) ||
    (typeof body.msg === "string" && body.msg.trim()) ||
    (typeof body.message === "string" && body.message.trim()) ||
    "飞书 Webhook 消息发送失败";
  throw new Error(message);
};
