import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "../tools/registry.js";
import type { Tool } from "../types.js";

/**
 * LongTermMemory — the "hard drive" for the agent.
 *
 * Implements the WRITE strategy for persistent information:
 * 1. Manages a `MEMORY.md` file in the workspace root.
 * 2. Provides tools for the agent to read and update this memory.
 * 3. ContextBuilder injects this memory into the system prompt for every turn.
 *
 * This allows the agent to remember user preferences, project context, 
 * and key conclusions across different sessions.
 */

export class LongTermMemory {
  private memoryPath: string;

  constructor(workspaceRoot: string) {
    this.memoryPath = join(workspaceRoot, "MEMORY.md");
  }

  /** Read current long-term memory content */
  async read(): Promise<string> {
    try {
      await access(this.memoryPath);
      return await readFile(this.memoryPath, "utf-8");
    } catch {
      return ""; // No memory file yet
    }
  }

  /** Overwrite long-term memory content */
  async write(content: string): Promise<void> {
    await writeFile(this.memoryPath, content, "utf-8");
  }

  /** 
   * Create a tool that allows the agent to update its own memory.
   * This is the "WRITE" strategy in action.
   */
  createTool(): Tool {
    return defineTool(
      {
        name: "update_memory",
        description: "Update the long-term memory (MEMORY.md). " +
          "Use this to store important facts, user preferences, or project context " +
          "that should be remembered across sessions.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The new content for the memory file. Should be concise and structured."
            }
          },
          required: ["content"]
        }
      },
      async (args) => {
        const content = args.content as string;
        await this.write(content);
        return "Long-term memory updated successfully.";
      }
    );
  }
}
