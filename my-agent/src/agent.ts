import type {
  AgentConfig,
  LLMProvider,
  LLMResponse,
  Message,
  SkillMeta,
  ToolCall,
} from "./types.js";
import { ContextBuilder, type ContextBuildResult } from "./context-builder.js";
import type { PromptSection } from "./prompt/system-prompt.js";
import type { MemoryCompactor } from "./memory/compaction.js";

/**
 * Agent — the ReAct (Reasoning + Acting) loop.
 *
 * Each turn:
 *   1. ContextBuilder assembles the optimal context window
 *   2. LLM generates a response (text and/or tool calls)
 *   3. If tool calls: execute them, feed results back, loop
 *   4. If text only: return the final answer
 *   5. Safety: stop after maxIterations to prevent runaway loops
 */

export interface AgentRunResult {
  /** Final text response from the agent */
  response: string;
  /** Full conversation history including tool calls */
  messages: Message[];
  /** Number of ReAct iterations used */
  iterations: number;
  /** Total estimated tokens consumed across all LLM calls */
  totalTokens: number;
}

export interface AgentOptions {
  config: AgentConfig;
  llm: LLMProvider;
  registry: ToolRegistry;
  skills?: SkillMeta[];
  extraSections?: PromptSection[];
  /** Optional compactor for LLM-based summarization (P1) */
  compactor?: MemoryCompactor;
}

const DEFAULT_MAX_ITERATIONS = 10;

export class Agent {
  private config: AgentConfig;
  private llm: LLMProvider;
  private registry: ToolRegistry;
  private contextBuilder: ContextBuilder;
  private conversationHistory: Message[] = [];

  constructor(options: AgentOptions) {
    this.config = options.config;
    this.llm = options.llm;
    this.registry = options.registry;
    this.contextBuilder = new ContextBuilder({
      config: options.config,
      registry: options.registry,
      skills: options.skills,
      extraSections: options.extraSections,
      compactor: options.compactor,
    });
  }

  /** Run the agent on a user message, returning the final response */
  async run(userMessage: string): Promise<AgentRunResult> {
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    const maxIter = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    let iterations = 0;
    let totalTokens = 0;

    while (iterations < maxIter) {
      iterations++;

      // 1. Build context
      const ctx = await this.contextBuilder.build(this.conversationHistory);
      totalTokens += ctx.tokenEstimate;

      // If compaction happened, update history
      if (ctx.updatedHistory) {
        this.conversationHistory = ctx.updatedHistory;
      }

      // 2. Call LLM
      const llmMessages: Message[] = [
        { role: "system", content: ctx.systemPrompt },
        ...ctx.messages,
      ];
      const response = await this.llm.chat(llmMessages, ctx.tools);

      // 3. Process response
      if (response.toolCalls.length > 0) {
        // Reasoning + Acting: record assistant message with tool calls
        this.conversationHistory.push({
          role: "assistant",
          content: response.content,
          tool_calls: response.toolCalls,
        });

        // Execute each tool call and record results
        for (const tc of response.toolCalls) {
          const result = await this.registry.execute(tc.name, tc.arguments);
          this.conversationHistory.push({
            role: "tool",
            content: result,
            tool_call_id: tc.id,
            name: tc.name,
          });
        }
        // Loop back for the next reasoning step
      } else {
        // Final answer — no more tool calls
        const finalContent = response.content ?? "";
        this.conversationHistory.push({
          role: "assistant",
          content: finalContent,
        });

        return {
          response: finalContent,
          messages: [...this.conversationHistory],
          iterations,
          totalTokens,
        };
      }
    }

    // Safety: max iterations reached
    const fallback =
      "I've reached the maximum number of reasoning steps. " +
      "Here's what I have so far based on the tools I've used.";
    this.conversationHistory.push({
      role: "assistant",
      content: fallback,
    });

    return {
      response: fallback,
      messages: [...this.conversationHistory],
      iterations,
      totalTokens,
    };
  }

  /** Reset conversation history (start a new session) */
  reset(): void {
    this.conversationHistory = [];
  }

  /** Get current conversation history (read-only copy) */
  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  /** Access the context builder for dynamic section management */
  getContextBuilder(): ContextBuilder {
    return this.contextBuilder;
  }
}
