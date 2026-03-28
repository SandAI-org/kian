import { Type } from "@mariozechner/pi-ai";
import type { ChatScope } from "@shared/types";
import { applyPatch, type Operation } from "fast-json-patch";
import jmespath from "jmespath";
import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBrowserUseTools } from "./browserUseTools";
import { sendFeishuWebhookMessage } from "./chatChannel/feishuWebhookTransport";
import { sendWechatWebhookMessage } from "./chatChannel/wechatWebhookTransport";
import type { CustomToolDef } from "./customTools";
import { buildMediaMarkdown } from "./mediaMarkdown";
import {
  createFalProvider,
  formatFalErrorMessage,
  formatFalModelsForError,
  getFalModelById,
  isFalModelSupported,
} from "./modelProviders/falProvider";
import type {
  GenerateImageInput,
  GenerateVideoInput,
} from "./modelProviders/types";
import { settingsService } from "./settingsService";

const CREATION_DIR_NAME = "creation";
const DSL_BOARD_FILE_NAME = "board.json";
const ASSETS_DIR_NAME = "assets";
const GENERATED_DIR_NAME = "generated";
const ASSETS_META_FILE_NAME = "meta.json";

const SUPPORTED_PATCH_OPS = new Set([
  "add",
  "remove",
  "replace",
  "move",
  "copy",
]);

type PatchOperationInput = {
  op?: unknown;
  path?: unknown;
  from?: unknown;
};

type AssetMetaEntry = {
  source?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  sourceUrl?: string | null;
  parameters?: Record<string, unknown>;
  notes?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type AssetMetaMap = Record<string, AssetMetaEntry>;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

const nowISO = (): string => new Date().toISOString();

const toPosixPath = (value: string): string => value.split(path.sep).join("/");

const isWithinDirectory = (targetPath: string, rootDir: string): boolean => {
  const relative = path.relative(rootDir, targetPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const resolveAssetsDir = (projectCwd: string): string =>
  path.resolve(projectCwd, ASSETS_DIR_NAME);

const resolveAssetsMetaPath = (projectCwd: string): string =>
  path.resolve(projectCwd, ASSETS_DIR_NAME, ASSETS_META_FILE_NAME);

const resolveDslBoardPath = (projectCwd: string): string =>
  path.resolve(projectCwd, CREATION_DIR_NAME, DSL_BOARD_FILE_NAME);

const parseJson = (raw: string, filePath: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `DSL board JSON parse failed (${filePath}): ${toErrorMessage(error)}`,
    );
  }
};

const readAssetMetaMap = async (metaPath: string): Promise<AssetMetaMap> => {
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = parseJson(raw, metaPath);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as AssetMetaMap;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {};
    }
    throw error;
  }
};

const writeAssetMetaMap = async (
  metaPath: string,
  payload: AssetMetaMap,
): Promise<void> => {
  await ensureDir(path.dirname(metaPath));
  await fs.writeFile(metaPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const sanitizeMetaValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      return "[data-uri]";
    }
    return value.length > 300 ? `${value.slice(0, 297)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMetaValue(item));
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source).slice(0, 30)) {
      sanitized[key] = sanitizeMetaValue(child);
    }
    return sanitized;
  }
  return value;
};

const updateGeneratedAssetMeta = async (input: {
  projectCwd: string;
  savedPath: string;
  entry: Omit<AssetMetaEntry, "source" | "createdAt" | "updatedAt">;
}): Promise<void> => {
  const assetsDir = resolveAssetsDir(input.projectCwd);
  const absoluteSavedPath = path.resolve(input.savedPath);
  if (!isWithinDirectory(absoluteSavedPath, assetsDir)) {
    return;
  }

  const relativePath = toPosixPath(path.relative(assetsDir, absoluteSavedPath));
  if (!relativePath || relativePath.startsWith("..")) {
    return;
  }

  const metaPath = resolveAssetsMetaPath(input.projectCwd);
  const metaMap = await readAssetMetaMap(metaPath);
  const timestamp = nowISO();
  metaMap[relativePath] = {
    ...metaMap[relativePath],
    ...input.entry,
    source: GENERATED_DIR_NAME,
    createdAt: metaMap[relativePath]?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  await writeAssetMetaMap(metaPath, metaMap);
};

const readDslBoard = async (boardPath: string): Promise<unknown> => {
  try {
    const raw = await fs.readFile(boardPath, "utf8");
    return parseJson(raw, boardPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {};
    }
    throw error;
  }
};

const writeDslBoard = async (
  boardPath: string,
  payload: unknown,
): Promise<void> => {
  await ensureDir(path.dirname(boardPath));
  await fs.writeFile(
    boardPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
};

const parsePatchOperations = (input: string): Operation[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`patch is not valid JSON: ${toErrorMessage(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("patch must be a JSON array string (RFC 6902)");
  }

  parsed.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`patch[${index}] must be an object`);
    }

    const operation = item as PatchOperationInput;
    if (typeof operation.op !== "string") {
      throw new Error(`patch[${index}].op must be a string`);
    }
    if (!SUPPORTED_PATCH_OPS.has(operation.op)) {
      throw new Error(`patch[${index}].op "${operation.op}" is not supported`);
    }

    if (typeof operation.path !== "string") {
      throw new Error(`patch[${index}].path must be a string`);
    }
    if (operation.path !== "" && !operation.path.startsWith("/")) {
      throw new Error(`patch[${index}].path must be a JSON Pointer`);
    }

    if (
      (operation.op === "move" || operation.op === "copy") &&
      typeof operation.from !== "string"
    ) {
      throw new Error(
        `patch[${index}].from is required for op=${operation.op}`,
      );
    }

    if (
      (operation.op === "move" || operation.op === "copy") &&
      typeof operation.from === "string" &&
      operation.from !== "" &&
      !operation.from.startsWith("/")
    ) {
      throw new Error(`patch[${index}].from must be a JSON Pointer`);
    }
  });

  return parsed as Operation[];
};

