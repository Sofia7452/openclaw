import { describe, it, expect } from "vitest";
import { Agent } from "./agent.js";
import { ToolRegistry, defineTool } from "./tools/registry.js";
import { MockLLMProvider } from "./llm/mock-provider.js";
import type { AgentConfig, LLMResponse } from "./types.js";

const config: AgentConfig = {
  name: "test-agent",
  baseInstructions: "You are a helpful test agent.",
  model: "mock",
  maxIterations: 5,
};

function makeRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(
    defineTool(
      {
        name: "calculator",
        description: "Perform arithmetic",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string", description: "Math expression" },
          },
          required: ["expression"],
        },
      },
      async (args) => {
        try {
          // Simple and safe for test purposes
          const expr = args.expression as string;
          const result = Function(`"use strict"; return (${expr})`)();
          return String(result);
        } catch {
          return "Error: invalid expression";
        }
      },
    ),
  );
  return reg;
}

describe("Agent — ReAct loop", () => {
  it("returns direct answer when LLM produces no tool calls", async () => {
    const llm = new MockLLMProvider([
      { content: "Hello! How can I help?", toolCalls: [], finishReason: "stop" },
    ]);
    const agent = new Agent({ config, llm, registry: makeRegistry() });

    const result = await agent.run("Hi");

    expect(result.response).toBe("Hello! How can I help?");
    expect(result.iterations).toBe(1);
    expect(result.messages).toHaveLength(2); // user + assistant
    expect(llm.calls).toHaveLength(1);
  });

  it("executes tool calls and loops back for final answer", async () => {
    const llm = new MockLLMProvider([
      // Iteration 1: LLM decides to call calculator
      {
        content: "Let me calculate that.",
        toolCalls: [
          { id: "call_1", name: "calculator", arguments: '{"expression":"2+3"}' },
        ],
        finishReason: "tool_calls",
      },
      // Iteration 2: LLM sees tool result and gives final answer
      {
        content: "The result of 2+3 is 5.",
        toolCalls: [],
        finishReason: "stop",
      },
    ]);
    const agent = new Agent({ config, llm, registry: makeRegistry() });

    const result = await agent.run("What is 2+3?");

    expect(result.response).toBe("The result of 2+3 is 5.");
    expect(result.iterations).toBe(2);
    expect(llm.calls).toHaveLength(2);

    // Verify conversation history structure
    const history = result.messages;
    expect(history[0]).toMatchObject({ role: "user", content: "What is 2+3?" });
    expect(history[1].role).toBe("assistant");
    expect(history[1].tool_calls).toHaveLength(1);
    expect(history[2]).toMatchObject({ role: "tool", name: "calculator", content: "5" });
    expect(history[3]).toMatchObject({ role: "assistant", content: "The result of 2+3 is 5." });
  });

  it("handles multiple sequential tool calls", async () => {
    const llm = new MockLLMProvider([
      {
        content: null,
        toolCalls: [
          { id: "c1", name: "calculator", arguments: '{"expression":"10*2"}' },
          { id: "c2", name: "calculator", arguments: '{"expression":"5+5"}' },
        ],
        finishReason: "tool_calls",
      },
      {
        content: "10*2=20 and 5+5=10",
        toolCalls: [],
        finishReason: "stop",
      },
    ]);
    const agent = new Agent({ config, llm, registry: makeRegistry() });

    const result = await agent.run("Calculate 10*2 and 5+5");
    expect(result.response).toBe("10*2=20 and 5+5=10");
    // user + assistant(tool_calls) + tool(c1) + tool(c2) + assistant(final)
    expect(result.messages).toHaveLength(5);
  });

  it("stops at maxIterations to prevent runaway loops", async () => {
    // LLM always returns tool calls — never stops
    const infiniteToolCalls: LLMResponse = {
      content: "thinking...",
      toolCalls: [
        { id: "loop", name: "calculator", arguments: '{"expression":"1+1"}' },
      ],
      finishReason: "tool_calls",
    };
    const llm = new MockLLMProvider(
      Array.from({ length: 20 }, () => infiniteToolCalls),
    );
    const agent = new Agent({
      config: { ...config, maxIterations: 3 },
      llm,
      registry: makeRegistry(),
    });

    const result = await agent.run("Loop forever");

    expect(result.iterations).toBe(3);
    expect(result.response).toContain("maximum number of reasoning steps");
  });

  it("handles unknown tool gracefully", async () => {
    const llm = new MockLLMProvider([
      {
        content: null,
        toolCalls: [
          { id: "bad", name: "nonexistent_tool", arguments: "{}" },
        ],
        finishReason: "tool_calls",
      },
      {
        content: "Sorry, that tool is not available.",
        toolCalls: [],
        finishReason: "stop",
      },
    ]);
    const agent = new Agent({ config, llm, registry: makeRegistry() });

    const result = await agent.run("Use a bad tool");
    // The tool result should contain an error
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("Unknown tool");
  });

  it("resets conversation history", async () => {
    const llm = new MockLLMProvider([
      { content: "First response", toolCalls: [], finishReason: "stop" },
      { content: "Second response", toolCalls: [], finishReason: "stop" },
    ]);
    const agent = new Agent({ config, llm, registry: makeRegistry() });

    await agent.run("First");
    expect(agent.getHistory()).toHaveLength(2);

    agent.reset();
    expect(agent.getHistory()).toHaveLength(0);

    await agent.run("Second");
    expect(agent.getHistory()).toHaveLength(2);
  });

  it("passes tool definitions to LLM", async () => {
    const llm = new MockLLMProvider([
      { content: "ok", toolCalls: [], finishReason: "stop" },
    ]);
    const agent = new Agent({ config, llm, registry: makeRegistry() });

    await agent.run("test");

    // Verify the LLM received tool definitions
    expect(llm.calls[0].tools.length).toBeGreaterThan(0);
    expect(llm.calls[0].tools[0].name).toBe("calculator");
  });
});
