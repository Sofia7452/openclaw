import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
} from "../types.js";

/**
 * Mock LLM provider for testing.
 * Returns pre-configured responses in sequence.
 */
export class MockLLMProvider implements LLMProvider {
  private responses: LLMResponse[];
  private callIndex = 0;
  /** Records all calls for assertion */
  public calls: Array<{ messages: Message[]; tools: ToolDefinition[] }> = [];

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.calls.push({ messages: [...messages], tools: [...tools] });
    if (this.callIndex >= this.responses.length) {
      return {
        content: "No more mock responses configured.",
        toolCalls: [],
        finishReason: "stop",
      };
    }
    return this.responses[this.callIndex++];
  }

  /** Reset call counter (reuse same responses) */
  reset(): void {
    this.callIndex = 0;
    this.calls = [];
  }
}
