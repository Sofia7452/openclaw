import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineTool } from "./registry.js";
import type { Tool } from "../types.js";

/**
 * File read tool — reads a file and returns its content.
 * Supports optional line range (offset + limit) for large files.
 */
export function createReadTool(workspaceRoot: string): Tool {
  return defineTool(
    {
      name: "read_file",
      description:
        "Read the contents of a file. Returns the text content. " +
        "Use offset/limit for large files to read a specific line range.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative or absolute file path",
          },
          offset: {
            type: "number",
            description: "1-based start line (optional)",
          },
          limit: {
            type: "number",
            description: "Number of lines to read (optional)",
          },
        },
        required: ["path"],
      },
    },
    async (args) => {
      const filePath = resolve(workspaceRoot, args.path as string);
      try {
        const raw = await readFile(filePath, "utf-8");
        const lines = raw.split("\n");

        const offset = typeof args.offset === "number" ? args.offset - 1 : 0;
        const limit =
          typeof args.limit === "number" ? args.limit : lines.length;
        const slice = lines.slice(
          Math.max(0, offset),
          Math.min(lines.length, offset + limit),
        );

        return slice
          .map((line, i) => `${String(offset + i + 1).padStart(6)}|${line}`)
          .join("\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error reading file: ${msg}`;
      }
    },
  );
}
