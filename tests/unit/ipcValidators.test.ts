import { describe, expect, it } from 'vitest';
import {
  addMcpServerSchema,
  chatSendSchema,
  chatUploadFilesSchema,
  projectCreateSchema,
  saveApiKeySchema,
  saveGeneralConfigSchema,
  sessionCreateSchema,
  saveBroadcastChannelConfigSchema,
  saveDiscordChatChannelConfigSchema,
  saveFeishuChatChannelConfigSchema,
  saveModelProviderConfigSchema,
  saveTelegramChatChannelConfigSchema,
  skillVisibilityUpdateSchema,
  updateMcpServerSchema,
  windowOpenUrlSchema
} from '../../src/shared/validators/ipc';

describe('ipc validators', () => {
  it('validates project create payload', () => {
    const result = projectCreateSchema.safeParse({ name: 'demo', description: 'desc' });
    expect(result.success).toBe(true);
  });

  it('allows project create payload without name', () => {
    const result = projectCreateSchema.safeParse({ description: 'desc only' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid chat payload', () => {
    const result = chatSendSchema.safeParse({
      scope: { type: 'project', projectId: 'p1' },
      module: 'wrong',
      sessionId: 's1',
      message: ''
    });
    expect(result.success).toBe(false);
  });

  it('allows chat payload with attachments only', () => {
    const result = chatSendSchema.safeParse({
      scope: { type: 'project', projectId: 'p1' },
      module: 'docs',
      sessionId: 's1',
      message: '',
      attachments: [
        {
          name: 'sample.pdf',
          path: 'assets/user_files/sample.pdf',
          size: 128
        }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('validates app module chat payload', () => {
    const result = chatSendSchema.safeParse({
      scope: { type: 'project', projectId: 'p1' },
      module: 'app',
      sessionId: 's1',
      message: 'build app'
    });
    expect(result.success).toBe(true);
  });

  it('allows chat payload beyond 8000 characters', () => {
    const result = chatSendSchema.safeParse({
      scope: { type: 'project', projectId: 'p1' },
      module: 'docs',
      sessionId: 's1',
      message: 'a'.repeat(8_001)
    });
    expect(result.success).toBe(true);
  });

  it('validates upload files payload', () => {
    const result = chatUploadFilesSchema.safeParse({
      scope: { type: 'project', projectId: 'p1' },
      files: [
        {
          name: 'script.docx',
          sourcePath: '/tmp/script.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('validates main agent chat payload', () => {
    const result = chatSendSchema.safeParse({
      scope: { type: 'main' },
      module: 'main',
      sessionId: 's1',
      message: 'delegate this task'
    });
    expect(result.success).toBe(true);
  });

  it('allows creating a session with empty title', () => {
    const result = sessionCreateSchema.safeParse({
      scope: { type: 'main' },
      module: 'main',
      title: ''
    });
    expect(result.success).toBe(true);
  });

  it('validates telegram chat channel payload', () => {
    const result = saveTelegramChatChannelConfigSchema.safeParse({
      enabled: true,
      botToken: '123456789:abcdefghijk',
      userIds: ['12345678', '87654321']
    });
    expect(result.success).toBe(true);
  });

  it('allows telegram payload without user_id', () => {
    const result = saveTelegramChatChannelConfigSchema.safeParse({
      enabled: true,
      botToken: '123456789:abcdefghijk',
      userIds: []
    });
    expect(result.success).toBe(true);
  });

  it('validates discord chat channel payload', () => {
    const result = saveDiscordChatChannelConfigSchema.safeParse({
      enabled: true,
      botToken: 'discord_bot_token_demo',
      serverIds: ['111111111111111111'],
      channelIds: ['222222222222222222']
    });
    expect(result.success).toBe(true);
  });

  it('allows non-numeric discord server_id/channel_id', () => {
    const result = saveDiscordChatChannelConfigSchema.safeParse({
      enabled: true,
      botToken: 'discord_bot_token_demo',
      serverIds: ['guild_demo'],
      channelIds: ['channel_demo']
    });
    expect(result.success).toBe(true);
  });

  it('allows discord payload without bot token when enabled', () => {
    const result = saveDiscordChatChannelConfigSchema.safeParse({
      enabled: true,
      botToken: '',
      serverIds: ['111111111111111111'],
      channelIds: ['222222222222222222']
    });
    expect(result.success).toBe(true);
  });

  it('allows discord payload with empty server_id and channel_id', () => {
    const result = saveDiscordChatChannelConfigSchema.safeParse({
      enabled: true,
      botToken: 'discord_bot_token_demo',
      serverIds: [],
      channelIds: []
    });
    expect(result.success).toBe(true);
  });

  it('validates model provider payload without enabled models', () => {
    const result = saveModelProviderConfigSchema.safeParse({
      provider: 'fal',
      secret: 'fal_api_key_demo'
    });
    expect(result.success).toBe(true);
  });

  it('allows empty enabled models when provided', () => {
    const result = saveModelProviderConfigSchema.safeParse({
      provider: 'fal',
      secret: 'fal_api_key_demo',
      enabledModels: []
    });
    expect(result.success).toBe(true);
  });

  it('validates language model provider payload with baseUrl and custom models', () => {
    const result = saveApiKeySchema.safeParse({
      provider: 'openai',
      enabled: true,
      secret: 'sk_test_custom_model',
      baseUrl: 'https://proxy.example.com/v1',
      api: 'openai-completions',
      customModels: [
        {
          id: 'gpt-4.1-custom',
          name: 'GPT 4.1 Custom',
          reasoning: true,
          input: ['text', 'image'],
          contextWindow: 256000,
          maxTokens: 32768,
        },
      ],
      enabledModels: ['gpt-4.1-custom'],
    });
    expect(result.success).toBe(true);
  });

  it('validates feishu chat channel payload', () => {
    const result = saveFeishuChatChannelConfigSchema.safeParse({
      enabled: true,
      appId: 'cli_xxx',
      appSecret: 'sec_xxx'
    });
    expect(result.success).toBe(true);
  });

  it('allows feishu payload without app credentials when enabled', () => {
    const result = saveFeishuChatChannelConfigSchema.safeParse({
      enabled: true,
      appId: '',
      appSecret: ''
    });
    expect(result.success).toBe(true);
  });

  it('validates broadcast channel payload', () => {
    const result = saveBroadcastChannelConfigSchema.safeParse({
      channels: [
        {
          name: '测试渠道',
          webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('validates general config payload', () => {
    const result = saveGeneralConfigSchema.safeParse({
      workspaceRoot: '/tmp/workspace',
      language: 'en-US',
      linkOpenMode: 'system',
      quickGuideDismissed: true
    });
    expect(result.success).toBe(true);
  });

  it('defaults link open mode for general config payload', () => {
    const result = saveGeneralConfigSchema.safeParse({
      workspaceRoot: '/tmp/workspace'
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.language).toBe('zh-CN');
    expect(result.data.linkOpenMode).toBe('builtin');
  });

  it('validates window open url payload', () => {
    const result = windowOpenUrlSchema.safeParse({
      url: 'https://example.com/docs'
    });
    expect(result.success).toBe(true);
  });

  it('validates MCP add payload', () => {
    const result = addMcpServerSchema.safeParse({
      name: 'Filesystem MCP',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem']
    });
    expect(result.success).toBe(true);
  });

  it('validates MCP update payload', () => {
    const result = updateMcpServerSchema.safeParse({
      id: '1',
      name: 'Remote MCP',
      transport: 'streamable-http',
      url: 'https://example.com/mcp'
    });
    expect(result.success).toBe(true);
  });

  it('allows empty webhook for broadcast channel', () => {
    const result = saveBroadcastChannelConfigSchema.safeParse({
      channels: [
        {
          name: '测试渠道',
          webhook: ''
        }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('validates skill visibility payload', () => {
    const result = skillVisibilityUpdateSchema.safeParse({
      skillId: 'builtin://kian::browser',
      mainAgentVisible: true,
      projectAgentVisible: false
    });
    expect(result.success).toBe(true);
  });
});
