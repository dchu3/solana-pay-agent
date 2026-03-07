import "dotenv/config";
import { z } from "zod";

export interface Config {
  geminiApiKey: string;
  geminiModel: string;
  mcpServerPath: string;
  /** Environment variables forwarded to the MCP server subprocess. */
  mcpServerEnv: Record<string, string>;
}

const EnvSchema = z.object({
  GEMINI_API_KEY: z
    .string({ required_error: "GEMINI_API_KEY environment variable is required" })
    .min(1, "GEMINI_API_KEY environment variable is required"),
  MCP_SERVER_PATH: z
    .string({ required_error: "MCP_SERVER_PATH environment variable is required" })
    .min(1, "MCP_SERVER_PATH environment variable is required")
    .refine(
      (value) => !value.trimStart().startsWith("-"),
      "MCP_SERVER_PATH must be a script path and must not start with '-'",
    ),
  SOLANA_PRIVATE_KEY: z
    .string({ required_error: "SOLANA_PRIVATE_KEY environment variable is required" })
    .min(1, "SOLANA_PRIVATE_KEY environment variable is required"),
  GEMINI_MODEL: z.string().optional(),
  SOLANA_NETWORK: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return val;
      const lower = val.toLowerCase();
      // Normalize "mainnet-beta" to "mainnet" (Solana RPC cluster name vs MCP server expectation)
      if (lower === "mainnet-beta") return "mainnet";
      return lower;
    })
    .refine(
      (val) => !val || val === "mainnet" || val === "devnet",
      'SOLANA_NETWORK must be "mainnet", "mainnet-beta", or "devnet"',
    ),
  SOLANA_RPC_URL: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export function loadConfig(): Config {
  const env = EnvSchema.parse(process.env);

  // Allowlist of env vars the MCP server needs (avoids leaking unrelated secrets)
  const mcpServerEnv: Record<string, string> = {
    SOLANA_PRIVATE_KEY: env.SOLANA_PRIVATE_KEY,
  };

  // Forward OS-critical env vars so the subprocess works across platforms
  const platformVars = [
    "PATH",
    "Path",
    "HOME",
    "NODE_ENV",
    // Windows-critical
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
  ];
  for (const key of platformVars) {
    if (process.env[key] !== undefined) {
      mcpServerEnv[key] = process.env[key]!;
    }
  }

  if (env.SOLANA_NETWORK) {
    mcpServerEnv.SOLANA_NETWORK = env.SOLANA_NETWORK;
  }
  if (env.SOLANA_RPC_URL) {
    mcpServerEnv.SOLANA_RPC_URL = env.SOLANA_RPC_URL;
  }

  return {
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview",
    mcpServerPath: env.MCP_SERVER_PATH,
    mcpServerEnv,
  };
}
