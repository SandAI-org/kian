import { Type } from "@earendil-works/pi-ai";
import { Client } from "@modelcontextprotocol/sdk/client";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  type CallToolResult,
  type Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServerDTO } from "@shared/types";
import type {
  AgentToolResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { logger } from "./logger";

const MCP_CLIENT_INFO = {
  name: "vivid-agent",
  version: "1.0.0",
};

const MCP_CONNECT_TIMEOUT_MS = 15_000;
const MCP_LIST_TIMEOUT_MS = 15_000;
const MCP_TOOL_TIMEOUT_MS = 120_000;

type SupportedContentItem = AgentToolResult<unknown>["content"][number];

type McpClientEntry = {
  server: McpServerDTO;
  client: Client;
  transport:
    | StdioClientTransport
    | SSEClientTransport
    | StreamableHTTPClientTransport;
};

export type McpRuntime = {
  tools: ToolDefinition[];
  dispose: () => Promise<void>;
  warnings: string[];
};

const normalizeToolSegment = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized || "tool";
};

const parseCommandString = (value: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of value.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
};

const getStdioCommand = (
  server: McpServerDTO,
): { command: string; args: string[] } => {
  const commandTokens = parseCommandString(server.command);
  const [command, ...inlineArgs] = commandTokens;
  return {
    command: command ?? "",
    args: [...inlineArgs, ...server.args],
  };
};

const getMcpToolIdentifier = (server: McpServerDTO, toolName: string): string =>
  `mcp__server_${server.id}__${normalizeToolSegment(toolName)}`;

const buildFetchWithHeaders = (
  headers: Record<string, string>,
): ((url: string | URL, init?: RequestInit) => Promise<Response>) => {
  return async (url, init) => {
    const nextHeaders = new Headers(init?.headers);
    for (const [key, value] of Object.entries(headers)) {
      nextHeaders.set(key, value);
    }
    return fetch(url, {
      ...init,
      headers: nextHeaders,
    });
  };
};

const createTransport = (
  server: McpServerDTO,
):
  | StdioClientTransport
  | SSEClientTransport
  | StreamableHTTPClientTransport => {
  if (server.transport === "stdio") {
    const { command, args } = getStdioCommand(server);
    if (!command) {
      throw new Error("未配置有效的启动命令");
    }

    const transport = new StdioClientTransport({
      command,
      args,
      cwd: server.cwd || undefined,
      env: {
        ...getDefaultEnvironment(),
        ...server.env,
      },
      stderr: "pipe",
    });

    const stderr = transport.stderr;
    if (stderr) {
      stderr.on("data", (chunk: Buffer | string) => {
        const content = String(chunk).trim();
        if (!content) return;
        logger.warn("MCP stdio stderr", {
          serverId: server.id,
          serverName: server.name,
          stderr: content,
        });
      });
    }

    return transport;
  }

  if (!server.url) {
    throw new Error("未配置服务 URL");
  }

  const url = new URL(server.url);
  const fetchWithHeaders = buildFetchWithHeaders(server.headers);

  if (server.transport === "sse") {
    return new SSEClientTransport(url, {
      fetch: fetchWithHeaders,
      eventSourceInit: {
        fetch: fetchWithHeaders,
      },
      requestInit: {
        headers: server.headers,
      },
    });
  }

  return new StreamableHTTPClientTransport(url, {
    fetch: fetchWithHeaders,
    requestInit: {
      headers: server.headers,
    },
  });
};

const connectClient = async (server: McpServerDTO): Promise<McpClientEntry> => {
  const client = new Client(MCP_CLIENT_INFO, {
    capabilities: {},
  });
  const transport = createTransport(server);

  client.onerror = (error) => {
    logger.warn("MCP client error", {
      serverId: server.id,
      serverName: server.name,
      error: error.message,
    });
  };

  transport.onerror = (error) => {
    logger.warn("MCP transport error", {
      serverId: server.id,
      serverName: server.name,
      error: error.message,
    });
  };

  await client.connect(transport, {
    timeout: MCP_CONNECT_TIMEOUT_MS,
  });

  return {
    server,
    client,
    transport,
  };
};

const listAllTools = async (client: Client): Promise<McpTool[]> => {
  const tools: McpTool[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listTools(
      cursor ? { cursor } : undefined,
      { timeout: MCP_LIST_TIMEOUT_MS },
    );
    tools.push(...result.tools);
    cursor = result.nextCursor;
  } while (cursor);

  return tools;
};

