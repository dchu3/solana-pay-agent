import {
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type Part,
} from "@google/genai";
import type { McpClient } from "./mcp-client.js";
import { debug } from "./logger.js";

const SYSTEM_INSTRUCTION = (walletAddress: string, toolNames: string[]) => {
  const toolSet = new Set(toolNames);
  const capabilities: string[] = [];
  if (toolSet.has("get_usdc_balance") || toolSet.has("get_sol_balance"))
    capabilities.push("- Check the wallet USDC/SOL balance");
  if (toolSet.has("send_usdc")) capabilities.push("- Send USDC payments to other wallets");
  if (toolSet.has("get_incoming_usdc_payments"))
    capabilities.push("- View recent incoming USDC payments");
  if (toolSet.has("analyze_token"))
    capabilities.push(
      "- Analyze tokens using the analyze_token tool (payment is handled automatically by the x402 protocol — do NOT send USDC manually)",
    );

  // Fallback for unknown tools
  const knownTools = new Set([
    "get_usdc_balance",
    "get_sol_balance",
    "send_usdc",
    "get_incoming_usdc_payments",
    "get_wallet_info",
    "analyze_token",
  ]);
  const unknownTools = toolNames.filter((t) => !knownTools.has(t));
  if (unknownTools.length > 0) {
    capabilities.push(`- Use these tools: ${unknownTools.join(", ")}`);
  }

  return `You are a helpful Solana assistant. The user's wallet address is: ${walletAddress}

You have access to tools that let you:
${capabilities.join("\n")}

When the user refers to "my wallet", "my balance", or similar, use their wallet address shown above. When the user asks you to perform an action, use the appropriate tool. Always confirm amounts and addresses before executing transactions. Report results clearly.

IMPORTANT: Only use tools that are explicitly available to you. Do NOT attempt to call tools that are not in your function declarations. If analyze_token requires payment, it is handled automatically — never send USDC manually to pay for tool access.`;
};

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
  walletAddress: string,
  confirmFn: ConfirmFn = rejectByDefault,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });

  const functionDeclarations = mcpToolsToGeminiDeclarations(mcpClient);
  const toolNames = mcpClient.tools.map((t) => t.name);

  history.push({ role: "user", parts: [{ text: userMessage }] });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    debug(`Agent loop round ${round + 1}/${MAX_TOOL_ROUNDS}`);

    const response = await ai.models.generateContent({
      model,
      contents: history,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION(walletAddress, toolNames),
        tools: [{ functionDeclarations }],
      },
    });

    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      const text = response.text ?? "(no response)";
      debug(`Model returned final text (${text.length} chars)`);
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

      debug(`Calling tool: ${toolName}(${JSON.stringify(toolArgs)})`);

      let output: Record<string, unknown>;
      try {
        const needsConfirmation =
          mcpClient.requiresConfirmationForAllCalls ||
          !READ_ONLY_TOOLS.has(toolName);

        if (needsConfirmation) {
          const approved = await confirmFn(toolName, toolArgs);
          if (!approved) {
            output = { error: "User declined the operation." };
            responseParts.push({
              functionResponse: { id: fc.id, name: toolName, response: output },
            });
            continue;
          }
        }

        const resultText = await mcpClient.callTool(toolName, toolArgs, {
          allowPayment: mcpClient.requiresConfirmationForAllCalls,
        });
        output = { result: resultText };
        debug(`Tool ${toolName} result: ${resultText}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        debug(`Tool ${toolName} error: ${errorMsg}`);
        output = {
          error: errorMsg,
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
