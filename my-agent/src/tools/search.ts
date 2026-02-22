import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { defineTool } from "./registry.js";
import type { Tool } from "../types.js";

const MAX_RESULTS = 20;
const MAX_LINE_LEN = 200;

/**
 * Grep-like search tool — searches file contents for a regex pattern.
 * Returns matching lines with file path and line number.
 */
export function createSearchTool(workspaceRoot: string): Tool {
  return defineTool(
    {
      name: "search",
      description:
        "Search file contents for a regex pattern under the workspace. " +
        "Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          path: {
            type: "string",
            description: "Subdirectory to search in (optional, defaults to workspace root)",
          },
          glob: {
            type: "string",
            description: "File extension filter, e.g. '.ts' (optional)",
          },
        },
        required: ["pattern"],
      },
    },
    async (args) => {
      const searchRoot = join(workspaceRoot, (args.path as string) || "");
      const pattern = new RegExp(args.pattern as string, "i");
      const ext = args.glob as string | undefined;
      const results: string[] = [];

      async function walk(dir: string): Promise<void> {
        if (results.length >= MAX_RESULTS) return;
        let entries;
        try {
          entries = await readdir(dir);
        } catch {
          return;
        }
        for (const entry of entries) {
          if (results.length >= MAX_RESULTS) return;
          const full = join(dir, entry);
          const s = await stat(full).catch(() => null);
          if (!s) continue;
          if (s.isDirectory()) {
            if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
            await walk(full);
          } else if (s.isFile()) {
            if (ext && !entry.endsWith(ext)) continue;
            if (s.size > 512_000) continue; // skip large files
            try {
              const content = await readFile(full, "utf-8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= MAX_RESULTS) break;
                if (pattern.test(lines[i])) {
                  const rel = relative(workspaceRoot, full);
                  const line = lines[i].length > MAX_LINE_LEN
                    ? lines[i].slice(0, MAX_LINE_LEN) + "..."
                    : lines[i];
                  results.push(`${rel}:${i + 1}: ${line}`);
                }
              }
            } catch {
              // binary or unreadable — skip
            }
          }
        }
      }

      await walk(searchRoot);
      return results.length > 0
        ? results.join("\n")
        : "No matches found.";
    },
  );
}
