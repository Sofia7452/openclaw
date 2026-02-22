import { describe, it, expect } from "vitest";
import { Agent } from "../agent.js";
import { ToolRegistry } from "./registry.js";
import { MockLLMProvider } from "../llm/mock-provider.js";
import { createSessionsTool } from "./sessions.js";
import type { AgentConfig } from "../types.js";

const config: AgentConfig = {
  name: "parent-agent",
  baseInstructions: "You are a parent assistant.",
  model: "mock",
};

describe("sessions_spawn tool", () => {
  it("spawns a child agent and returns its response", async () => {
    const registry = new ToolRegistry();
    const llm = new MockLLMProvider([
      { content: "Sub-agent result.", toolCalls: [], finishReason: "stop" },
    ]);

    const options = {
      config,
      llm,
      registry,
    };

    const sessionsTool = createSessionsTool({ parentOptions: options });
    
    const result = await sessionsTool.handler({
      query: "Child task",
      subAgentName: "Child",
    });

    expect(result).toContain("Sub-agent [Child] response:");
    expect(result).toContain("Sub-agent result.");
    
    // Check that the mock LLM was called with the child's query
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].messages.find(m => m.role === "user")?.content).toBe("Child task");
  });

  it("handles errors in child agent execution", async () => {
    const registry = new ToolRegistry();
    const llm = new MockLLMProvider([]); // No mock responses, will error

    const options = {
      config,
      llm,
      registry,
    };

    const sessionsTool = createSessionsTool({ parentOptions: options });
    
    const result = await sessionsTool.handler({
      query: "Failing task",
    });

    expect(result).toContain("Sub-agent [SubAgent] response:");
    expect(result).toContain("No more mock responses configured.");
  });
});
