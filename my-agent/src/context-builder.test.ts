import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ContextBuilder } from "./context-builder.js";
import { ToolRegistry, defineTool } from "./tools/registry.js";
import { MemoryCompactor } from "./memory/compaction.js";
import { MockLLMProvider } from "./llm/mock-provider.js";
import { LongTermMemory } from "./memory/long-term.js";
import type { AgentConfig, Message } from "./types.js";

const WORKSPACE = join(process.cwd(), "temp-ctx-test");

function makeRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(
    defineTool(
      {
        name: "tool_a",
        description: "Tool A",
        parameters: { type: "object", properties: {}, required: [] },
      },
      async () => "a",
    ),
  );
  return reg;
}

const config: AgentConfig = {
  name: "ctx-test",
  baseInstructions: "You are a test agent.",
  model: "test-model",
};

describe("ContextBuilder", () => {
  beforeAll(async () => {
    await mkdir(WORKSPACE, { recursive: true });
  });

  afterAll(async () => {
    await rm(WORKSPACE, { recursive: true, force: true });
  });

  it("builds context with system prompt and messages", async () => {
    const builder = new ContextBuilder({ config, registry: makeRegistry() });
    const result = await builder.build([{ role: "user", content: "Hello" }]);
    expect(result.systemPrompt).toContain("You are a test agent.");
    expect(result.messages).toHaveLength(1);
  });

  it("injects long-term memory", async () => {
    const memory = new LongTermMemory(WORKSPACE);
    await memory.write("User likes testing.");
    const builder = new ContextBuilder({ config, registry: makeRegistry(), memory });
    const result = await builder.build([]);
    expect(result.systemPrompt).toContain("## Long-Term Memory");
    expect(result.systemPrompt).toContain("User likes testing.");
  });

  it("uses compaction when needed", async () => {
    const mockLlm = new MockLLMProvider([
      { content: "Summary.", toolCalls: [], finishReason: "stop" },
    ]);
    const compactor = new MemoryCompactor({ llm: mockLlm, keepRecentCount: 1 });
    const builder = new ContextBuilder({
      config,
      registry: makeRegistry(),
      compactor,
      maxContextTokens: 200, // Trigger compaction easily
    });

    const history: Message[] = [
      { role: "user", content: "Message 1 ".repeat(10) },
      { role: "assistant", content: "Message 2 ".repeat(10) },
      { role: "user", content: "Message 3 ".repeat(10) },
      { role: "assistant", content: "Message 4 ".repeat(10) },
      { role: "user", content: "Message 5 ".repeat(10) },
    ];

    const result = await builder.build(history);
    expect(result.updatedHistory).toBeDefined();
    expect(result.messages[0].content).toContain("Context summary:");
    expect(result.messages[0].content).toContain("Summary.");
  });
});
