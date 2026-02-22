import type { Tool, ToolDefinition, ToolHandler } from "../types.js";

/**
 * Central tool registry.
 *
 * Responsibilities:
 * 1. Register tools with schema + handler
 * 2. Resolve a tool by name for execution
 * 3. Filter tools by allowlist (per-agent / per-task granularity)
 * 4. Export definitions array for LLM function-calling
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool "${tool.definition.name}" is already registered`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Execute a tool by name, parsing the JSON arguments string */
  async execute(name: string, argsJson: string): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    try {
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      return await tool.handler(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: message });
    }
  }

  /** Return definitions for all registered tools */
  allDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  /**
   * Return definitions filtered by an allowlist.
   * If allowlist is undefined/empty, returns all.
   */
  filteredDefinitions(allowlist?: string[]): ToolDefinition[] {
    if (!allowlist || allowlist.length === 0) {
      return this.allDefinitions();
    }
    const set = new Set(allowlist);
    return [...this.tools.values()]
      .filter((t) => set.has(t.definition.name))
      .map((t) => t.definition);
  }

  /** Number of registered tools */
  get size(): number {
    return this.tools.size;
  }

  /** All registered tool names */
  names(): string[] {
    return [...this.tools.keys()];
  }
}

// ---------------------------------------------------------------------------
// Helper to build a Tool from parts
// ---------------------------------------------------------------------------

export function defineTool(
  definition: ToolDefinition,
  handler: ToolHandler,
): Tool {
  return { definition, handler };
}
