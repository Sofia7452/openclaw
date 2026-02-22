import type {
  AgentConfig,
  Message,
  SkillMeta,
  ToolDefinition,
} from "./types.js";
import {
  buildSystemPrompt,
  estimateTokens,
  type PromptSection,
} from "./prompt/system-prompt.js";
import type { ToolRegistry } from "./tools/registry.js";

/**
 * ContextBuilder — the "chief of staff" behind the agent.
 *
 * Implements the four context engineering strategies:
 *   1. Write  — persist information outside the context window (memory)
 *   2. Select — pick the right tools/skills/knowledge for this turn
 *   3. Compress — summarize or prune to stay within token budget
 *   4. Isolate — sub-agents get their own context (P2, stubbed here)
 *
 * At P0 we focus on: dynamic prompt assembly + tool selection + basic pruning.
 * P1 adds: skill progressive disclosure + LLM-based compaction.
 * P2 adds: long-term memory + sub-agent isolation.
 */

export interface ContextBuildResult {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  tokenEstimate: number;
}

export interface ContextBuilderOptions {
  config: AgentConfig;
  registry: ToolRegistry;
  skills?: SkillMeta[];
  /** Max tokens budget for the entire context (system + messages) */
  maxContextTokens?: number;
  /** Extra sections to inject (workspace info, memory snippets, etc.) */
  extraSections?: PromptSection[];
}

const DEFAULT_MAX_CONTEXT_TOKENS = 32_000;

export class ContextBuilder {
  private config: AgentConfig;
  private registry: ToolRegistry;
  private skills: SkillMeta[];
  private maxContextTokens: number;
  private extraSections: PromptSection[];

  constructor(options: ContextBuilderOptions) {
    this.config = options.config;
    this.registry = options.registry;
    this.skills = options.skills ?? [];
    this.maxContextTokens =
      options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
    this.extraSections = options.extraSections ?? [];
  }

  /**
   * Build the full context for an LLM call.
   *
   * Strategy:
   * 1. SELECT tools via allowlist
   * 2. BUILD system prompt from config + tools + skills + extras
   * 3. COMPRESS message history if over budget (tail-pruning at P0)
   * 4. Return assembled context
   */
  build(conversationHistory: Message[]): ContextBuildResult {
    // --- SELECT: filter tools by allowlist ---
    const tools = this.registry.filteredDefinitions(
      this.config.toolAllowlist,
    );

    // --- BUILD: assemble system prompt ---
    const systemPrompt = buildSystemPrompt({
      config: this.config,
      tools,
      skills: this.skills.length > 0 ? this.skills : undefined,
      extraSections:
        this.extraSections.length > 0 ? this.extraSections : undefined,
    });

    // --- COMPRESS: prune messages if over budget ---
    const systemTokens = estimateTokens(systemPrompt);
    const budget = this.maxContextTokens - systemTokens;
    const messages = this.pruneMessages(conversationHistory, budget);

    const totalTokens =
      systemTokens + messages.reduce((s, m) => s + estimateTokens(m.content ?? ""), 0);

    return {
      systemPrompt,
      messages,
      tools,
      tokenEstimate: totalTokens,
    };
  }

  /**
   * Add an extra section to the system prompt (e.g. memory, workspace info).
   * This is the "WRITE" strategy — persisting info for future turns.
   */
  addSection(section: PromptSection): void {
    this.extraSections.push(section);
  }

  /** Replace all extra sections */
  setSections(sections: PromptSection[]): void {
    this.extraSections = sections;
  }

  /** Update skill metadata list */
  setSkills(skills: SkillMeta[]): void {
    this.skills = skills;
  }

  /**
   * Tail-pruning: keep the most recent messages that fit within the token budget.
   * Always preserves at least the last user message.
   *
   * At P1 this will be replaced by LLM-based compaction (summarize old turns).
   */
  private pruneMessages(messages: Message[], budgetTokens: number): Message[] {
    if (messages.length === 0) return [];

    // Walk backwards, accumulating tokens
    let used = 0;
    let cutoff = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      const tokens = estimateTokens(messages[i].content ?? "");
      if (used + tokens > budgetTokens && i < messages.length - 1) {
        cutoff = i + 1;
        break;
      }
      used += tokens;
      cutoff = i;
    }

    const pruned = messages.slice(cutoff);

    // If we pruned anything, prepend a notice
    if (cutoff > 0) {
      return [
        {
          role: "system" as const,
          content: `[Context note: ${cutoff} earlier message(s) were pruned to fit the context window.]`,
        },
        ...pruned,
      ];
    }
    return pruned;
  }
}
