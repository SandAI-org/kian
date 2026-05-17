import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscordDirectMessageChannel } from "../../electron/main/services/chatChannel/discordTransport";

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

describe("createDiscordDirectMessageChannel", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(createJsonResponse({ id: "dm_channel_001" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates a direct message channel for a user", async () => {
    await expect(
      createDiscordDirectMessageChannel("discord_bot_token", "owner_user_001"),
    ).resolves.toBe("dm_channel_001");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/users/@me/channels",
      {
        method: "POST",
        headers: {
          authorization: "Bot discord_bot_token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipient_id: "owner_user_001",
        }),
      },
    );
  });
});
