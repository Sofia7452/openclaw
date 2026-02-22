import type { LLMProvider, Message } from "../types.js";
import { estimateTokens } from "../prompt/system-prompt.js";

/**
 * MemoryCompaction — the "garbage collector" for the context window.
 *
 * Implements the COMPRESS strategy using LLM-based summarization:
 * 1. Identifies older conversation turns that exceed the context budget.
 * 2. Asks the LLM to generate a concise summary of those turns.
 * 3. Replaces the original turns with a single "summary" message.
 * 4. Preserves the most recent N turns to maintain immediate context.
 *
 * This allows the agent to maintain "infinite" memory by trading detail for
 * context space as conversations grow long.
 */

export interface CompactionResult {
  /** The new message history after compaction */
  messages: Message[];
  /** The summary message injected into the history */
  summaryMessage: Message;
  /** Number of messages that were compacted */
  compactedCount: number;
}

export interface CompactionOptions {
  llm: LLMProvider;
  /** Keep the most recent N messages as-is (e.g. last 4 turns = 8 messages) */
  keepRecentCount?: number;
  /** Target token count for the summary (rough guidance) */
  summaryTokenLimit?: number;
}

const DEFAULT_KEEP_RECENT = 6;
const DEFAULT_SUMMARY_LIMIT = 500;

export class MemoryCompactor {
  private llm: LLMProvider;
  private keepRecentCount: number;
  private summaryTokenLimit: number;

  constructor(options: CompactionOptions) {
    this.llm = options.llm;
    this.keepRecentCount = options.keepRecentCount ?? DEFAULT_KEEP_RECENT;
    this.summaryTokenLimit = options.summaryTokenLimit ?? DEFAULT_SUMMARY_LIMIT;
  }

  /**
   * Compact a message history.
   *
   * Logic:
   * [Msg 0...Msg K] [Msg K+1...Msg N]
   * ^-- Compact --^ ^-- Keep Recent --^
   */
  async compact(messages: Message[]): Promise<CompactionResult | null> {
    if (messages.length <= this.keepRecentCount + 2) {
      return null; // Too few messages to compact meaningfully
    }

    const splitIndex = messages.length - this.keepRecentCount;
    const toCompact = messages.slice(0, splitIndex);
    const recent = messages.slice(splitIndex);

    // Filter out previous compaction notices to avoid "summary of summaries"
    // unless the summary itself is getting very old.
    const filteredToCompact = toCompact.filter(
      (m) => !m.content?.includes("[Context summary:"),
    );

    const summaryContent = await this.summarize(filteredToCompact);

    const summaryMessage: Message = {
      role: "system",
      content: `[Context summary: the following is a summary of ${toCompact.length} earlier message(s) that were compacted to save context space]\n\n${summaryContent}`,
    };

    return {
      messages: [summaryMessage, ...recent],
      summaryMessage,
      compactedCount: toCompact.length,
    };
  }

  /**
   * Use the LLM to summarize a sequence of messages.
   */
  private async summarize(messages: Message[]): Promise<string> {
    const prompt = `Please provide a concise, factual summary of the following conversation history.
Focus on:
1. User goals and preferences discovered
2. Key information retrieved from tools
3. Important decisions made
4. Pending tasks or open questions

Keep the summary under ${this.summaryTokenLimit} tokens. Respond with ONLY the summary text.

--- CONVERSATION HISTORY ---
${messages
  .map((m) => `${m.role.toUpperCase()}: ${m.content ?? "(tool calls)"}`)
  .join("\n\n")}
`;

    const response = await this.llm.chat(
      [{ role: "user", content: prompt }],
      [], // No tools needed for summarization
    );

    return response.content || "(Failed to generate summary)";
  }

  /**
   * Helper to determine if compaction is needed based on token count.
   */
  shouldCompact(messages: Message[], maxTokens: number): boolean {
    const totalTokens = messages.reduce(
      (sum, m) => sum + estimateTokens(m.content ?? ""),
      0,
    );
    // Trigger when we cross 80% of the message budget
    return totalTokens > maxTokens * 0.8;
  }
}
