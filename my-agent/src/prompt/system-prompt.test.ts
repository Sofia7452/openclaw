import { describe, it, expect } from "vitest";
import { buildSystemPrompt, estimateTokens } from "./system-prompt.js";
import type { AgentConfig, SkillMeta, ToolDefinition } from "../types.js";

const baseConfig: AgentConfig = {
  name: "test-agent",
  baseInstructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
};

const sampleTool: ToolDefinition = {
  name: "read_file",
  description: "Read a file",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

const sampleSkill: SkillMeta = {
  name: "sql-analysis",
  description: "Analyze MySQL databases with natural language queries",
  tags: ["database", "sql"],
  path: "skills/sql-analysis/SKILL.md",
};

describe("buildSystemPrompt", () => {
  it("includes base instructions", () => {
    const prompt = buildSystemPrompt({ config: baseConfig, tools: [] });
    expect(prompt).toContain("You are a helpful assistant.");
  });

  it("includes runtime info", () => {
    const prompt = buildSystemPrompt({ config: baseConfig, tools: [] });
    expect(prompt).toContain("Agent: test-agent");
    expect(prompt).toContain("Model: gpt-4o-mini");
  });

  it("includes tool descriptions when tools are provided", () => {
    const prompt = buildSystemPrompt({
      config: baseConfig,
      tools: [sampleTool],
    });
    expect(prompt).toContain("Available Tools");
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("Read a file");
  });

  it("omits tools section when no tools", () => {
    const prompt = buildSystemPrompt({ config: baseConfig, tools: [] });
    expect(prompt).not.toContain("Available Tools");
  });

  it("includes skill metadata in progressive disclosure format", () => {
    const prompt = buildSystemPrompt({
      config: baseConfig,
      tools: [],
      skills: [sampleSkill],
    });
    expect(prompt).toContain("Available Skills");
    expect(prompt).toContain("sql-analysis");
    expect(prompt).toContain("Analyze MySQL databases");
    expect(prompt).toContain("read_file tool to load");
    expect(prompt).toContain("skills/sql-analysis/SKILL.md");
  });

  it("includes extra sections", () => {
    const prompt = buildSystemPrompt({
      config: baseConfig,
      tools: [],
      extraSections: [
        { heading: "Workspace", content: "Project root: /app" },
      ],
    });
    expect(prompt).toContain("## Workspace");
    expect(prompt).toContain("Project root: /app");
  });

  it("separates sections with dividers", () => {
    const prompt = buildSystemPrompt({
      config: baseConfig,
      tools: [sampleTool],
    });
    expect(prompt).toContain("---");
  });
});

describe("estimateTokens", () => {
  it("estimates English text (~4 chars per token)", () => {
    const text = "Hello, world!"; // 13 chars → ~3-4 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThanOrEqual(3);
    expect(tokens).toBeLessThanOrEqual(5);
  });

  it("estimates CJK text (~2 chars per token)", () => {
    const text = "你好世界"; // 4 CJK chars → ~2 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThanOrEqual(1);
    expect(tokens).toBeLessThanOrEqual(4);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});
