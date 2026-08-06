import type { Api, Model } from "@earendil-works/pi-ai";

/** Model routing failure; `kind` picks the HTTP status the server maps it to. */
export class ModelRoutingError extends Error {
  constructor(
    readonly kind: "not_found" | "loop",
    message: string,
  ) {
    super(message);
  }
}

export interface EnabledModelEntry {
  provider: string;
  modelId: string;
}

export const isCustomApiProvider = (provider: string): boolean =>
  provider === "custom-api" || provider.startsWith("custom-api__");

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** True when baseUrl targets this server's own listen address. */
export const isSelfBaseUrl = (baseUrl: string, ownPort: number): boolean => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
    return false;
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  return port === ownPort;
};

/**
 * "<provider>:<modelId>" prefix matches win over bare model ids so the ids
 * advertised by /v1/models always route to the provider they name; bare
 * matching remains as a fallback because bare Bedrock model ids legitimately
 * contain colons.
 */
const findEnabledModel = (
  entries: readonly EnabledModelEntry[],
  rawModel: string,
): EnabledModelEntry | undefined => {
  const separator = rawModel.indexOf(":");
  if (separator > 0) {
    const provider = rawModel.slice(0, separator);
    const modelId = rawModel.slice(separator + 1);
    const prefixed = entries.find(
      (entry) => entry.provider === provider && entry.modelId === modelId,
    );
    if (prefixed) {
      return prefixed;
    }
  }
  return entries.find((entry) => entry.modelId === rawModel);
};

export interface ResolvedModelRoute {
  provider: string;
  modelId: string;
  model: Model<Api>;
}

/**
 * Resolves rawModel to a concrete model. Providers whose baseUrl points back
 * at this server are followed in-process instead of proxied to ourselves over
 * HTTP, and loops in that chain fail fast instead of recursing.
 */
export const resolveModelRoute = async (
  rawModel: string,
  options: {
    enabledModels: readonly EnabledModelEntry[];
    resolveModel: (
      provider: string,
      modelId: string,
    ) => Promise<Model<Api> | null>;
    ownPort: number | null;
  },
): Promise<ResolvedModelRoute> => {
  const visited = new Set<string>();
  let current = rawModel;
  for (;;) {
    const entry = findEnabledModel(options.enabledModels, current);
    if (!entry) {
      throw new ModelRoutingError(
        "not_found",
        `model not found or not enabled: ${current}`,
      );
    }
    const key = `${entry.provider}\u{0}${entry.modelId}`;
    if (visited.has(key)) {
      throw new ModelRoutingError(
        "loop",
        `model configuration loops back to itself: ${rawModel}`,
      );
    }
    visited.add(key);
    const model = await options.resolveModel(entry.provider, entry.modelId);
    if (!model) {
      throw new ModelRoutingError(
        "not_found",
        `model could not be resolved: ${current}`,
      );
    }
    if (
      options.ownPort !== null &&
      isSelfBaseUrl(model.baseUrl, options.ownPort)
    ) {
      current = model.id;
      continue;
    }
    return { provider: entry.provider, modelId: entry.modelId, model };
  }
};
