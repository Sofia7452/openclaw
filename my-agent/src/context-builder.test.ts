import { describe, it, expect } from "vitest";
import { ContextBuilder } from "./context-builder.js";
import { ToolRegistry, defineTool } from "./tools/registry.js";
import type { AgentConfig, Message } from "./types.js";

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
  reg.register(
    defineTool(
      {
        name: "tool_b",
        description: "Tool B",
        parameters: { type: "object", properties: {}, required: [] },
      },
      async () => "b",
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
  it("builds context with system prompt and messages", () => {
    const builder = new ContextBuilder({
      config,
      registry: makeRegistry(),
    });
    const history: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = builder.build(history);

    expect(result.systemPrompt).toContain("You are a test agent.");
    expect(result.systemPrompt).toContain("tool_a");
    expect(result.systemPrompt).toContain("tool_b");
    expect(result.messages).toHaveLength(2);
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it("filters tools by allowlist", () => {
    const configWithAllowlist: AgentConfig = {
      ...config,
      toolAllowlist: ["tool_a"],
    };
    const builder = new ContextBuilder({
      config: configWithAllowlist,
      registry: makeRegistry(),
    });
    const result = builder.build([]);

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("tool_a");
    expect(result.systemPrompt).toContain("tool_a");
    expect(result.systemPrompt).not.toContain("tool_b");
  });

  it("prunes old messages when over token budget", () => {
    const builder = new ContextBuilder({
      config,
      registry: makeRegistry(),
      maxContextTokens: 500, // very tight budget
    });

    // Generate many messages to exceed budget
    const history: Message[] = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message number ${i} with some padding text to consume tokens. `.repeat(3),
    }));

    const result = builder.build(history);

    // Should have fewer messages than original
    expect(result.messages.length).toBeLessThan(history.length);
    // Should have a pruning notice
    expect(result.messages[0].content).toContain("pruned");
    // Last message should be preserved
    expect(result.messages[result.messages.length - 1].content).toContain("Message number 49");
  });

  it("preserves all messages when within budget", () => {
    const builder = new ContextBuilder({
      config,
      registry: makeRegistry(),
      maxContextTokens: 100_000,
    });
    const history: Message[] = [
      { role: "user", content: "short" },
      { role: "assistant", content: "reply" },
    ];
    const result = builder.build(history);
    expect(result.messages).toHaveLength(2);
  });

  it("includes skills metadata in system prompt", () => {
    const builder = new ContextBuilder({
      config,
      registry: makeRegistry(),
      skills: [
        {
          name: "test-skill",
          description: "A test skill",
          tags: ["test"],
          path: "skills/test/SKILL.md",
        },
      ],
    });
    const result = builder.build([]);
    expect(result.systemPrompt).toContain("Available Skills");
    expect(result.systemPrompt).toContain("test-skill");
  });

  it("supports adding extra sections dynamically", () => {
    const builder = new ContextBuilder({
      config,
      registry: makeRegistry(),
    });
    builder.addSection({ heading: "Memory", content: "User prefers dark mode." });
    const result = builder.build([]);
    expect(result.systemPrompt).toContain("## Memory");
    expect(result.systemPrompt).toContain("User prefers dark mode.");
  });
});
