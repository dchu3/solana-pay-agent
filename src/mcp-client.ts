import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { debug } from "./logger.js";
import { createX402Fetch } from "./x402-fetch.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

export interface McpClient {
  tools: Tool[];
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export async function createMcpClient(
  serverPath: string,
  env: Record<string, string>,
): Promise<McpClient> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env,
    stderr: "inherit",
  });

  const client = new Client({ name: "solana-pay-agent", version: packageJson.version });

  try {
    await client.connect(transport);
    debug("MCP client connected");

    const { tools } = await client.listTools();
    debug(`MCP server provides ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

    return {
      tools,

      async callTool(
        name: string,
        args: Record<string, unknown>,
      ): Promise<string> {
        debug(`MCP callTool: ${name}(${JSON.stringify(args)})`);
        const result = await client.callTool({ name, arguments: args });
        debug(`MCP callTool ${name} raw result: ${JSON.stringify(result)}`);

        const parts = (result.content ?? []) as Array<{
          type: string;
          text?: string;
          [key: string]: unknown;
        }>;
        return parts
          .map((p) => {
            if (p.type === "text" && typeof p.text === "string") {
              return p.text;
            }
            try {
              return JSON.stringify(p);
            } catch {
              return String(p);
            }
          })
          .filter((s) => s.length > 0)
          .join("\n");
      },

      async close(): Promise<void> {
        await client.close();
      },
    };
  } catch (error) {
    try {
      await client.close();
    } catch {
      // Ignore cleanup errors to preserve the original error.
    }
    throw error;
  }
}

/**
 * Connect to a remote MCP server over StreamableHTTP with x402 payment support.
 * When the server returns 402, the x402 fetch wrapper automatically signs a
 * Solana USDC payment and retries the request.
 */
export async function createRemoteMcpClient(
  url: string,
  solanaPrivateKey: string,
): Promise<McpClient> {
  const paidFetch = await createX402Fetch(solanaPrivateKey);

  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    { fetch: paidFetch },
  );

  const client = new Client({ name: "solana-pay-agent", version: packageJson.version });

  try {
    await client.connect(transport);
    debug(`Remote MCP client connected to ${url}`);

    const { tools } = await client.listTools();
    debug(`Remote MCP server provides ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

    return {
      tools,

      async callTool(
        name: string,
        args: Record<string, unknown>,
      ): Promise<string> {
        debug(`MCP callTool: ${name}(${JSON.stringify(args)})`);
        const result = await client.callTool({ name, arguments: args });
        debug(`MCP callTool ${name} raw result: ${JSON.stringify(result)}`);

        const parts = (result.content ?? []) as Array<{
          type: string;
          text?: string;
          [key: string]: unknown;
        }>;
        return parts
          .map((p) => {
            if (p.type === "text" && typeof p.text === "string") {
              return p.text;
            }
            try {
              return JSON.stringify(p);
            } catch {
              return String(p);
            }
          })
          .filter((s) => s.length > 0)
          .join("\n");
      },

      async close(): Promise<void> {
        await client.close();
      },
    };
  } catch (error) {
    try {
      await client.close();
    } catch {
      // Ignore cleanup errors to preserve the original error.
    }
    throw error;
  }
}
