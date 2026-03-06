import {
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type Part,
} from "@google/genai";
import type { McpClient } from "./mcp-client.js";

const SYSTEM_INSTRUCTION = `You are a helpful Solana payment assistant. You have access to tools that let you:
- Check the wallet USDC balance
- Send USDC payments to other wallets
- View recent incoming USDC payments
- Make payments via the x402 protocol

When the user asks you to perform a payment action, use the appropriate tool. Always confirm amounts and addresses before executing transactions. Report results clearly.`;

/**
 * Convert MCP tool JSON-Schema inputSchema to Gemini FunctionDeclaration format.
 * MCP uses standard JSON Schema types (lowercase), Gemini uses its own Type enum (uppercase).
 */
function convertSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (schema.type) {
    result.type = (schema.type as string).toUpperCase();
  }
  if (schema.description) {
    result.description = schema.description;
  }
  if (schema.enum) {
    result.enum = schema.enum;
  }
  if (schema.required) {
    result.required = schema.required;
  }

  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      schema.properties as Record<string, Record<string, unknown>>,
    )) {
      props[key] = convertSchema(value);
    }
    result.properties = props;
  }

  if (schema.items) {
    result.items = convertSchema(schema.items as Record<string, unknown>);
  }

  return result;
}

function mcpToolsToGeminiDeclarations(
  mcpClient: McpClient,
): FunctionDeclaration[] {
  return mcpClient.tools.map((tool) => {
    const decl: FunctionDeclaration = {
      name: tool.name,
      description: tool.description ?? "",
    };

    if (tool.inputSchema) {
      decl.parameters = convertSchema(
        tool.inputSchema as unknown as Record<string, unknown>,
      ) as FunctionDeclaration["parameters"];
    }

    return decl;
  });
}

const MAX_TOOL_ROUNDS = 10;

export async function runAgent(
  apiKey: string,
  model: string,
  mcpClient: McpClient,
  userMessage: string,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });

  const functionDeclarations = mcpToolsToGeminiDeclarations(mcpClient);

  const contents: Content[] = [
    { role: "user", parts: [{ text: userMessage }] },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations }],
      },
    });

    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      return response.text ?? "(no response)";
    }

    // Append the model's function-call turn
    const modelParts: Part[] = functionCalls.map((fc) => ({ functionCall: fc }));
    contents.push({ role: "model", parts: modelParts });

    // Execute each function call and collect responses
    const responseParts: Part[] = [];
    for (const fc of functionCalls) {
      const toolName = fc.name ?? "unknown";
      const toolArgs = (fc.args as Record<string, unknown>) ?? {};

      let output: Record<string, unknown>;
      try {
        const resultText = await mcpClient.callTool(toolName, toolArgs);
        output = { result: resultText };
      } catch (err) {
        output = {
          error: err instanceof Error ? err.message : String(err),
        };
      }

      responseParts.push({
        functionResponse: { id: fc.id, name: toolName, response: output },
      });
    }

    contents.push({ role: "user", parts: responseParts });
  }

  return "(agent reached maximum tool-calling rounds)";
}
