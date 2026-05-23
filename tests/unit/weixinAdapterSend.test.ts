import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWeixinAdapterClient } from "../../packages/weixin-adapter/src/client/polling-client";

const originalFetch = globalThis.fetch;

const createJsonResponse = (payload: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  }) as unknown as Response;

describe("WeixinAdapterClient sendText", () => {
  const fetchMock = vi.fn();
  let stateDir = "";

  beforeEach(async () => {
    stateDir = await mkdtemp(path.join(os.tmpdir(), "kian-weixin-test-"));
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(createJsonResponse({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (stateDir) {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("sends replies from the raw bot account id", async () => {
    const client = createWeixinAdapterClient({ stateDir });
    await client.saveAccount({
      accountId: "bot-account",
      rawAccountId: "bot-account@im.bot",
      token: "bot-token",
      baseUrl: "https://example.com",
    });

    await client.sendText({
      accountId: "bot-account",
      toUserId: "user@im.wechat",
      text: "hello",
      contextToken: "ctx-token",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));

    expect(body.msg.from_user_id).toBe("bot-account@im.bot");
    expect(body.msg.to_user_id).toBe("user@im.wechat");
    expect(body.msg.context_token).toBe("ctx-token");
  });
});
