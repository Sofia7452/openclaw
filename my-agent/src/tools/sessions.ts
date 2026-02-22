import { Agent, type AgentOptions } from "../agent.js";
import { defineTool } from "../tools/registry.js";
import type { Tool } from "../types.js";

/**
 * Sub-agent tool — the "delegate" mechanism.
 * 
 * Implements the ISOLATE strategy for context engineering:
 * 1. Spawns a fresh child agent for a specific sub-task.
 * 2. Child agent has its own context window, preventing history pollution.
 * 3. Child agent can be restricted to a specific set of tools (optional).
 * 4. Parent agent waits for the child's result and receives it as context.
 *
 * This is crucial for complex tasks that involve multiple sub-problems.
 */

export interface SessionsToolOptions {
  /** The parent agent's options to use as a template for child agents */
  parentOptions: AgentOptions;
}

export function createSessionsTool(options: SessionsToolOptions): Tool {
  return defineTool(
    {
      name: "sessions_spawn",
      description: "Spawn a sub-agent to perform a specific sub-task. " +
        "This is useful for complex problems that need to be broken down. " +
        "The sub-agent will start with a fresh history and its own context window.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The task or question to delegate to the sub-agent."
          },
          subAgentName: {
            type: "string",
            description: "A descriptive name for the sub-agent (optional)."
          },
          additionalInstructions: {
            type: "string",
            description: "Any extra instructions or constraints for the sub-agent (optional)."
          },
          toolAllowlist: {
            type: "array",
            items: { type: "string" },
            description: "A list of tools the sub-agent is allowed to use (optional)."
          }
        },
        required: ["query"]
      }
    },
    async (args) => {
      const query = args.query as string;
      const subAgentName = (args.subAgentName as string) || "SubAgent";
      const additionalInstructions = (args.additionalInstructions as string) || "";
      const toolAllowlist = args.toolAllowlist as string[] | undefined;

      // Create a fresh child agent using the parent's LLM and Registry
      const childAgent = new Agent({
        config: {
          ...options.parentOptions.config,
          name: subAgentName,
          baseInstructions: `${options.parentOptions.config.baseInstructions}\n\n${additionalInstructions}`,
          toolAllowlist: toolAllowlist || options.parentOptions.config.toolAllowlist,
          // Child agents are usually shorter-lived
          maxIterations: options.parentOptions.config.maxIterations || 10,
        },
        llm: options.parentOptions.llm,
        registry: options.parentOptions.registry,
        skills: options.parentOptions.skills,
        // Optional: child agents could use a more aggressive compactor or different context limits
      });

      try {
        const result = await childAgent.run(query);
        return `Sub-agent [${subAgentName}] response:\n\n${result.response}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Sub-agent [${subAgentName}] error: ${msg}`;
      }
    }
  );
}
