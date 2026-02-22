/**
 * Demo Script — running the Agent with real LLM (DeepSeek / OpenAI compatible)
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

  const modelName = process.env.LLM_MODEL || "gpt-4o-mini";
  const llm = new OpenAIProvider({
    model: modelName,
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  });

  console.log(`Using LLM: ${modelName} @ ${process.env.OPENAI_BASE_URL || "OpenAI"}`);

  // Setup Tool Registry
  const registry = new ToolRegistry();
  registry.register(createReadTool(workspaceRoot));
  registry.register(createExecTool(workspaceRoot));
  registry.register(createSearchTool(workspaceRoot));

  // Skills discovery (Layer 1 — metadata only)
  const skillsLoader = new SkillsLoader(workspaceRoot, ["skills"]);
  const discoveredSkills = await skillsLoader.discover();
  console.log(
    `Discovered ${discoveredSkills.length} skill(s):`,
    discoveredSkills.map((s) => s.name).join(", "),
  );

  // Memory Compactor
  const compactor = new MemoryCompactor({
    llm,
    keepRecentCount: 6,
    summaryTokenLimit: 300,
  });

  // Initialize the Agent with onStep logging
  const agent = new Agent({
    config: {
      name: "OpenClaw-MVP",
      baseInstructions: [
        "You are an expert AI developer assistant.",
        "You have access to tools to read files, execute commands, and search code.",
        "",
        "## Rules",
        "1. Use tools to gather information BEFORE answering.",
        "2. After gathering enough information, provide a DIRECT and COMPLETE answer.",
        "3. Do NOT call tools unnecessarily — if you already have the data, answer immediately.",
        "4. Respond in the same language as the user's query.",
      ].join("\n"),
      model: modelName,
      workspaceRoot,
      maxIterations: 6,
    },
    llm,
    registry,
    skills: discoveredSkills,
    compactor,
    onStep: ({ iteration, toolCalls, toolResults, thinking }) => {
      console.log(`  [Step ${iteration}]`);
      if (thinking) {
        const preview = thinking.length > 120 ? thinking.slice(0, 120) + "..." : thinking;
        console.log(`    Thinking: ${preview}`);
      }
      for (const tc of toolCalls) {
        const argsPreview = tc.arguments.length > 80
          ? tc.arguments.slice(0, 80) + "..."
          : tc.arguments;
        console.log(`    → ${tc.name}(${argsPreview})`);
      }
      for (const tr of toolResults) {
        const resultPreview = tr.result.length > 100
          ? tr.result.slice(0, 100) + "..."
          : tr.result;
        console.log(`    ← ${tr.name}: ${resultPreview}`);
      }
    },
  });

  // Run
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

    const finalHistory = agent.getHistory();
    const compactionNotices = finalHistory.filter((m) =>
      m.content?.includes("Context summary"),
    );
    if (compactionNotices.length > 0) {
      console.log(
        `Context compaction triggered ${compactionNotices.length} time(s).`,
      );
    }
  } catch (error) {
    console.error("Error during agent run:", error);
  }
}

main().catch(console.error);