const stringifyStructuredContent = (value: unknown): string | null => {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const summarizeResource = (
  resource:
    | { uri: string; text: string; mimeType?: string }
    | { uri: string; blob: string; mimeType?: string },
): string => {
  if ("text" in resource) {
    return [
      `[MCP 资源] ${resource.uri}`,
      resource.mimeType ? `MIME: ${resource.mimeType}` : undefined,
      resource.text,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `[MCP 二进制资源] ${resource.uri}`,
    resource.mimeType ? `MIME: ${resource.mimeType}` : undefined,
    `数据长度：${resource.blob.length}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const mapCallToolContent = (result: CallToolResult): SupportedContentItem[] => {
  const output: SupportedContentItem[] = [];

  for (const item of result.content ?? []) {
    if (item.type === "text") {
      output.push({
        type: "text",
        text: item.text,
      });
      continue;
    }

    if (item.type === "image") {
      output.push({
        type: "image",
        data: item.data,
        mimeType: item.mimeType,
      });
      continue;
    }

    if (item.type === "audio") {
      output.push({
        type: "text",
        text: `[MCP 音频结果] MIME: ${item.mimeType}，数据长度：${item.data.length}`,
      });
      continue;
    }

    if (item.type === "resource") {
      output.push({
        type: "text",
        text: summarizeResource(item.resource),
      });
      continue;
    }

    output.push({
      type: "text",
      text: [
        `[MCP 资源链接] ${item.uri}`,
        item.title ? `标题：${item.title}` : undefined,
        item.description ? `描述：${item.description}` : undefined,
        item.mimeType ? `MIME: ${item.mimeType}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  const structuredContent = stringifyStructuredContent(result.structuredContent);
  if (structuredContent) {
    output.push({
      type: "text",
      text: `Structured Content:\n${structuredContent}`,
    });
  }

  return output.length > 0
    ? output
    : [
        {
          type: "text",
          text: "MCP 工具执行完成，但未返回可显示内容。",
        },
      ];
};

const createToolDefinition = (
  entry: McpClientEntry,
  tool: McpTool,
): ToolDefinition => {
  const toolId = getMcpToolIdentifier(entry.server, tool.name);
  const title = tool.title?.trim() || tool.name;
  const descriptionParts = [
    tool.description?.trim() || `调用 MCP 工具 ${tool.name}`,
    `MCP 服务：${entry.server.name}`,
    `原始工具名：${tool.name}`,
  ];

  return {
    name: toolId,
    label: `${entry.server.name} / ${title}`,
    description: descriptionParts.join("\n"),
    parameters: Type.Unsafe(
      (tool.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    ),
    async execute(toolCallId, params, signal) {
      try {
        const result = await entry.client.callTool(
          {
            name: tool.name,
            arguments: params as Record<string, unknown>,
          },
          CallToolResultSchema,
          {
            signal,
            timeout: MCP_TOOL_TIMEOUT_MS,
            resetTimeoutOnProgress: true,
          },
        );

        if ("toolResult" in result) {
          const text = stringifyStructuredContent(result.toolResult);
          return {
            content: [
              {
                type: "text",
                text: text
                  ? `MCP 工具返回兼容结果：\n${text}`
                  : "MCP 工具执行完成。",
              },
            ],
            details: {
              toolCallId,
              serverId: entry.server.id,
              serverName: entry.server.name,
              toolName: tool.name,
            },
          };
        }

        return {
          content: mapCallToolContent(result),
          details: {
            toolCallId,
            serverId: entry.server.id,
            serverName: entry.server.name,
            toolName: tool.name,
            isError: result.isError ?? false,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("MCP tool execution failed", {
          serverId: entry.server.id,
          serverName: entry.server.name,
          toolName: tool.name,
          error: message,
        });
        return {
          content: [
            {
              type: "text",
              text: `MCP 工具 ${entry.server.name}/${tool.name} 执行失败：${message}`,
            },
          ],
          details: {
            toolCallId,
            serverId: entry.server.id,
            serverName: entry.server.name,
            toolName: tool.name,
            isError: true,
          },
        };
      }
    },
  };
};

const disposeEntry = async (entry: McpClientEntry): Promise<void> => {
  try {
    if (entry.transport instanceof StreamableHTTPClientTransport) {
      try {
        await entry.transport.terminateSession();
      } catch {
        // Some MCP servers do not support explicit session termination.
      }
    }
    await entry.transport.close();
  } catch (error) {
    logger.warn("Failed to dispose MCP transport", {
      serverId: entry.server.id,
      serverName: entry.server.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const buildMcpServerSignature = (servers: McpServerDTO[]): string => {
  const normalized = servers
    .filter((server) => server.enabled)
    .map((server) => ({
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: [...server.args],
      cwd: server.cwd,
      env: Object.entries(server.env).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
      url: server.url,
      headers: Object.entries(server.headers).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return JSON.stringify(normalized);
};

export const createMcpRuntime = async (
  servers: McpServerDTO[],
): Promise<McpRuntime> => {
  const enabledServers = servers.filter((server) => server.enabled);
  if (enabledServers.length === 0) {
    logger.info("MCP runtime skipped because no servers are enabled");
    return {
      tools: [],
      dispose: async () => {},
      warnings: [],
    };
  }

  const connectedEntries: McpClientEntry[] = [];
  const tools: ToolDefinition[] = [];
  const warnings: string[] = [];

  for (const server of enabledServers) {
    try {
      const entry = await connectClient(server);
      connectedEntries.push(entry);

      const remoteTools = await listAllTools(entry.client);
      tools.push(...remoteTools.map((tool) => createToolDefinition(entry, tool)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${server.name} 连接失败：${message}`);
      logger.warn("Failed to initialize MCP server for agent runtime", {
        serverId: server.id,
        serverName: server.name,
        transport: server.transport,
        error: message,
      });
    }
  }

  logger.info("MCP runtime initialization finished", {
    enabledServerCount: enabledServers.length,
    connectedServerCount: connectedEntries.length,
    toolCount: tools.length,
    warningCount: warnings.length,
    serverIds: enabledServers.map((server) => server.id),
  });

  return {
    tools,
    warnings,
    dispose: async () => {
      await Promise.allSettled(connectedEntries.map((entry) => disposeEntry(entry)));
    },
  };
};

export { getMcpToolIdentifier, normalizeToolSegment, parseCommandString };
