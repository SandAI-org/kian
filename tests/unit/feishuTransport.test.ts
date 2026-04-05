import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import {
  fetchFeishuUserDisplayName,
  sendFeishuBotDocument,
  sendFeishuBotMessage,
} from "../../electron/main/services/chatChannel/feishuTransport";

const originalFetch = globalThis.fetch;

const createJsonResponse = (payload: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: vi.fn().mockReturnValue("application/json"),
    },
    json: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  }) as unknown as Response;

describe("sendFeishuBotMessage", () => {
  const fetchMock = vi.fn();
  const fsAccessMock = vi.spyOn(fs, "access");
  const fsReadFileMock = vi.spyOn(fs, "readFile");

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(createJsonResponse({ code: 0 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fsAccessMock.mockReset();
    fsReadFileMock.mockReset();
    fsAccessMock.mockResolvedValue(undefined);
    fsReadFileMock.mockResolvedValue(Buffer.from("file-content"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends interactive content as raw card json string", async () => {
    await sendFeishuBotMessage("tenant_access_token_value", "oc_chat_001", "hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    );

    const body = JSON.parse(String(requestInit.body)) as {
      msg_type: string;
      receive_id: string;
      content: string;
    };
    expect(body.msg_type).toBe("interactive");
    expect(body.receive_id).toBe("oc_chat_001");
    expect(JSON.parse(body.content)).toEqual({
      schema: "2.0",
      body: {
        elements: [
          {
            tag: "markdown",
            content: "hello",
          },
        ],
      },
    });
  });

  it("uses same raw card content when replying to message", async () => {
    await sendFeishuBotMessage(
      "tenant_access_token_value",
      "oc_chat_ignored",
      "reply body",
      "chat_id",
      "om_reply_001",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/im/v1/messages/om_reply_001/reply",
    );

    const body = JSON.parse(String(requestInit.body)) as {
      msg_type: string;
      content: string;
      receive_id?: string;
    };
    expect(body.msg_type).toBe("interactive");
    expect(body.receive_id).toBeUndefined();
    expect(JSON.parse(body.content)).toEqual({
      schema: "2.0",
      body: {
        elements: [
          {
            tag: "markdown",
            content: "reply body",
          },
        ],
      },
    });
  });

  it("renders mermaid fences as ascii code blocks in interactive cards", async () => {
    await sendFeishuBotMessage(
      "tenant_access_token_value",
      "oc_chat_001",
      `流程图

\`\`\`mermaid
graph LR
  A --> B
\`\`\``,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as {
      content: string;
    };
    const card = JSON.parse(body.content) as {
      body: {
        elements: Array<{ tag: string; content: string }>;
      };
    };

    expect(card.body.elements[0]?.tag).toBe("markdown");
    expect(card.body.elements[0]?.content).toContain("```text");
    expect(card.body.elements[0]?.content).not.toContain("```mermaid");
    expect(card.body.elements[0]?.content).toContain("A");
    expect(card.body.elements[0]?.content).toContain("B");
  });

  it("uploads attachment and sends file message before text content", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          code: 0,
          data: {
            file_key: "file_v2_001",
          },
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ code: 0 }));

    await sendFeishuBotDocument(
      "tenant_access_token_value",
      "oc_chat_001",
      "/tmp/demo.txt",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [uploadUrl, uploadRequestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(uploadUrl).toBe("https://open.feishu.cn/open-apis/im/v1/files");
    expect(uploadRequestInit.method).toBe("POST");

    const [sendUrl, sendRequestInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(sendUrl).toBe(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    );
    const sendBody = JSON.parse(String(sendRequestInit.body)) as {
      msg_type: string;
      receive_id: string;
      content: string;
    };
    expect(sendBody.msg_type).toBe("file");
    expect(sendBody.receive_id).toBe("oc_chat_001");
    expect(JSON.parse(sendBody.content)).toEqual({
      file_key: "file_v2_001",
    });
  });

  it("sends file message via reply endpoint when reply id is provided", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          code: 0,
          data: {
            file_key: "file_v2_reply",
          },
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ code: 0 }));

    await sendFeishuBotDocument(
      "tenant_access_token_value",
      "oc_chat_ignored",
      "/tmp/demo.txt",
      "chat_id",
      "om_reply_001",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [sendUrl, sendRequestInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(sendUrl).toBe(
      "https://open.feishu.cn/open-apis/im/v1/messages/om_reply_001/reply",
    );
    const sendBody = JSON.parse(String(sendRequestInit.body)) as {
      msg_type: string;
      content: string;
      receive_id?: string;
    };
    expect(sendBody.msg_type).toBe("file");
    expect(sendBody.receive_id).toBeUndefined();
    expect(JSON.parse(sendBody.content)).toEqual({
      file_key: "file_v2_reply",
    });
  });
});

describe("fetchFeishuUserDisplayName", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("loads the sender name with open_id", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        code: 0,
        data: {
          items: [
            {
              member_id: "ou_123",
              name: "Alice",
            },
          ],
          has_more: false,
        },
      }),
    );

    const displayName = await fetchFeishuUserDisplayName({
      token: "tenant_access_token_value",
      userId: "ou_123",
      chatId: "oc_chat_001",
      userIdType: "open_id",
      cache: new Map(),
    });

    expect(displayName).toBe("Alice");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/im/v1/chats/oc_chat_001/members?member_id_type=open_id&page_size=100",
    );
    expect(requestInit.headers).toEqual({
      authorization: "Bearer tenant_access_token_value",
    });
  });

  it("falls back to contact user details when the chat member list has no match", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          code: 0,
          data: {
            items: [],
            has_more: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          code: 0,
          data: {
            user: {
              name: "Alice",
            },
          },
        }),
      );

    const displayName = await fetchFeishuUserDisplayName({
      token: "tenant_access_token_value",
      userId: "ou_123",
      chatId: "oc_chat_001",
      userIdType: "open_id",
      cache: new Map(),
    });

    expect(displayName).toBe("Alice");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://open.feishu.cn/open-apis/contact/v3/users/ou_123?user_id_type=open_id",
    );
  });

  it("falls back to empty name when the user lookup returns an error code", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          code: 0,
          data: {
            items: [],
            has_more: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          code: 99991663,
          msg: "user not found",
        }),
      );

    const displayName = await fetchFeishuUserDisplayName({
      token: "tenant_access_token_value",
      userId: "ou_missing",
      chatId: "oc_chat_001",
      userIdType: "open_id",
      cache: new Map(),
    });

    expect(displayName).toBe("");
  });
});
