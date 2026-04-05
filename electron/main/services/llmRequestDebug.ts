import { streamSimple } from "@mariozechner/pi-ai";
import type { ChatScope } from "@shared/types";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { INTERNAL_ROOT, WORKSPACE_ROOT } from "./workspacePaths";

type LlmRequestDebugMetadata = {
  kind: "agent" | "auto_title";
  requestId?: string;
  scope?: string;
  chatSessionId?: string;
  module?: string;
  provider?: string;
  modelId?: string;
  modelSource?: string;
  api?: string;
  cwd?: string;
};

const isDevelopmentMode =
  !(app?.isPackaged ?? false) || process.env.NODE_ENV === "development";

type AgentLike = {
  streamFn?:
    | ((
        ...args: Parameters<typeof streamSimple>
      ) => ReturnType<typeof streamSimple> | Promise<ReturnType<typeof streamSimple>>)
    | undefined;
};

const DATA_URL_PREFIX = /^data:[^;]+;base64,/i;
const BASE64_BODY = /^[A-Za-z0-9+/=\s]+$/;
const MIN_BINARY_STRING_LENGTH = 2_048;

const isLargeBinaryLikeString = (value: string): boolean => {
  if (DATA_URL_PREFIX.test(value)) {
    return true;
  }
  return (
    value.length >= MIN_BINARY_STRING_LENGTH &&
    !/\s/.test(value) &&
    BASE64_BODY.test(value)
  );
};

const sanitizePayloadForLog = (payload: unknown): unknown => {
  const json = JSON.stringify(payload, (_key, value: unknown) => {
    if (typeof value === "string" && isLargeBinaryLikeString(value)) {
      return `[omitted binary string length=${value.length}]`;
    }
    return value;
  });

  return json ? (JSON.parse(json) as unknown) : payload;
};

const writeLlmRequestPayloadFile = async (
  metadata: LlmRequestDebugMetadata,
  payload: unknown,
): Promise<string | null> => {
  if (!isDevelopmentMode) {
    return null;
  }

  const record = {
    ...metadata,
    payload: sanitizePayloadForLog(payload),
  };
  const cwd = metadata.cwd?.trim();
  if (!cwd) {
    return null;
  }
  const debugDir = path.join(cwd, ".debug");
  const requestPart = metadata.requestId?.trim() || "request";
  const filePath = path.join(
    debugDir,
    `llm-request-${Date.now()}-${requestPart}-${randomUUID()}.json`,
  );
  await mkdir(debugDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return filePath;
};

const logLlmRequestPayload = (metadata: LlmRequestDebugMetadata, payload: unknown): void => {
  void writeLlmRequestPayloadFile(metadata, payload)
    .then((filePath) => {
      if (!filePath) {
        return;
      }
      console.info("[kian][info] LLM request payload file written (development)", {
        kind: metadata.kind,
        requestId: metadata.requestId,
        scope: metadata.scope,
        chatSessionId: metadata.chatSessionId,
        module: metadata.module,
        provider: metadata.provider,
        modelId: metadata.modelId,
        modelSource: metadata.modelSource,
        api: metadata.api,
        filePath,
      });
    })
    .catch((error) => {
      console.warn("[kian][warn] Failed to write LLM request payload file (development)", {
        kind: metadata.kind,
        requestId: metadata.requestId,
        scope: metadata.scope,
        chatSessionId: metadata.chatSessionId,
        module: metadata.module,
        error: error instanceof Error ? error.message : String(error),
      });
    });
};

export const createLlmRequestDebugOnPayload = (
  getMetadata: () => LlmRequestDebugMetadata,
): ((payload: unknown) => void) => {
  return (payload: unknown): void => {
    logLlmRequestPayload(getMetadata(), payload);
  };
};

export const getLlmRequestDebugCwdForScope = (scope: ChatScope): string =>
  scope.type === "main"
    ? path.join(INTERNAL_ROOT, "main-agent")
    : path.resolve(WORKSPACE_ROOT, scope.projectId);

export const attachAgentLlmRequestDebug = (
  agent: AgentLike | null | undefined,
  getMetadata: () => LlmRequestDebugMetadata,
): void => {
  if (!agent) {
    return;
  }

  const debugOnPayload = createLlmRequestDebugOnPayload(getMetadata);
  const wrappedStreamFn = (
    model: Parameters<typeof streamSimple>[0],
    context: Parameters<typeof streamSimple>[1],
    options?: Parameters<typeof streamSimple>[2],
  ) =>
    streamSimple(model, context, {
      ...options,
      onPayload: (payload) => {
        options?.onPayload?.(payload);
        debugOnPayload(payload);
      },
    });

  agent.streamFn = wrappedStreamFn;
};
