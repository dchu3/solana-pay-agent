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
 *
 * Plain fetch is used for the transport (connect / listTools) so that metadata
 * calls never trigger an automatic payment. The x402-paying fetch is only used
 * inside callTool, where the agent's confirmation flow has already approved the
 * call, preventing unexpected charges during setup.
 */
export async function createRemoteMcpClient(
  url: string,
  solanaPrivateKey: string,
): Promise<McpClient> {
  const paidFetch = await createX402Fetch(solanaPrivateKey);

  // Use a separate transport for paid tool calls so that connect/listTools
  // go through plain fetch and never trigger x402 payments.
  const transport = new StreamableHTTPClientTransport(new URL(url));

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

        // Each tool call uses a fresh x402-paying transport so the payment
        // wrapper can intercept 402 responses and retry with a signed payment.
        const paidTransport = new StreamableHTTPClientTransport(
          new URL(url),
          { fetch: paidFetch },
        );
        const paidClient = new Client({ name: "solana-pay-agent", version: packageJson.version });
        await paidClient.connect(paidTransport);

        try {
          const result = await paidClient.callTool({ name, arguments: args });
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
        } finally {
          await paidClient.close().catch(() => {});
        }
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
