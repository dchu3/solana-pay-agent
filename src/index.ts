import * as readline from "node:readline/promises";
import { loadConfig } from "./config.js";
import { createMcpClient } from "./mcp-client.js";
import { type Content } from "@google/genai";
import { runAgent } from "./agent.js";
import { setVerbose } from "./logger.js";

async function main(): Promise<void> {
  const verbose =
    process.argv.includes("--verbose") || process.argv.includes("-v");
  const config = loadConfig();
  setVerbose(verbose || config.verbose);

  console.log("Connecting to MCP server...");
  const mcpClient = await createMcpClient(
    config.mcpServerPath,
    config.mcpServerEnv,
  );

  const toolNames = mcpClient.tools.map((t) => t.name).join(", ");
  console.log(`Connected. Available tools: ${toolNames}`);
  console.log(`Using model: ${config.geminiModel}`);
  if (verbose || config.verbose) {
    console.log("Verbose logging enabled (debug output on stderr)");
  }
  console.log("Type your message, or /quit to exit.\n");

  const conversationHistory: Content[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    rl.close();
    await mcpClient.close();
  };

  const handleSignal = () => {
    (async () => {
      console.log("\nShutting down...");
      try {
        await shutdown();
        process.exit(0);
      } catch (err) {
        console.error(
          "Error during shutdown:",
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    })();
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    while (!shuttingDown) {
      let input: string;
      try {
        input = await rl.question("> ");
      } catch {
        // readline was closed (e.g., EOF or shutdown)
        break;
      }
      const trimmed = input.trim();
      if (!trimmed) continue;
      if (trimmed === "/quit") break;

      try {
        const confirmFn = async (
          toolName: string,
          args: Record<string, unknown>,
        ): Promise<boolean> => {
          const answer = await rl.question(
            `\n⚠️  Confirm ${toolName} with ${JSON.stringify(args)}? (y/N) `,
          );
          return answer.trim().toLowerCase() === "y";
        };

        const answer = await runAgent(
          config.geminiApiKey,
          config.geminiModel,
          mcpClient,
          trimmed,
          conversationHistory,
          confirmFn,
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
