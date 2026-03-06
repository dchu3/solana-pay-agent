import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

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
    stderr: "pipe",
  });

  const client = new Client({ name: "solana-pay-agent", version: "1.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();

  return {
    tools,

    async callTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<string> {
      const result = await client.callTool({ name, arguments: args });

      const parts = (result.content ?? []) as Array<{
        type: string;
        text?: string;
      }>;
      return parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!)
        .join("\n");
    },

    async close(): Promise<void> {
      await client.close();
    },
  };
}
