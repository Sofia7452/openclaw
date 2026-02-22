import type { AgentConfig, SkillMeta, ToolDefinition } from "../types.js";

/**
 * Dynamic system prompt builder.
 *
 * Assembles the system prompt from multiple context sources:
 *   base instructions + tool descriptions + active skills + workspace context + runtime info
 *
 * This is the core of "context engineering" — we control exactly what the LLM sees.
 */

export interface SystemPromptParts {
  config: AgentConfig;
  tools: ToolDefinition[];
  /** Skill metadata (frontmatter only — progressive disclosure layer 1) */
  skills?: SkillMeta[];
  /** Extra context sections injected by the context builder */
  extraSections?: PromptSection[];
}

export interface PromptSection {
  heading: string;
  content: string;
}

export function buildSystemPrompt(parts: SystemPromptParts): string {
  const sections: string[] = [];

  // 1. Base instructions (role, personality, constraints)
  sections.push(parts.config.baseInstructions);

  // 2. Runtime info
  sections.push(buildRuntimeSection(parts.config));

  // 3. Available tools
  if (parts.tools.length > 0) {
    sections.push(buildToolsSection(parts.tools));
  }

  // 4. Available skills (metadata only — layer 1 of progressive disclosure)
  if (parts.skills && parts.skills.length > 0) {
    sections.push(buildSkillsSection(parts.skills));
  }

  // 5. Extra context sections (workspace info, memory, etc.)
  if (parts.extraSections) {
    for (const sec of parts.extraSections) {
      sections.push(`## ${sec.heading}\n\n${sec.content}`);
    }
  }

  return sections.join("\n\n---\n\n");
}

function buildRuntimeSection(config: AgentConfig): string {
  const lines = [
    "## Runtime Information",
    "",
    `- Agent: ${config.name}`,
    `- Model: ${config.model}`,
    `- Time: ${new Date().toISOString()}`,
  ];
  if (config.workspaceRoot) {
    lines.push(`- Workspace: ${config.workspaceRoot}`);
  }
  return lines.join("\n");
}

function buildToolsSection(tools: ToolDefinition[]): string {
  const lines = [
    "## Available Tools",
    "",
    "You have access to the following tools. " +
      "Call them by emitting a tool_call in your response.",
    "",
  ];
  for (const t of tools) {
    lines.push(`### ${t.name}`);
    lines.push(t.description);
    lines.push("Parameters: " + JSON.stringify(t.parameters, null, 2));
    lines.push("");
  }
  return lines.join("\n");
}

function buildSkillsSection(skills: SkillMeta[]): string {
  const lines = [
    "## Available Skills",
    "",
    "The following skills are installed. " +
      "When a user request matches a skill, use the read_file tool to load " +
      "the full SKILL.md for detailed instructions before proceeding.",
    "",
  ];
  for (const s of skills) {
    lines.push(`- **${s.name}**: ${s.description}`);
    if (s.tags && s.tags.length > 0) {
      lines.push(`  Tags: ${s.tags.join(", ")}`);
    }
    lines.push(`  Path: ${s.path}`);
  }
  return lines.join("\n");
}

/**
 * Estimate token count (rough: 1 token ≈ 4 chars for English, ~2 chars for CJK).
 * Good enough for budget checks — not a substitute for tiktoken.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) cjk++;
    else other++;
  }
  return Math.ceil(cjk / 2 + other / 4);
}
