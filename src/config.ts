import "dotenv/config";

export interface Config {
  geminiApiKey: string;
  geminiModel: string;
  mcpServerPath: string;
  /** Environment variables forwarded to the MCP server subprocess. */
  mcpServerEnv: Record<string, string>;
}

export function loadConfig(): Config {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const mcpServerPath = process.env.MCP_SERVER_PATH;
  if (!mcpServerPath) {
    throw new Error("MCP_SERVER_PATH environment variable is required");
  }

  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!solanaPrivateKey) {
    throw new Error("SOLANA_PRIVATE_KEY environment variable is required");
  }

  // Allowlist of env vars the MCP server needs (avoids leaking unrelated secrets)
  const mcpServerEnv: Record<string, string> = {
    SOLANA_PRIVATE_KEY: solanaPrivateKey,
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: process.env.NODE_ENV ?? "",
  };

  if (process.env.SOLANA_NETWORK) {
    mcpServerEnv.SOLANA_NETWORK = process.env.SOLANA_NETWORK;
  }
  if (process.env.SOLANA_RPC_URL) {
    mcpServerEnv.SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
  }

  return {
    geminiApiKey,
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview",
    mcpServerPath,
    mcpServerEnv,
  };
}
