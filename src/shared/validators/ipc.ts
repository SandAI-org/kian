import { z } from 'zod';
import { APP_LANGUAGES } from '../i18n';

export const moduleSchema = z.enum(['docs', 'creation', 'assets', 'app']);
export const chatModuleSchema = z.enum(['docs', 'creation', 'assets', 'app', 'main']);
export const chatScopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('project'),
    projectId: z.string().min(1)
  }),
  z.object({
    type: z.literal('main')
  })
]);

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(400).optional(),
  cover: z.string().optional(),
  source: z.enum(['manual', 'agent']).optional()
});

export const projectUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(400).optional().nullable(),
  cover: z.string().optional().nullable()
});

export const docCreateSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(100),
  content: z.string().default('')
});

export const docCreateFolderSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1).max(120)
});

export const docRenameFolderSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1).max(240),
  name: z.string().min(1).max(120)
});

export const docRenameFileSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1).max(240),
  name: z.string().min(1).max(120)
});

export const docDeleteFolderSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1).max(240)
});

export const docUpdateSchema = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
  title: z.string().min(1).max(100).optional(),
  content: z.string().optional(),
  metadataJson: z.string().optional().nullable()
});

export const creationReplaceSchema = z.object({
  projectId: z.string().min(1),
  scenes: z.array(z.record(z.string(), z.any()))
});

export const assetImportSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(['image', 'video', 'audio']),
  name: z.string().min(1),
  path: z.string().min(1),
  duration: z.number().optional(),
  thumbnailPath: z.string().optional(),
  tags: z.array(z.string()).optional()
});

const chatAttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  path: z.string().min(1),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative()
});

export const chatSendSchema = z.object({
  scope: chatScopeSchema,
  module: chatModuleSchema,
  sessionId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  message: z.string().default(''),
  model: z.string().min(1).optional(),
  thinkingLevel: z.enum(['low', 'medium', 'high']).optional(),
  attachments: z.array(chatAttachmentSchema).max(20).optional(),
  contextSnapshot: z.any().optional(),
  skipUserMessagePersistence: z.boolean().optional(),
  delegationContext: z
    .object({
      delegationId: z.string().min(1),
      mainSessionId: z.string().min(1),
      source: z.literal('main'),
      projectId: z.string().min(1),
      projectName: z.string().min(1)
    })
    .optional()
}).refine(
  (input) => input.message.trim().length > 0 || (input.attachments?.length ?? 0) > 0,
  {
    message: '消息内容或附件至少填写一项',
    path: ['message']
  }
);

export const chatInterruptSchema = z.object({
  scope: chatScopeSchema,
  sessionId: z.string().min(1),
  requestId: z.string().min(1).optional()
});

const chatUploadFileSchema = z.object({
  name: z.string().min(1).max(255),
  sourcePath: z.string().min(1),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional()
});

export const chatUploadFilesSchema = z.object({
  scope: chatScopeSchema,
  files: z.array(chatUploadFileSchema).min(1).max(20)
});

export const fileShowInFinderSchema = z.object({
  filePath: z.string().min(1),
  projectId: z.string().min(1).optional(),
  documentPath: z.string().min(1).max(240).optional()
});

export const fileOpenSchema = z.object({
  filePath: z.string().min(1),
  projectId: z.string().min(1).optional(),
  documentPath: z.string().min(1).max(240).optional()
});

export const filePickForUploadSchema = z.object({}).optional();

export const windowOpenAppPreviewSchema = z.object({
  projectId: z.string().min(1),
  distIndexPath: z.string().min(1),
  builtAt: z.string().min(1),
  appName: z.string().max(200).optional(),
  appType: z
    .enum(['react', 'vue', 'svelte', 'nextjs', 'nuxt', 'angular', 'vanilla', 'unknown'])
    .optional()
});

export const windowOpenUrlSchema = z.object({
  url: z.string().trim().min(1)
});

export const sessionCreateSchema = z.object({
  scope: chatScopeSchema,
  module: chatModuleSchema,
  title: z.string().max(100)
});

export const saveApiKeySchema = z.object({
  provider: z.string().min(1).default('anthropic'),
  enabled: z.boolean(),
  secret: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  enabledModels: z.array(z.string().min(1))
});

const keyboardShortcutSchema = z.object({
  code: z.string().trim().min(1).max(100),
  key: z.string().trim().min(1).max(100),
  metaKey: z.boolean().default(false),
  ctrlKey: z.boolean().default(false),
  altKey: z.boolean().default(false),
  shiftKey: z.boolean().default(false)
});

export const saveShortcutConfigSchema = z.object({
  sendMessage: keyboardShortcutSchema,
  insertNewline: keyboardShortcutSchema,
  focusMainAgentInput: keyboardShortcutSchema,
  openSettingsPage: keyboardShortcutSchema,
  newChatSession: keyboardShortcutSchema,
  quickLauncher: keyboardShortcutSchema
});

