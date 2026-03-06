import * as readline from "node:readline/promises";
import { loadConfig } from "./config.js";
import { createMcpClient } from "./mcp-client.js";
import { runAgent } from "./agent.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("Connecting to MCP server...");
  const mcpClient = await createMcpClient(
    config.mcpServerPath,
    config.mcpServerEnv,
  );

  const toolNames = mcpClient.tools.map((t) => t.name).join(", ");
  console.log(`Connected. Available tools: ${toolNames}`);
  console.log(`Using model: ${config.geminiModel}`);
  console.log('Type your message, or /quit to exit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const shutdown = async (): Promise<void> => {
    rl.close();
    await mcpClient.close();
  };

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await shutdown();
    process.exit(0);
  });

  try {
    for await (const line of rl) {
      const input = line.trim();
      if (!input) continue;
      if (input === "/quit") break;

      try {
        const answer = await runAgent(
          config.geminiApiKey,
          config.geminiModel,
          mcpClient,
          input,
        );
        console.log(`\n${answer}\n`);
      } catch (err) {
        console.error(
          "Error:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } finally {
    await shutdown();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
