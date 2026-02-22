import { describe, it, expect } from "vitest";
import { ToolRegistry, defineTool } from "./registry.js";

function makeDummyTool(name: string) {
  return defineTool(
    {
      name,
      description: `Tool ${name}`,
      parameters: {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
      },
    },
    async (args) => `echo: ${args.input}`,
  );
}

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const reg = new ToolRegistry();
    reg.register(makeDummyTool("alpha"));
    reg.register(makeDummyTool("beta"));

    expect(reg.size).toBe(2);
    expect(reg.has("alpha")).toBe(true);
    expect(reg.has("gamma")).toBe(false);
    expect(reg.names()).toEqual(["alpha", "beta"]);
  });

  it("rejects duplicate registration", () => {
    const reg = new ToolRegistry();
    reg.register(makeDummyTool("dup"));
    expect(() => reg.register(makeDummyTool("dup"))).toThrow(
      'Tool "dup" is already registered',
    );
  });

  it("unregisters tools", () => {
    const reg = new ToolRegistry();
    reg.register(makeDummyTool("temp"));
    expect(reg.unregister("temp")).toBe(true);
    expect(reg.has("temp")).toBe(false);
    expect(reg.unregister("nonexistent")).toBe(false);
  });

  it("executes a tool and returns result", async () => {
    const reg = new ToolRegistry();
    reg.register(makeDummyTool("echo"));
    const result = await reg.execute("echo", '{"input":"hello"}');
    expect(result).toBe("echo: hello");
  });

  it("returns error JSON for unknown tool", async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute("missing", "{}");
    expect(JSON.parse(result)).toEqual({ error: "Unknown tool: missing" });
  });

  it("returns error JSON for malformed arguments", async () => {
    const reg = new ToolRegistry();
    reg.register(makeDummyTool("broken"));
    const result = await reg.execute("broken", "not-json");
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("filters definitions by allowlist", () => {
    const reg = new ToolRegistry();
    reg.register(makeDummyTool("a"));
    reg.register(makeDummyTool("b"));
    reg.register(makeDummyTool("c"));

    const all = reg.allDefinitions();
    expect(all).toHaveLength(3);

    const filtered = reg.filteredDefinitions(["a", "c"]);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((d) => d.name)).toEqual(["a", "c"]);
  });

  it("returns all definitions when allowlist is empty", () => {
    const reg = new ToolRegistry();
    reg.register(makeDummyTool("x"));
    expect(reg.filteredDefinitions([])).toHaveLength(1);
    expect(reg.filteredDefinitions(undefined)).toHaveLength(1);
  });
});
