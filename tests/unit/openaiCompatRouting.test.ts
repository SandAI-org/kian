import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  ModelRoutingError,
  isSelfBaseUrl,
  resolveModelRoute,
} from "../../electron/main/services/openaiCompat/routing";

const OWN_PORT = 23333;

const makeModel = (overrides: Record<string, unknown>): Model<Api> =>
  ({
    id: "test-model",
    name: "Test Model",
    api: "openai-completions",
    provider: "test-provider",
    baseUrl: "https://api.example.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    ...overrides,
  }) as unknown as Model<Api>;

describe("isSelfBaseUrl", () => {
  it("matches loopback hosts on the same port", () => {
    expect(isSelfBaseUrl("http://127.0.0.1:23333/v1", OWN_PORT)).toBe(true);
    expect(isSelfBaseUrl("http://localhost:23333", OWN_PORT)).toBe(true);
    expect(isSelfBaseUrl("http://[::1]:23333/v1", OWN_PORT)).toBe(true);
  });

  it("rejects other hosts, other ports and invalid urls", () => {
    expect(isSelfBaseUrl("http://127.0.0.1:9999/v1", OWN_PORT)).toBe(false);
    expect(isSelfBaseUrl("https://api.example.com/v1", OWN_PORT)).toBe(false);
    expect(isSelfBaseUrl("not a url", OWN_PORT)).toBe(false);
  });

  it("uses protocol default ports when none is given", () => {
    expect(isSelfBaseUrl("http://localhost/v1", 80)).toBe(true);
    expect(isSelfBaseUrl("https://localhost/v1", 443)).toBe(true);
    expect(isSelfBaseUrl("http://localhost/v1", OWN_PORT)).toBe(false);
  });
});

describe("resolveModelRoute", () => {
  const codexModel = makeModel({
    id: "gpt-5.6-sol",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api/codex",
  });
  const loopbackModel = makeModel({
    id: "openai-codex:gpt-5.6-sol",
    provider: "custom-api__loop",
    baseUrl: `http://127.0.0.1:${OWN_PORT}/v1`,
  });
  const enabledModels = [
    { provider: "openai-codex", modelId: "gpt-5.6-sol" },
    { provider: "custom-api__loop", modelId: "openai-codex:gpt-5.6-sol" },
  ];
  const resolveModel = async (provider: string, modelId: string) => {
    if (provider === "openai-codex" && modelId === "gpt-5.6-sol") {
      return codexModel;
    }
    if (
      provider === "custom-api__loop" &&
      modelId === "openai-codex:gpt-5.6-sol"
    ) {
      return loopbackModel;
    }
    return null;
  };

  it("prefers provider-prefixed matches over bare model ids", async () => {
    const route = await resolveModelRoute("openai-codex:gpt-5.6-sol", {
      enabledModels,
      resolveModel,
      ownPort: OWN_PORT,
    });
    expect(route.provider).toBe("openai-codex");
    expect(route.model).toBe(codexModel);
  });

  it("falls back to bare model ids containing colons", async () => {
    const bedrockModel = makeModel({
      id: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      provider: "amazon-bedrock",
    });
    const route = await resolveModelRoute(
      "anthropic.claude-sonnet-4-5-20250929-v1:0",
      {
        enabledModels: [
          {
            provider: "amazon-bedrock",
            modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
          },
        ],
        resolveModel: async () => bedrockModel,
        ownPort: OWN_PORT,
      },
    );
    expect(route.model).toBe(bedrockModel);
  });

  it("flattens providers whose baseUrl points at this server", async () => {
    const route = await resolveModelRoute(
      "custom-api__loop:openai-codex:gpt-5.6-sol",
      { enabledModels, resolveModel, ownPort: OWN_PORT },
    );
    expect(route.provider).toBe("openai-codex");
    expect(route.model).toBe(codexModel);
  });

  it("keeps custom providers with a foreign baseUrl unflattened", async () => {
    const remoteModel = makeModel({
      id: "openai-codex:gpt-5.6-sol",
      provider: "custom-api__remote",
      baseUrl: "https://other.example.com/v1",
    });
    const route = await resolveModelRoute(
      "custom-api__remote:openai-codex:gpt-5.6-sol",
      {
        enabledModels: [
          {
            provider: "custom-api__remote",
            modelId: "openai-codex:gpt-5.6-sol",
          },
        ],
        resolveModel: async () => remoteModel,
        ownPort: OWN_PORT,
      },
    );
    expect(route.provider).toBe("custom-api__remote");
    expect(route.model).toBe(remoteModel);
  });

  it("does not flatten when the server port is unknown", async () => {
    const route = await resolveModelRoute(
      "custom-api__loop:openai-codex:gpt-5.6-sol",
      { enabledModels, resolveModel, ownPort: null },
    );
    expect(route.provider).toBe("custom-api__loop");
    expect(route.model).toBe(loopbackModel);
  });

  it("rejects looping configurations instead of recursing", async () => {
    const selfModel = makeModel({
      id: "self",
      provider: "custom-api__self",
      baseUrl: `http://127.0.0.1:${OWN_PORT}/v1`,
    });
    const options = {
      enabledModels: [{ provider: "custom-api__self", modelId: "self" }],
      resolveModel: async () => selfModel,
      ownPort: OWN_PORT,
    };
    for (const rawModel of ["self", "custom-api__self:self"]) {
      const attempt = resolveModelRoute(rawModel, options);
      await expect(attempt).rejects.toBeInstanceOf(ModelRoutingError);
      await expect(attempt).rejects.toMatchObject({ kind: "loop" });
    }
  });

  it("detects loops spanning multiple loopback providers", async () => {
    const modelA = makeModel({
      id: "custom-api__b:b",
      provider: "custom-api__a",
      baseUrl: `http://127.0.0.1:${OWN_PORT}/v1`,
    });
    const modelB = makeModel({
      id: "custom-api__a:custom-api__b:b",
      provider: "custom-api__b",
      baseUrl: `http://localhost:${OWN_PORT}/v1`,
    });
    const attempt = resolveModelRoute("custom-api__a:custom-api__b:b", {
      enabledModels: [
        { provider: "custom-api__a", modelId: "custom-api__b:b" },
        { provider: "custom-api__b", modelId: "custom-api__a:custom-api__b:b" },
      ],
      resolveModel: async (provider) =>
        provider === "custom-api__a" ? modelA : modelB,
      ownPort: OWN_PORT,
    });
    await expect(attempt).rejects.toMatchObject({ kind: "loop" });
  });

  it("reports unknown and unresolvable models as not_found", async () => {
    await expect(
      resolveModelRoute("missing-model", {
        enabledModels,
        resolveModel,
        ownPort: OWN_PORT,
      }),
    ).rejects.toMatchObject({ kind: "not_found" });

    await expect(
      resolveModelRoute("orphan", {
        enabledModels: [{ provider: "openrouter", modelId: "orphan" }],
        resolveModel: async () => null,
        ownPort: OWN_PORT,
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});
