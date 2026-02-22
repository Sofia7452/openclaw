/**
 * Demo Script — running the Agent with real OpenAI LLM
 *
 * This script demonstrates:
 * 1. Skills discovery (progressive disclosure Layer 1)
 * 2. Tool registration (read, exec, search)
 * 3. ReAct loop with real LLM inference
 * 4. Automatic context engineering (system prompt + history management)
 * 5. Memory compaction (if history becomes too long)
 */

import "dotenv/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Agent,
  ToolRegistry,
  createReadTool,
  createExecTool,
  createSearchTool,
  OpenAIProvider,
  SkillsLoader,
  MemoryCompactor,
} from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, ".."); // points to my-agent/

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is not set.");
    console.log("Please create a .env file with OPENAI_API_KEY=your-key-here");
    process.exit(1);
  }

  // 1. Initialize LLM Provider (use from env or default to gpt-4o-mini)
  const modelName = process.env.LLM_MODEL || "gpt-4o-mini";
  const llm = new OpenAIProvider({
    model: modelName,
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL, // Optional for custom endpoints
  });

  console.log(`Using LLM: ${modelName} @ ${process.env.OPENAI_BASE_URL || "OpenAI"}`);

  // 2. Setup Tool Registry with core tools
  const registry = new ToolRegistry();
  registry.register(createReadTool(workspaceRoot));
  registry.register(createExecTool(workspaceRoot));
  registry.register(createSearchTool(workspaceRoot));

  // 3. Setup Skills Loader and discover initial skills (Layer 1)
  const skillsLoader = new SkillsLoader(workspaceRoot, ["skills"]);
  const discoveredSkills = await skillsLoader.discover();
  console.log(`Discovered ${discoveredSkills.length} skill(s):`, 
    discoveredSkills.map(s => s.name).join(", "));

  // 4. Setup Memory Compactor for long context management
  const compactor = new MemoryCompactor({
    llm,
    keepRecentCount: 4, // for demo purposes, keep it small to test behavior
    summaryTokenLimit: 300,
  });

  // 5. Initialize the Agent
  const agent = new Agent({
    config: {
      name: "OpenClaw-MVP",
      baseInstructions: "You are an expert AI developer and systems engineer. " +
        "You always use the available tools to verify your answers.",
      model: modelName,
      workspaceRoot,
      maxIterations: 10,
    },
    llm,
    registry,
    skills: discoveredSkills,
    compactor,
  });

  // 6. Run a sample query that triggers tool usage and skill discovery
  const query = "分析一下这个项目的结构，告诉我 package.json 里的依赖有哪些。";
  
  console.log("\n--- User Query ---");
  console.log(query);
  console.log("\n--- Agent Thinking & Execution ---\n");

  try {
    const result = await agent.run(query);
    
    console.log("\n--- Final Response ---\n");
    console.log(result.response);
    
    console.log("\n--- Stats ---");
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Total Token Estimate: ${result.totalTokens}`);
    
    // Check if any compaction happened
    const finalHistory = agent.getHistory();
    const compactionNotices = finalHistory.filter(m => m.content?.includes("Context summary"));
    if (compactionNotices.length > 0) {
      console.log(`Context compaction triggered ${compactionNotices.length} time(s).`);
    }

  } catch (error) {
    console.error("Error during agent run:", error);
  }
}

main().catch(console.error);