const summarizePatchOperations = (operations: Operation[]): string => {
  const lines = operations.map((operation) => {
    const op = operation.op;
    const targetPath = operation.path;

    if ((op === "move" || op === "copy") && "from" in operation) {
      const fromPath = operation.from;
      return `${op} ${fromPath} -> ${targetPath}`;
    }

    return `${op} ${targetPath}`;
  });

  return [
    `applied ${operations.length} operation(s):`,
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
};

const toJsonText = (value: unknown): string => {
  if (value === undefined) {
    return "null";
  }
  return JSON.stringify(value, null, 2);
};

const getFalProviderForGeneration = async (projectCwd: string) => {
  const runtime = await settingsService.getModelProviderRuntime("fal");
  if (!runtime.configured || !runtime.secret) {
    throw new Error("fal Provider 未配置，请先在设置页面填写 fal API Key。");
  }

  const outputDir = path.resolve(
    projectCwd,
    ASSETS_DIR_NAME,
    GENERATED_DIR_NAME,
  );
  await ensureDir(outputDir);

  return {
    provider: createFalProvider({
      apiKey: runtime.secret,
      projectCwd,
      outputDir,
    }),
    enabledModels: runtime.enabledModels,
  };
};

export const createBuiltinTools = (
  projectCwd: string,
  scopeType: ChatScope["type"],
): CustomToolDef[] => {
  const projectAgentOnlyToolNames = new Set(["ReadDsl", "UpdateDsl"]);
  const tools: CustomToolDef[] = [
    {
      name: "ReadDsl",
      label: "ReadDsl",
      description:
        "Query the current workspace creation DSL board (`creation/board.json`) using a JMESPath expression.\n\nParameter: jmespath_expr (required) — JMESPath query expression.\n\nSyntax: @ = root; foo / foo.bar = field and nesting; foo[0] / foo[*].bar = array index and map; foo[?bar==`value`] = filter; keys(@) = all keys at root.\n\nReturns: On success, the query result as JSON string; on failure, an error message.",
      parameters: Type.Object({
        jmespath_expr: Type.String({
          description: "JMESPath query expression; @ denotes the root document",
        }),
      }),
      async handler(input) {
        try {
          const jmespathExpr = input.jmespath_expr as string;
          const boardPath = resolveDslBoardPath(projectCwd);
          const board = await readDslBoard(boardPath);
          const queryResult = jmespath.search(board, jmespathExpr);
          return { text: toJsonText(queryResult) };
        } catch (error) {
          return {
            text: `ReadDsl failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "UpdateDsl",
      label: "UpdateDsl",
      description:
        "Update the current workspace creation DSL board (`creation/board.json`) using JSON Patch (RFC 6902).\n\nParameter: patch (required) — JSON Patch operations array as a JSON string. Supported ops: add, remove, replace, move, copy. Paths are JSON Pointer (e.g. /foo, /foo/bar, /foo/0, /foo/- for append).\n\nReturns: On success, a summary of applied changes (add/remove/replace/move/copy and paths); on failure, an error message.",
      parameters: Type.Object({
        patch: Type.String({
          description: "JSON string of JSON Patch operations array (RFC 6902)",
        }),
      }),
      async handler(input) {
        try {
          const patch = input.patch as string;
          const boardPath = resolveDslBoardPath(projectCwd);
          const currentBoard = await readDslBoard(boardPath);
          const operations = parsePatchOperations(patch);
          const result = applyPatch(currentBoard, operations, true, false);
          await writeDslBoard(boardPath, result.newDocument);
          return { text: summarizePatchOperations(operations) };
        } catch (error) {
          return {
            text: `UpdateDsl failed: ${toErrorMessage(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "GenerateImage",
      label: "GenerateImage",
      description:
        "Generate an image from a prompt and optional reference images. Obtain model_id via the model-selection skill; text-to-image needs only prompt; image-to-image or edit requires images. Supports aspect ratio and resolution options.\n\nReturns: On success, a summary with model, prompt, aspect_ratio, resolution, and saved path; on failure, an error message.",
      parameters: Type.Object({
      model_id: Type.String({
        description:
          "Model id (e.g. fal-ai/bytedance/seedream/v4.5/text-to-image); obtain via model-selection skill",
      }),
      prompt: Type.String({
        description: "Image description or edit instruction",
      }),
      aspect_ratio: Type.Optional(
        Type.Union(
          [
            Type.Literal("auto"),
            Type.Literal("21:9"),
            Type.Literal("16:9"),
            Type.Literal("3:2"),
            Type.Literal("4:3"),
            Type.Literal("5:4"),
            Type.Literal("1:1"),
            Type.Literal("4:5"),
            Type.Literal("3:4"),
            Type.Literal("2:3"),
            Type.Literal("9:16"),
          ],
          {
            description:
              "Output aspect ratio; model-dependent defaults and support",
          },
        ),
      ),
      resolution: Type.Optional(
        Type.Union(
          [
            Type.Literal("4K"),
            Type.Literal("2K"),
            Type.Literal("1K"),
            Type.Literal("1080p"),
            Type.Literal("720p"),
          ],
          {
            description:
              "Output resolution; model-dependent defaults and support",
          },
        ),
      ),
      images: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Reference image paths or URLs for image-to-image or edit",
        }),
      ),
    }),
    async handler(input) {
      try {
        const { model_id, prompt, aspect_ratio, resolution, images } =
          input as unknown as GenerateImageInput;
        if (!isFalModelSupported(model_id)) {
          throw new Error(
            `模型 ${model_id} 不在 fal Provider 支持列表中。支持模型：${formatFalModelsForError()}`,
          );
        }
        const modelMeta = getFalModelById(model_id);
        if (modelMeta?.capability !== "image") {
          throw new Error(`模型 ${model_id} 不是图像模型，请改用图像模型。`);
        }
        const { provider, enabledModels } =
          await getFalProviderForGeneration(projectCwd);
        if (!enabledModels.includes(model_id)) {
          throw new Error(
            `模型 ${model_id} 尚未在设置中启用。已启用：${enabledModels.join(", ") || "（空）"}`,
          );
        }
        const result = await provider.generateImage({
          model_id,
          prompt,
          aspect_ratio,
          resolution,
          images,
        });

        try {
          await updateGeneratedAssetMeta({
            projectCwd,
            savedPath: result.savedPath,
            entry: {
              provider: "fal",
              model: model_id,
              prompt,
              sourceUrl: result.sourceUrl ?? null,
              parameters: {
                capability: "image",
                tool_input: sanitizeMetaValue({
                  aspect_ratio,
                  resolution,
                  images: images ?? [],
                }),
                request_payload: sanitizeMetaValue(result.requestPayload),
              },
              notes: result.notes,
            },
          });
        } catch (metaError) {
          result.notes.push(
            `写入 assets/meta.json 失败: ${toErrorMessage(metaError)}`,
          );
        }

        const summary = {
          provider: "fal",
          model: model_id,
          prompt,
          aspect_ratio,
          resolution,
          references: images ?? [],
          saved_path: result.savedPath,
          preview_markdown: buildMediaMarkdown("image", result.savedPath),
          source_url: result.sourceUrl ?? null,
          notes: result.notes,
        };

        return { text: toJsonText(summary) };
      } catch (error) {
        return {
          text: `GenerateImage failed: ${formatFalErrorMessage(error)}`,
          isError: true,
        };
      }
    },
    },
  {
    name: "GenerateVideo",
    label: "GenerateVideo",
    description:
      "Generate video from a model and optional image references. Supports text-to-video, image-to-video, first/last-frame mode, and model-specific controls like duration, safety checker, camera lock, and optional audio for supported models.\n\nReturns: On success, a summary with model, prompt, request parameters, and saved path; on failure, an error message.",
    parameters: Type.Object({
      model_id: Type.String({
        description:
          "Model id (e.g. fal-ai/bytedance/seedance/v1.5/pro/image-to-video); obtain via model-selection skill",
      }),
      prompt: Type.Optional(
        Type.String({ description: "Video effect or motion description" }),
      ),
      start_image: Type.Optional(
        Type.String({ description: "Start frame image path or URL" }),
      ),
      end_image: Type.Optional(
        Type.String({
          description: "End frame image path or URL (dual-frame mode)",
        }),
      ),
      aspect_ratio: Type.Optional(
        Type.Union(
          [
            Type.Literal("auto"),
            Type.Literal("auto_prefer_portrait"),
            Type.Literal("21:9"),
            Type.Literal("16:9"),
            Type.Literal("4:3"),
            Type.Literal("1:1"),
            Type.Literal("3:4"),
            Type.Literal("9:16"),
          ],
          {
            description:
              "Output aspect ratio; model-dependent defaults and support",
          },
        ),
      ),
      resolution: Type.Optional(
        Type.Union(
          [
            Type.Literal("4k"),
            Type.Literal("2k"),
            Type.Literal("1080p"),
            Type.Literal("720p"),
            Type.Literal("480p"),
          ],
          {
            description:
              "Output resolution; model-dependent defaults and support",
          },
        ),
      ),
      duration: Type.Optional(
        Type.Union([Type.String(), Type.Number()], {
          description: "Video duration in seconds; depends on model support",
        }),
      ),
      enable_audio: Type.Optional(
        Type.Boolean({
          description:
            "Whether to generate audio; model-dependent support (e.g. Seedance v1.5 Pro / some Kling & Veo variants)",
        }),
      ),
      camera_fixed: Type.Optional(
        Type.Boolean({
          description:
            "Lock camera trajectory for a steadier shot; depends on model support",
        }),
      ),
      seed: Type.Optional(
        Type.Union([Type.String(), Type.Number()], {
          description: "Random seed for reproducibility; integer only",
        }),
      ),
      enable_safety_checker: Type.Optional(
        Type.Boolean({
          description:
            "Enable safety checker; default true when model supports",
        }),
      ),
      audio: Type.Optional(
        Type.String({
          description:
            "Reserved for external audio workflows; currently ignored by built-in fal provider",
        }),
      ),
      elements: Type.Optional(
        Type.Array(
          Type.Object({
            frontal_image: Type.Optional(
              Type.String({ description: "Front reference image path or URL" }),
            ),
            reference_images: Type.Optional(
              Type.Array(Type.String(), {
                description: "Multi-angle reference image paths or URLs",
              }),
            ),
            video: Type.Optional(
              Type.String({ description: "Reference video path or URL" }),
            ),
          }),
          {
            description:
              "Reference elements; reference_images will be used by reference-to-video capable models",
          },
        ),
      ),
    }),
    async handler(input) {
      try {
        const {
          model_id,
          prompt,
          start_image,
          end_image,
          aspect_ratio,
          resolution,
          duration,
          enable_audio,
          camera_fixed,
          seed,
          enable_safety_checker,
          audio,
          elements,
        } = input as unknown as GenerateVideoInput;
        if (!isFalModelSupported(model_id)) {
          throw new Error(
            `模型 ${model_id} 不在 fal Provider 支持列表中。支持模型：${formatFalModelsForError()}`,
          );
        }
        const modelMeta = getFalModelById(model_id);
        if (modelMeta?.capability !== "video") {
          throw new Error(`模型 ${model_id} 不是视频模型，请改用视频模型。`);
        }
        const { provider, enabledModels } =
          await getFalProviderForGeneration(projectCwd);
        if (!enabledModels.includes(model_id)) {
          throw new Error(
            `模型 ${model_id} 尚未在设置中启用。已启用：${enabledModels.join(", ") || "（空）"}`,
          );
        }
        const result = await provider.generateVideo({
          model_id,
          prompt,
          start_image,
          end_image,
          aspect_ratio,
          resolution,
          duration,
          enable_audio,
          camera_fixed,
          seed,
          enable_safety_checker,
          audio,
          elements,
        });

        try {
          await updateGeneratedAssetMeta({
            projectCwd,
            savedPath: result.savedPath,
            entry: {
              provider: "fal",
              model: model_id,
              prompt: prompt ?? "",
              sourceUrl: result.sourceUrl ?? null,
              parameters: {
                capability: "video",
                tool_input: sanitizeMetaValue({
                  start_image: start_image ?? null,
                  end_image: end_image ?? null,
                  aspect_ratio: aspect_ratio ?? null,
                  resolution: resolution ?? null,
                  duration: duration ?? null,
                  enable_audio: enable_audio ?? null,
                  camera_fixed: camera_fixed ?? null,
                  seed: seed ?? null,
                  enable_safety_checker: enable_safety_checker ?? null,
                  audio: audio ?? null,
                  elements: elements ?? [],
                }),
                request_payload: sanitizeMetaValue(result.requestPayload),
              },
              notes: result.notes,
            },
          });
        } catch (metaError) {
          result.notes.push(
            `写入 assets/meta.json 失败: ${toErrorMessage(metaError)}`,
          );
        }

        const requestPayload = result.requestPayload as Record<string, unknown>;
        const summary = {
          provider: "fal",
          model: model_id,
          prompt: prompt ?? "",
          start_image: start_image ?? null,
          end_image: end_image ?? null,
          aspect_ratio: requestPayload.aspect_ratio ?? null,
          resolution: requestPayload.resolution ?? null,
          duration: requestPayload.duration ?? null,
          generate_audio: requestPayload.generate_audio ?? null,
          camera_fixed: requestPayload.camera_fixed ?? null,
          seed: requestPayload.seed ?? null,
          enable_safety_checker: requestPayload.enable_safety_checker ?? null,
          saved_path: result.savedPath,
          preview_markdown: buildMediaMarkdown("video", result.savedPath),
          source_url: result.sourceUrl ?? null,
          notes: result.notes,
        };

        return { text: toJsonText(summary) };
      } catch (error) {
        return {
          text: `GenerateVideo failed: ${formatFalErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "ListBroadcastChannels",
    label: "ListBroadcastChannels",
    description: "列出已配置的广播渠道，返回每个渠道的 id、名称和类型。",
    parameters: Type.Object({}),
    async handler() {
      try {
        const channels = await settingsService.getBroadcastChannels();
        if (channels.length === 0) {
          return { text: "当前没有可用的广播渠道。" };
        }
        const payload = channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
        }));
        return { text: toJsonText(payload) };
      } catch (error) {
        return {
          text: `ListBroadcastChannels failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "broadcast",
    label: "broadcast",
    description:
      "通过指定广播渠道 ID，单向发送一条消息到该渠道对应的机器人（支持飞书和企业微信）。",
    parameters: Type.Object({
      id: Type.String({ description: "广播渠道 ID" }),
      message: Type.String({
        description: "需要广播的消息内容（Markdown 格式）",
      }),
    }),
    async handler(input) {
      try {
        const channelId = typeof input.id === "string" ? input.id.trim() : "";
        const message =
          typeof input.message === "string" ? input.message.trim() : "";
        if (!channelId) {
          throw new Error("id 不能为空");
        }
        if (!message) {
          throw new Error("message 不能为空");
        }

        const channel =
          await settingsService.getBroadcastChannelById(channelId);
        if (!channel) {
          throw new Error(`未找到广播渠道：${channelId}`);
        }
        if (!channel.webhook) {
          throw new Error(`广播渠道 ${channel.name} 未配置 Webhook`);
        }

        let computerName: string;
        if (process.platform === "darwin") {
          try {
            computerName = execSync("scutil --get ComputerName", {
              encoding: "utf-8",
            }).trim();
          } catch {
            computerName = os.hostname();
          }
        } else {
          computerName = os.hostname();
        }
        if (channel.type === "wechat") {
          await sendWechatWebhookMessage(
            channel.webhook,
            `${message}\n\n<font color="comment">来自 ${computerName}</font>`,
          );
        } else {
          const feishuRuntime =
            await settingsService.getFeishuChatChannelRuntime();
          const feishuToken =
            feishuRuntime.appId?.trim() && feishuRuntime.appSecret?.trim()
              ? `${feishuRuntime.appId.trim()}:${feishuRuntime.appSecret.trim()}`
              : undefined;
          await sendFeishuWebhookMessage(
            channel.webhook,
            `${message}\n\n*来自 ${computerName}*`,
            {
              token: feishuToken,
            },
          );
        }
        return {
          text: `广播发送成功：渠道「${channel.name}」(${channel.id})`,
        };
      } catch (error) {
        return {
          text: `broadcast failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
    ...createBrowserUseTools(projectCwd),
  ];

  if (scopeType === "project") {
    return tools;
  }

  return tools.filter((tool) => !projectAgentOnlyToolNames.has(tool.name));
};
