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
import type { LongTermMemory } from "./memory/long-term.js";

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

/** Callback fired after each iteration, useful for logging/debugging */
export type OnStepCallback = (step: {
  iteration: number;
  toolCalls: ToolCall[];
  toolResults: Array<{ name: string; result: string }>;
  thinking: string | null;
}) => void;

export interface AgentOptions {
  config: AgentConfig;
  llm: LLMProvider;
  registry: ToolRegistry;
  skills?: SkillMeta[];
  extraSections?: PromptSection[];
  /** Optional compactor for LLM-based summarization (P1) */
  compactor?: MemoryCompactor;
  /** Optional long-term memory for cross-session context (P2) */
  memory?: LongTermMemory;
  /** Optional step callback for debugging */
  onStep?: OnStepCallback;
}

const DEFAULT_MAX_ITERATIONS = 10;

export class Agent {
  private config: AgentConfig;
  private llm: LLMProvider;
  private registry: ToolRegistry;
  private contextBuilder: ContextBuilder;
  private conversationHistory: Message[] = [];
  private onStep?: OnStepCallback;

  constructor(options: AgentOptions) {
    this.config = options.config;
    this.llm = options.llm;
    this.registry = options.registry;
    this.onStep = options.onStep;

    // Automatically register the long-term memory tool if memory is provided
    if (options.memory) {
      this.registry.register(options.memory.createTool());
    }

    this.contextBuilder = new ContextBuilder({
      config: options.config,
      registry: options.registry,
      skills: options.skills,
      extraSections: options.extraSections,
      compactor: options.compactor,
      memory: options.memory,
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

      if (ctx.updatedHistory) {
        this.conversationHistory = ctx.updatedHistory;
      }

      // 2. Determine if we should force a final answer
      //    - Last 2 iterations: inject nudge + withhold tools
      //    - This prevents models (especially DeepSeek) from endlessly exploring
      const remainingSteps = maxIter - iterations;
      const shouldForceAnswer = remainingSteps <= 0;
      const shouldNudge = remainingSteps <= 1 && !shouldForceAnswer;

      const llmMessages: Message[] = [
        { role: "system", content: ctx.systemPrompt },
        ...ctx.messages,
      ];

      if (shouldNudge) {
        llmMessages.push({
          role: "system",
          content:
            "[IMPORTANT: This is your LAST chance to use tools. " +
            "After this step, you MUST provide your final answer directly. " +
            "If you already have enough information, respond NOW without calling tools.]",
        });
      }

      if (shouldForceAnswer) {
        // Replace the last system message with a hard stop instruction
        llmMessages.push({
          role: "system",
          content:
            "[FINAL STEP: You CANNOT call any tools. " +
            "Based on ALL the information you have gathered in previous steps, " +
            "provide your complete, well-structured answer NOW. " +
            "Respond in the same language as the user's original question.]",
        });
      }

      const response = await this.llm.chat(
        llmMessages,
        shouldForceAnswer ? [] : ctx.tools,
      );

      // 3. Process response — strip any fake tool-call markup from text-only responses
      if (response.toolCalls.length > 0 && !shouldForceAnswer) {
        // Reasoning + Acting: record assistant message with tool calls
        const assistantMsg: Message = {
          role: "assistant",
          content: response.content,
          tool_calls: response.toolCalls,
        };
        if (response.reasoningContent) {
          assistantMsg.reasoning_content = response.reasoningContent;
        }
        this.conversationHistory.push(assistantMsg);

        // Execute each tool call and record results
        const toolResults: Array<{ name: string; result: string }> = [];
        for (const tc of response.toolCalls) {
          const result = await this.registry.execute(tc.name, tc.arguments);
          toolResults.push({ name: tc.name, result });
          this.conversationHistory.push({
            role: "tool",
            content: result,
            tool_call_id: tc.id,
            name: tc.name,
          });
        }

        // Fire step callback
        this.onStep?.({
          iteration: iterations,
          toolCalls: response.toolCalls,
          toolResults,
          thinking: response.content,
        });

        // Loop back for the next reasoning step
      } else {
        // Final answer — no more tool calls
        let finalContent = response.content ?? "";

        // Some models (DeepSeek) may embed fake tool-call markup in plain text
        // when tools are withheld. Strip it to get a clean answer.
        finalContent = stripFakeToolCalls(finalContent);

        const finalMsg: Message = {
          role: "assistant",
          content: finalContent,
        };
        if (response.reasoningContent) {
          finalMsg.reasoning_content = response.reasoningContent;
        }
        this.conversationHistory.push(finalMsg);

        return {
          response: finalContent,
          messages: [...this.conversationHistory],
          iterations,
          totalTokens,
        };
      }
    }

    // Safety: max iterations reached — extract last assistant content as best-effort
    const lastAssistant = [...this.conversationHistory]
      .reverse()
      .find((m) => m.role === "assistant" && m.content);
    const fallback = lastAssistant?.content ??
      "I've reached the maximum number of reasoning steps.";
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

/**
 * Strip fake tool-call markup that some models (DeepSeek) emit in plain text
 * when tools are withheld. Patterns include:
 *   <｜DSML｜function_calls>...</｜DSML｜function_calls>
 *   ```tool_code\n...\n```
 */
function stripFakeToolCalls(text: string): string {
  // DeepSeek DSML markup
  let cleaned = text.replace(/<｜DSML｜[\s\S]*$/g, "");
  // Generic XML-like tool blocks
  cleaned = cleaned.replace(/<function_call>[\s\S]*?<\/function_call>/g, "");
  // Markdown tool_code blocks
  cleaned = cleaned.replace(/```tool_code[\s\S]*?```/g, "");
  return cleaned.trim();
}
