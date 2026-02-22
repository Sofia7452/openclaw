import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LongTermMemory } from "./long-term.js";

const WORKSPACE = join(process.cwd(), "temp-memory-test");

describe("LongTermMemory", () => {
  beforeAll(async () => {
    await mkdir(WORKSPACE, { recursive: true });
  });

  afterAll(async () => {
    await rm(WORKSPACE, { recursive: true, force: true });
  });

  it("reads empty memory if file doesn't exist", async () => {
    const memory = new LongTermMemory(WORKSPACE);
    const content = await memory.read();
    expect(content).toBe("");
  });

  it("writes and reads memory", async () => {
    const memory = new LongTermMemory(WORKSPACE);
    await memory.write("User prefers TypeScript.");
    const content = await memory.read();
    expect(content).toBe("User prefers TypeScript.");
  });

  it("provides a tool to update memory", async () => {
    const memory = new LongTermMemory(WORKSPACE);
    const tool = memory.createTool();
    
    expect(tool.definition.name).toBe("update_memory");
    
    const result = await tool.handler({ content: "New memory content." });
    expect(result).toContain("successfully");
    
    const content = await memory.read();
    expect(content).toBe("New memory content.");
  });
});
