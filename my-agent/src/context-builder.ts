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
import type { MemoryCompactor } from "./memory/compaction.js";
import type { LongTermMemory } from "./memory/long-term.js";

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
  /** If compaction happened, this is the updated history */
  updatedHistory?: Message[];
}

export interface ContextBuilderOptions {
  config: AgentConfig;
  registry: ToolRegistry;
  skills?: SkillMeta[];
  /** Max tokens budget for the entire context (system + messages) */
  maxContextTokens?: number;
  /** Extra sections to inject (workspace info, memory snippets, etc.) */
  extraSections?: PromptSection[];
  /** Optional compactor for LLM-based summarization */
  compactor?: MemoryCompactor;
  /** Optional long-term memory for cross-session context */
  memory?: LongTermMemory;
}

const DEFAULT_MAX_CONTEXT_TOKENS = 32_000;

export class ContextBuilder {
  private config: AgentConfig;
  private registry: ToolRegistry;
  private skills: SkillMeta[];
  private maxContextTokens: number;
  private extraSections: PromptSection[];
  private compactor?: MemoryCompactor;
  private memory?: LongTermMemory;

  constructor(options: ContextBuilderOptions) {
    this.config = options.config;
    this.registry = options.registry;
    this.skills = options.skills ?? [];
    this.maxContextTokens =
      options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
    this.extraSections = options.extraSections ?? [];
    this.compactor = options.compactor;
    this.memory = options.memory;
  }

  /**
   * Build the full context for an LLM call.
   *
   * Strategy:
   * 1. SELECT tools via allowlist
   * 2. BUILD system prompt from config + tools + skills + extras
   * 3. COMPRESS message history if over budget
   *    - Uses LLM-based compaction if compactor is available
   *    - Falls back to tail-pruning
   * 4. Return assembled context
   */
  async build(conversationHistory: Message[]): Promise<ContextBuildResult> {
    // --- SELECT: filter tools by allowlist ---
    const tools = this.registry.filteredDefinitions(
      this.config.toolAllowlist,
    );

    // --- READ: pull from long-term memory (P2) ---
    const memoryContent = this.memory ? await this.memory.read() : "";
    const effectiveExtraSections = [...this.extraSections];
    if (memoryContent) {
      effectiveExtraSections.push({
        heading: "Long-Term Memory",
        content: memoryContent,
      });
    }

    // --- BUILD: assemble system prompt ---
    const systemPrompt = buildSystemPrompt({
      config: this.config,
      tools,
      skills: this.skills.length > 0 ? this.skills : undefined,
      extraSections:
        effectiveExtraSections.length > 0 ? effectiveExtraSections : undefined,
    });

    const systemTokens = estimateTokens(systemPrompt);
    const budget = this.maxContextTokens - systemTokens;

    let messages = conversationHistory;
    let updatedHistory: Message[] | undefined;

    // --- COMPRESS: LLM-based compaction (P1) ---
    if (this.compactor && this.compactor.shouldCompact(messages, budget)) {
      const result = await this.compactor.compact(messages);
      if (result) {
        messages = result.messages;
        updatedHistory = messages;
      }
    }

    // --- COMPRESS: Fallback to tail-pruning (P0) ---
    const prunedMessages = this.pruneMessages(messages, budget);
    if (prunedMessages.length !== messages.length) {
      messages = prunedMessages;
    }

    const totalTokens =
      systemTokens + messages.reduce((s, m) => s + estimateTokens(m.content ?? ""), 0);

    return {
      systemPrompt,
      messages,
      tools,
      tokenEstimate: totalTokens,
      updatedHistory,
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
