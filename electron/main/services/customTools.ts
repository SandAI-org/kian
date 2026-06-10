import type {
  ToolDefinition,
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolExecutionMode,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Shared helpers (extracted from the old MCP servers)
// ---------------------------------------------------------------------------

const textResult = (text: string): AgentToolResult<unknown> => ({
  content: [{ type: "text" as const, text }],
  details: undefined,
});

const errorResult = (message: string): AgentToolResult<unknown> => ({
  content: [{ type: "text" as const, text: message }],
  details: { isError: true },
});

// ---------------------------------------------------------------------------
// Generic custom tool definition (business logic only, no SDK coupling)
// ---------------------------------------------------------------------------

export interface CustomToolDef {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  executionMode?: ToolExecutionMode;
  handler: (input: Record<string, unknown>) => Promise<{
    text: string;
    isError?: boolean;
  }>;
}

/**
 * Adapt a CustomToolDef into a pi-coding-agent ToolDefinition.
 */
export const toToolDefinition = (def: CustomToolDef): ToolDefinition => ({
  name: def.name,
  label: def.label,
  description: def.description,
  parameters: def.parameters,
  executionMode: def.executionMode,
  async execute(
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal: AbortSignal | undefined,
    _onUpdate: AgentToolUpdateCallback | undefined,
  ): Promise<AgentToolResult<unknown>> {
    const result = await def.handler(params);
    return result.isError ? errorResult(result.text) : textResult(result.text);
  },
});

export { textResult, errorResult };
