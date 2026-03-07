import "dotenv/config";
import { z } from "zod";
import bs58 from "bs58";

export interface Config {
  geminiApiKey: string;
  geminiModel: string;
  mcpServerPath: string;
  /** The user's Solana wallet public address (derived from SOLANA_PRIVATE_KEY). */
  walletAddress: string;
  /** Environment variables forwarded to the MCP server subprocess. */
  mcpServerEnv: Record<string, string>;
  verbose: boolean;
  /** When set, starts an x402 seller HTTP server on this port. */
  x402ServerPort?: number;
  /** Facilitator URL for x402 payment verification. */
  x402FacilitatorUrl: string;
  /** Solana network identifier for x402 (e.g., "solana:mainnet" or "solana:devnet"). */
  x402Network: `${string}:${string}`;
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
  VERBOSE: z.string().optional(),
  X402_SERVER_PORT: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .refine(
      (val) => val === undefined || (Number.isInteger(val) && val > 0 && val <= 65535),
      "X402_SERVER_PORT must be a valid port number (1-65535)",
    ),
  X402_FACILITATOR_URL: z.string().optional(),
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

  // Derive the wallet public address from the private key.
  // Solana keypairs are 64 bytes: first 32 = secret key, last 32 = public key.
  const keypairBytes = bs58.decode(env.SOLANA_PRIVATE_KEY);
  if (keypairBytes.length !== 64) {
    throw new Error(
      `SOLANA_PRIVATE_KEY must decode to a 64-byte keypair (got ${keypairBytes.length} bytes)`,
    );
  }
  const walletAddress = bs58.encode(keypairBytes.slice(32));

  const solanaNetwork = env.SOLANA_NETWORK ?? "devnet";

  return {
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview",
    mcpServerPath: env.MCP_SERVER_PATH,
    walletAddress,
    mcpServerEnv,
    verbose: env.VERBOSE === "true" || env.VERBOSE === "1",
    x402ServerPort: env.X402_SERVER_PORT,
    x402FacilitatorUrl: env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    x402Network: `solana:${solanaNetwork}`,
  };
}
