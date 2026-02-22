import OpenAI from "openai";
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
} from "../types.js";

/**
 * OpenAI-compatible LLM provider.
 * Works with OpenAI API, Azure OpenAI, or any compatible endpoint.
 */
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(options: {
    apiKey?: string;
    baseURL?: string;
    model: string;
    maxTokens?: number;
  }) {
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: options.baseURL ?? process.env.OPENAI_BASE_URL,
    });
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const openaiMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content ?? "",
          tool_call_id: m.tool_call_id!,
        };
      }
      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: "assistant" as const,
          content: m.content ?? null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }
      return {
        role: m.role as "system" | "user" | "assistant",
        content: m.content ?? "",
      };
    });

    const openaiTools =
      tools.length > 0
        ? tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools,
      max_tokens: this.maxTokens,
    });

    const choice = response.choices[0];
    const msg = choice.message;

    const toolCalls =
      msg.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })) ?? [];

    const finishReason =
      choice.finish_reason === "tool_calls"
        ? "tool_calls"
        : choice.finish_reason === "length"
          ? "length"
          : choice.finish_reason === "content_filter"
            ? "content_filter"
            : "stop";

    return {
      content: msg.content,
      toolCalls,
      finishReason,
    };
  }
}
