/**
 * Core type definitions for the agent framework.
 *
 * Design philosophy: keep types minimal but strict — every field has a reason.
 * Mirrors the layered architecture: Message → Tool → Skill → Agent.
 */

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON-encoded arguments
}

export interface Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  /** Present when role === "tool" — links back to the originating tool_call id */
  tool_call_id?: string;
  name?: string;
  /** Reasoning/thinking content from models with thinking mode (e.g. Kimi K2.5) */
  reasoning_content?: string;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolSchema {
  type: "object";
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolSchema;
}

/** The runtime handler that actually executes a tool call */
export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

// ---------------------------------------------------------------------------
// Skills (metadata only at P0 — full loader comes in P1)
// ---------------------------------------------------------------------------

export interface SkillMeta {
  name: string;
  description: string;
  version?: string;
  tags?: string[];
  /** Path to the SKILL.md file for lazy loading */
  path: string;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface SessionState {
  messages: Message[];
  /** Monotonically increasing turn counter */
  turnCount: number;
  /** Timestamp of session creation */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

export interface AgentConfig {
  /** Display name */
  name: string;
  /** Base system instructions (role, personality, constraints) */
  baseInstructions: string;
  /** Model identifier, e.g. "gpt-4o-mini" */
  model: string;
  /** Max tokens for completion */
  maxTokens?: number;
  /** Tool allowlist — if set, only these tools are exposed to the LLM */
  toolAllowlist?: string[];
  /** Max ReAct iterations before forced stop */
  maxIterations?: number;
  /** Workspace root for file-based tools */
  workspaceRoot?: string;
}

// ---------------------------------------------------------------------------
// LLM abstraction (thin wrapper so we can swap providers or mock in tests)
// ---------------------------------------------------------------------------

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "content_filter";
  /** Reasoning/thinking content from models with thinking mode (e.g. Kimi K2.5) */
  reasoningContent?: string;
}

export interface LLMProvider {
  chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse>;
}
