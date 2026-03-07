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
 * Read-only tools that can run without user confirmation.
 * Any tool NOT in this set is treated as destructive and requires confirmation,
 * so newly added MCP tools are safe by default.
 */
const READ_ONLY_TOOLS = new Set([
  "get_wallet_info",
  "get_sol_balance",
  "get_usdc_balance",
  "get_incoming_usdc_payments",
]);

/**
 * Convert MCP tool JSON-Schema inputSchema to Gemini FunctionDeclaration format.
 * MCP uses standard JSON Schema types (lowercase), Gemini uses its own Type enum (uppercase).
 */
function convertSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const schemaType = schema.type;
  if (typeof schemaType === "string") {
    result.type = schemaType.toUpperCase();
  } else if (Array.isArray(schemaType)) {
    const firstStringType = schemaType.find(
      (t): t is string => typeof t === "string",
    );
    if (firstStringType) {
      result.type = firstStringType.toUpperCase();
    }
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

export type ConfirmFn = (toolName: string, args: Record<string, unknown>) => Promise<boolean>;

/** Default: reject destructive tool calls when no confirmation callback is provided. */
const rejectByDefault: ConfirmFn = async () => false;

/**
 * Run the agent loop. Appends the new user message and all model/tool turns
 * to `history` so callers can maintain multi-turn conversation state.
 */
export async function runAgent(
  apiKey: string,
  model: string,
  mcpClient: McpClient,
  userMessage: string,
  history: Content[],
  confirmFn: ConfirmFn = rejectByDefault,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });

  const functionDeclarations = mcpToolsToGeminiDeclarations(mcpClient);

  history.push({ role: "user", parts: [{ text: userMessage }] });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model,
      contents: history,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations }],
      },
    });

    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      const text = response.text ?? "(no response)";
      // Use raw content to preserve any model metadata (e.g., thought signatures)
      const modelContent = response.candidates?.[0]?.content;
      history.push(modelContent ?? { role: "model", parts: [{ text }] });
      return text;
    }

    // Push the raw model content to preserve thought signatures required by Gemini 3.x
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) {
      history.push(modelContent);
    } else {
      const modelParts: Part[] = functionCalls.map((fc) => ({ functionCall: fc }));
      history.push({ role: "model", parts: modelParts });
    }

    // Execute each function call and collect responses
    const responseParts: Part[] = [];
    for (const fc of functionCalls) {
      // Treat missing tool name as a malformed call — skip execution.
      if (!fc.name) {
        responseParts.push({
          functionResponse: {
            id: fc.id,
            name: "unknown",
            response: { error: "Missing tool name in function call." },
          },
        });
        continue;
      }

      const toolName = fc.name;
      const toolArgs = (fc.args as Record<string, unknown>) ?? {};

      let output: Record<string, unknown>;
      try {
        if (!READ_ONLY_TOOLS.has(toolName)) {
          const approved = await confirmFn(toolName, toolArgs);
          if (!approved) {
            output = { error: "User declined the operation." };
            responseParts.push({
              functionResponse: { id: fc.id, name: toolName, response: output },
            });
            continue;
          }
        }

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

    history.push({ role: "user", parts: responseParts });
  }

  return "(agent reached maximum tool-calling rounds)";
}
