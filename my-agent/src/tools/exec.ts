import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { defineTool } from "./registry.js";
import type { Tool } from "../types.js";

const execAsync = promisify(execCb);

const MAX_OUTPUT = 8_000; // chars — prevent context blowup

/**
 * Shell execution tool — runs a command and returns stdout/stderr.
 * Capped output to avoid flooding the context window.
 */
export function createExecTool(workspaceRoot: string): Tool {
  return defineTool(
    {
      name: "exec",
      description:
        "Execute a shell command and return its output. " +
        "Use for system operations, package management, git, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run" },
          cwd: {
            type: "string",
            description: "Working directory (optional, defaults to workspace root)",
          },
        },
        required: ["command"],
      },
    },
    async (args) => {
      const cwd = (args.cwd as string) || workspaceRoot;
      try {
        const { stdout, stderr } = await execAsync(args.command as string, {
          cwd,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;
        if (!output) output = "(no output)";
        if (output.length > MAX_OUTPUT) {
          output =
            output.slice(0, MAX_OUTPUT) +
            `\n... (truncated, ${output.length} total chars)`;
        }
        return output;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Exec error: ${msg}`;
      }
    },
  );
}
