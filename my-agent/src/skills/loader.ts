import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { SkillMeta } from "../types.js";

/**
 * SkillsLoader — the "discovery service" for Agent Skills.
 *
 * Implements Layer 1 of Progressive Disclosure:
 * 1. Scans the skills directory for all `SKILL.md` files.
 * 2. Parses ONLY the frontmatter (YAML block at the start of the file).
 * 3. Returns metadata used by the ContextBuilder to guide the LLM.
 *
 * This keeps the initial prompt small (~100 tokens/skill) while providing
 * enough info for the LLM to know when to load the full skill via `read_file`.
 */

export class SkillsLoader {
  private workspaceRoot: string;
  private skillsDirs: string[];

  constructor(workspaceRoot: string, skillsDirs: string[] = ["skills"]) {
    this.workspaceRoot = workspaceRoot;
    this.skillsDirs = skillsDirs;
  }

  /**
   * Scan all configured directories and return metadata for all found skills.
   */
  async discover(): Promise<SkillMeta[]> {
    const results: SkillMeta[] = [];
    for (const dir of this.skillsDirs) {
      const fullDir = join(this.workspaceRoot, dir);
      await this.scanDir(fullDir, results);
    }
    return results;
  }

  private async scanDir(dir: string, results: SkillMeta[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      return; // directory not found — skip
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const s = await stat(fullPath).catch(() => null);
      if (!s) continue;

      if (s.isDirectory()) {
        // Look for SKILL.md inside the directory
        const skillMdPath = join(fullPath, "SKILL.md");
        const skillMdStat = await stat(skillMdPath).catch(() => null);
        if (skillMdStat?.isFile()) {
          const meta = await this.parseSkillFile(skillMdPath);
          if (meta) results.push(meta);
        } else {
          // Recurse into subdirectories (max depth 2 for safety)
          await this.scanDir(fullPath, results);
        }
      } else if (s.isFile() && entry === "SKILL.md") {
        const meta = await this.parseSkillFile(fullPath);
        if (meta) results.push(meta);
      }
    }
  }

  /**
   * Parse the frontmatter of a SKILL.md file.
   * Expects standard YAML frontmatter:
   * ---
   * name: my-skill
   * description: does something
   * tags: [tag1, tag2]
   * ---
   */
  private async parseSkillFile(filePath: string): Promise<SkillMeta | null> {
    try {
      const content = await readFile(filePath, "utf-8");
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!match) return null;

      const frontmatter = match[1];
      const relPath = relative(this.workspaceRoot, filePath);

      return {
        name: this.extractValue(frontmatter, "name") || filePath.split("/").at(-2) || "unnamed",
        description: this.extractValue(frontmatter, "description") || "No description provided",
        tags: this.extractArray(frontmatter, "tags"),
        path: relPath,
      };
    } catch {
      return null;
    }
  }

  private extractValue(yaml: string, key: string): string | null {
    const regex = new RegExp(`^${key}:\\s*(?:>\\s*|"?)(.*?)"?\\s*$`, "m");
    const match = yaml.match(regex);
    if (!match) return null;

    let value = match[1].trim();
    // Handle multiline scalars (simple version)
    if (yaml.includes(`${key}: >`)) {
      const lines = yaml.split("\n");
      const startIndex = lines.findIndex((l) => l.startsWith(`${key}: >`));
      if (startIndex !== -1) {
        const resultLines = [];
        for (let i = startIndex + 1; i < lines.length; i++) {
          const line = lines[i];
          if (line.match(/^\S/)) break; // found next key
          resultLines.push(line.trim());
        }
        value = resultLines.join(" ");
      }
    }
    return value;
  }

  private extractArray(yaml: string, key: string): string[] {
    const regex = new RegExp(`^${key}:\\s*\\[(.*?)\\]`, "m");
    const match = yaml.match(regex);
    if (match) {
      return match[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    }
    // Handle block list (simple version)
    const lines = yaml.split("\n");
    const startIndex = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (startIndex !== -1) {
      const results: string[] = [];
      for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("- ")) {
          results.push(line.substring(2).replace(/^['"]|['"]$/g, ""));
        } else if (line.match(/^\S/)) {
          break;
        }
      }
      return results;
    }
    return [];
  }
}