export const saveGeneralConfigSchema = z.object({
  workspaceRoot: z.string(),
  language: z.enum(APP_LANGUAGES).default('zh-CN'),
  linkOpenMode: z.enum(['builtin', 'system']).default('builtin'),
  mainSubModeEnabled: z.boolean().default(true),
  quickGuideDismissed: z.boolean().optional(),
  chatInputShortcutTipDismissed: z.boolean().optional()
});

export const saveModelProviderConfigSchema = z.object({
  provider: z.enum(['fal']).default('fal'),
  secret: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  enabledModels: z.array(z.string().trim()).optional()
});

export const saveTelegramChatChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  userIds: z.array(z.string().trim()).max(100).default([])
});

const botTokenSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));
const feishuAppIdSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));
const feishuAppSecretSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));
const feishuWebhookSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((value) => {
    if (!value) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "Webhook 必须为合法的 https URL");

const discordServerIdsSchema = z
  .array(z.string().trim())
  .max(100)
  .default([]);
const discordChannelIdsSchema = z
  .array(z.string().trim())
  .max(100)
  .default([]);

export const saveDiscordChatChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: botTokenSchema,
  serverIds: discordServerIdsSchema,
  channelIds: discordChannelIdsSchema
});

export const saveFeishuChatChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  appId: feishuAppIdSchema,
  appSecret: feishuAppSecretSchema
});

export const saveBroadcastChannelConfigSchema = z.object({
  channels: z
    .array(
      z.object({
        id: z.string().trim().regex(/^[1-9]\d*$/, "ID 必须为正整数").optional(),
        name: z.string().trim().max(120),
        type: z.enum(["feishu", "wechat"]).default("feishu"),
        webhook: z.string().trim(),
      }),
    )
    .max(200)
    .default([]),
});

const stringMapSchema = z
  .record(z.string(), z.string())
  .default({})
  .transform((value) =>
    Object.fromEntries(
      Object.entries(value).reduce<Array<[string, string]>>((acc, [key, item]) => {
        const normalizedKey = key.trim();
        if (!normalizedKey) return acc;
        acc.push([normalizedKey, item.trim()]);
        return acc;
      }, [])
    )
  );

const mcpServerPayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    transport: z.enum(["stdio", "sse", "streamable-http"]),
    enabled: z.boolean().default(true),
    command: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    args: z
      .array(z.string().trim().max(200))
      .max(50)
      .default([])
      .transform((value) => value.filter((item) => item.length > 0)),
    cwd: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    env: stringMapSchema,
    url: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    headers: stringMapSchema,
  })
  .superRefine((value, ctx) => {
    if (value.transport === "stdio") {
      if (!value.command) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "stdio 类型必须提供命令",
          path: ["command"],
        });
      }
      return;
    }

    if (!value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HTTP 类型必须提供 URL",
        path: ["url"],
      });
      return;
    }

    try {
      const parsed = new URL(value.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("invalid protocol");
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL 必须是合法的 http/https 地址",
        path: ["url"],
      });
    }
  });

export const addMcpServerSchema = mcpServerPayloadSchema;

export const updateMcpServerSchema = mcpServerPayloadSchema.extend({
  id: z.string().trim().regex(/^[1-9]\d*$/, "MCP 服务 ID 无效"),
});

export const setMcpServerEnabledSchema = z.object({
  id: z.string().trim().regex(/^[1-9]\d*$/, "MCP 服务 ID 无效"),
  enabled: z.boolean(),
});

export const cronjobSetStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['active', 'paused'])
});

const taskIdSchema = z
  .string()
  .trim()
  .min(1, '任务 ID 不能为空')
  .max(128, '任务 ID 过长')
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, '任务 ID 格式不正确');

export const taskViewSchema = z.object({
  id: taskIdSchema
});

export const taskDeleteSchema = z.object({
  id: taskIdSchema
});

export const taskStartSchema = z.object({
  id: taskIdSchema
});

export const taskStopSchema = z.object({
  id: taskIdSchema
});

export const taskUpdateSchema = z
  .object({
    id: taskIdSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    command: z.string().max(4000).optional(),
    status: z.enum(['running', 'stopped', 'success']).optional()
  })
  .refine(
    (input) =>
      input.id !== undefined ||
      input.name !== undefined ||
      input.command !== undefined ||
      input.status !== undefined,
    {
      message: '至少传入一个更新字段',
      path: ['id']
    }
  );

export const skillRepositorySchema = z.object({
  repositoryUrl: z.string().trim().min(1).max(500)
});

export const skillInstallSchema = z.object({
  repositoryUrl: z.string().trim().min(1).max(500),
  skillPath: z.string().trim().min(1).max(500)
});

export const skillUninstallSchema = z.object({
  skillId: z.string().trim().min(1).max(1000)
});

export const skillVisibilityUpdateSchema = z.object({
  skillId: z.string().trim().min(1).max(1000),
  mainAgentVisible: z.boolean(),
  projectAgentVisible: z.boolean()
});

export const getAvailableModelsSchema = z.object({
  provider: z.string().min(1)
});

export const updateCheckSchema = z
  .object({
    force: z.boolean().optional()
  })
  .optional();

export const updateQuitAndInstallSchema = z.object({}).optional();
