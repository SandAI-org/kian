import { completeSimple, streamSimple } from "@earendil-works/pi-ai/compat";
import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { OpenaiCompatServerStatusDTO } from "@shared/types";
import { getSharedAuthStorage } from "../authStorageService";
import { logger } from "../logger";
import { settingsService } from "../settingsService";
import {
  ModelRoutingError,
  isCustomApiProvider,
  resolveModelRoute,
  type ResolvedModelRoute,
} from "./routing";
import {
  OpenAiRequestError,
  StreamTranslator,
  translateRequest,
  translateResponse,
  type OpenAiChatCompletionRequest,
} from "./translate";

const HOST = "127.0.0.1";
const BODY_LIMIT_BYTES = 20 * 1024 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
} as const;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

const sendJson = (
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(body));
};

const sendError = (res: http.ServerResponse, error: HttpError): void => {
  sendJson(res, error.status, {
    error: { message: error.message, type: error.type, code: error.code },
  });
};

const writeSse = (res: http.ServerResponse, payload: unknown): void => {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const readJsonBody = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT_BYTES) {
      throw new HttpError(413, "invalid_request_error", "request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_request_error", "request body is not valid JSON");
  }
};

const checkAuth = (req: http.IncomingMessage, token: string): void => {
  const header = req.headers.authorization ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(token).digest();
  if (!provided || !timingSafeEqual(providedHash, expectedHash)) {
    throw new HttpError(401, "authentication_error", "invalid or missing API key");
  }
};

const resolveRequestedModel = async (rawModel: string) => {
  const status = await settingsService.getClaudeStatus({ type: "main" });
  let route: ResolvedModelRoute;
  try {
    route = await resolveModelRoute(rawModel, {
      enabledModels: status.allEnabledModels,
      resolveModel: (routeProvider, routeModelId) =>
        settingsService.resolveAgentModel(routeProvider, routeModelId),
      ownPort: runningPort,
    });
  } catch (error) {
    if (error instanceof ModelRoutingError) {
      throw error.kind === "loop"
        ? new HttpError(400, "invalid_request_error", error.message)
        : new HttpError(
            404,
            "invalid_request_error",
            error.message,
            "model_not_found",
          );
    }
    throw error;
  }

  const { provider, model } = route;
  logger.info("OpenAI compat model resolved", {
    requested: rawModel,
    provider,
    modelId: model.id,
  });
  const providerEntry = status.providers[provider];
  const apiKey =
    providerEntry?.apiKey ||
    (await settingsService.getClaudeSecret(provider)) ||
    (await getSharedAuthStorage()
      .getApiKey(provider)
      .catch(() => undefined)) ||
    (isCustomApiProvider(provider) ? "kian-custom-api-no-auth" : undefined);
  if (!apiKey) {
    throw new HttpError(
      502,
      "api_error",
      `no credential configured for provider: ${provider}`,
    );
  }

  return { model, apiKey };
};

const handleModels = async (res: http.ServerResponse): Promise<void> => {
  const status = await settingsService.getClaudeStatus({ type: "main" });
  sendJson(res, 200, {
    object: "list",
    data: status.allEnabledModels.map((m) => ({
      id: `${m.provider}:${m.modelId}`,
      object: "model",
      created: 0,
      owned_by: m.provider,
    })),
  });
};

const handleChatCompletions = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> => {
  const body = (await readJsonBody(req)) as OpenAiChatCompletionRequest;
  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, "invalid_request_error", "request body must be a JSON object");
  }
  const rawModel = typeof body.model === "string" ? body.model : "";
  const { model, apiKey } = await resolveRequestedModel(rawModel);
  const translated = await translateRequest(body, model);

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  const options = {
    apiKey,
    signal: abortController.signal,
    temperature: translated.temperature,
    maxTokens: translated.maxTokens,
    reasoning: translated.reasoning,
  };

  if (body.stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...CORS_HEADERS,
    });
    const translator = new StreamTranslator(rawModel);
    const stream = streamSimple(model, translated.context, options);
    for await (const event of stream) {
      if (event.type === "error") {
        writeSse(res, {
          error: {
            message: event.error.errorMessage ?? "provider error",
            type: "api_error",
            code: null,
          },
        });
        break;
      }
      for (const chunk of translator.translate(event)) {
        writeSse(res, chunk);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const message = await completeSimple(model, translated.context, options);
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new HttpError(502, "api_error", message.errorMessage ?? "provider error");
  }
  sendJson(res, 200, translateResponse(message, rawModel));
};

const handleRequest = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string | null,
): Promise<void> => {
  const pathname = (req.url ?? "").split("?")[0];
  if (req.method !== "OPTIONS") {
    logger.info("OpenAI compat server request", {
      method: req.method,
      path: pathname,
    });
  }
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (req.method === "GET" && pathname === "/healthz") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (token !== null) {
      checkAuth(req, token);
    }
    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      await handleModels(res);
      return;
    }
    if (
      req.method === "POST" &&
      (pathname === "/v1/chat/completions" || pathname === "/chat/completions")
    ) {
      await handleChatCompletions(req, res);
      return;
    }
    throw new HttpError(
      404,
      "invalid_request_error",
      `unknown route: ${req.method} ${pathname}`,
    );
  } catch (error) {
    logger.warn("OpenAI compat server request failed", {
      method: req.method,
      path: pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    if (res.headersSent) {
      // Streaming already started; the SSE error frame is the best we can do.
      res.end();
      return;
    }
    if (error instanceof HttpError) {
      sendError(res, error);
    } else if (error instanceof OpenAiRequestError) {
      sendError(res, new HttpError(400, "invalid_request_error", error.message));
    } else {
      sendError(
        res,
        new HttpError(
          500,
          "api_error",
          error instanceof Error ? error.message : "internal error",
        ),
      );
    }
  }
};

let server: http.Server | null = null;
let runningPort: number | null = null;
let lastError: string | null = null;

const startServer = async (): Promise<void> => {
  const config = (await settingsService.getGeneralConfig()).openaiCompatServer;
  lastError = null;
  if (!config.enabled || (config.requireToken && !config.token)) {
    return;
  }
  const token = config.requireToken ? config.token : null;
  const instance = http.createServer((req, res) => {
    void handleRequest(req, res, token);
  });
  await new Promise<void>((resolve) => {
    instance.once("error", (error) => {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn("OpenAI compat server failed to start", {
        port: config.port,
        error: lastError,
      });
      resolve();
    });
    instance.listen(config.port, HOST, () => {
      server = instance;
      runningPort = config.port;
      logger.info("OpenAI compat server listening", { port: config.port });
      resolve();
    });
  });
};

const stopServer = async (): Promise<void> => {
  const instance = server;
  server = null;
  runningPort = null;
  if (!instance) return;
  await new Promise<void>((resolve) => {
    instance.close(() => resolve());
    // Keep-alive and SSE connections would otherwise hold close() open.
    instance.closeAllConnections();
  });
};

export const openaiCompatServer = {
  start: startServer,
  stop: stopServer,
  async restart(): Promise<void> {
    await stopServer();
    await startServer();
  },
  getStatus(): OpenaiCompatServerStatusDTO {
    return {
      running: server !== null,
      port: runningPort,
      lastError,
    };
  },
};
