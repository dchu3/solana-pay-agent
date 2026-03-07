import { Bot, type Context, InlineKeyboard } from "grammy";
import type { Content } from "@google/genai";
import { loadConfig } from "./config.js";
import { createMcpClient } from "./mcp-client.js";
import type { McpClient } from "./mcp-client.js";
import { runAgent, type ConfirmFn } from "./agent.js";
import { setVerbose } from "./logger.js";
import type { Config } from "./config.js";

const CONFIRMATION_TIMEOUT_MS = 60_000;

const pendingConfirmations = new Map<
  string,
  { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> }
>();

function makeConfirmFn(bot: Bot, chatId: string): ConfirmFn {
  return async (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<boolean> => {
    const confirmId = `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const keyboard = new InlineKeyboard()
      .text("✅ Yes", `${confirmId}:yes`)
      .text("❌ No", `${confirmId}:no`);

    await bot.api.sendMessage(
      chatId,
      `⚠️ *Confirm action*\n\n` +
        `Tool: \`${toolName}\`\n` +
        `Args: \`${JSON.stringify(args)}\``,
      { parse_mode: "Markdown", reply_markup: keyboard },
    );

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        pendingConfirmations.delete(confirmId);
        bot.api
          .sendMessage(chatId, "⏰ Confirmation timed out — action rejected.")
          .catch(() => {});
        resolve(false);
      }, CONFIRMATION_TIMEOUT_MS);

      pendingConfirmations.set(confirmId, { resolve, timer });
    });
  };
}

async function main(): Promise<void> {
  const verbose =
    process.argv.includes("--verbose") || process.argv.includes("-v");
  const config = loadConfig();
  setVerbose(verbose || config.verbose);

  if (!config.telegramBotToken) {
    console.error(
      "TELEGRAM_BOT_TOKEN is required. Set it in your .env file.",
    );
    process.exit(1);
  }
  if (!config.telegramChatId) {
    console.error(
      "TELEGRAM_CHAT_ID is required. Set it in your .env file.",
    );
    process.exit(1);
  }

  const botToken = config.telegramBotToken;
  const allowedChatId = config.telegramChatId;

  console.log("Connecting to MCP server...");
  const mcpClient = await createMcpClient(
    config.mcpServerPath,
    config.mcpServerEnv,
  );

  const toolNames = mcpClient.tools.map((t) => t.name).join(", ");
  console.log(`Connected. Available tools: ${toolNames}`);
  console.log(`Using model: ${config.geminiModel}`);
  console.log(`Restricted to chat ID: ${allowedChatId}`);

  const bot = new Bot(botToken);
  const conversationHistory: Content[] = [];
  const confirmFn = makeConfirmFn(bot, allowedChatId);
  const processing = new Set<number>();

  // Chat ID guard — silently ignore messages from unauthorized chats
  bot.use(async (ctx, next) => {
    if (String(ctx.chat?.id) !== allowedChatId) return;
    await next();
  });

  // Handle inline keyboard callbacks for confirmations
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const separatorIndex = data.lastIndexOf(":");
    if (separatorIndex === -1) return;

    const confirmId = data.slice(0, separatorIndex);
    const answer = data.slice(separatorIndex + 1);

    const pending = pendingConfirmations.get(confirmId);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "This confirmation has expired." });
      return;
    }

    clearTimeout(pending.timer);
    pendingConfirmations.delete(confirmId);

    const approved = answer === "yes";
    pending.resolve(approved);

    await ctx.answerCallbackQuery({
      text: approved ? "✅ Approved" : "❌ Rejected",
    });
    await ctx.editMessageText(
      approved
        ? "✅ Action approved."
        : "❌ Action rejected.",
    );
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 *Solana Pay Agent*\n\n" +
        "I'm an AI-powered assistant for managing Solana USDC transactions.\n\n" +
        "Just send me a message in plain English. Examples:\n" +
        "• _What is my USDC balance?_\n" +
        "• _Send 5 USDC to <wallet-address>_\n" +
        "• _Show my recent incoming payments_\n\n" +
        "Commands:\n" +
        "/help — Show usage info\n" +
        "/reset — Clear conversation history",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "💡 *Solana Pay Agent — Help*\n\n" +
        "Talk to me in plain English. I can:\n" +
        "• Check your wallet USDC/SOL balance\n" +
        "• Send USDC payments\n" +
        "• View recent incoming USDC payments\n" +
        "• Make x402 protocol payments\n\n" +
        "Destructive actions (like sending payments) will ask for confirmation.\n\n" +
        "Commands:\n" +
        "/reset — Clear conversation history\n" +
        "/help — Show this message",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("reset", async (ctx) => {
    conversationHistory.length = 0;
    await ctx.reply("🔄 Conversation history cleared.");
  });

  // Main message handler
  bot.on("message:text", async (ctx) => {
    const messageId = ctx.message.message_id;

    // Prevent concurrent processing of multiple messages
    if (processing.size > 0) {
      await ctx.reply("⏳ Still processing your previous message. Please wait.");
      return;
    }
    processing.add(messageId);

    try {
      await ctx.api.sendChatAction(ctx.chat.id, "typing");

      const typingInterval = setInterval(() => {
        ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
      }, 4_000);

      try {
        const answer = await runAgent(
          config.geminiApiKey,
          config.geminiModel,
          mcpClient,
          ctx.message.text,
          conversationHistory,
          config.walletAddress,
          confirmFn,
        );

        clearInterval(typingInterval);
        await sendLongMessage(ctx, answer);
      } catch (err) {
        clearInterval(typingInterval);
        const errorMsg = err instanceof Error ? err.message : String(err);
        await ctx.reply(`❌ Error: ${errorMsg}`);
      }
    } finally {
      processing.delete(messageId);
    }
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down...");
    bot.stop();
    await mcpClient.close();
    console.log("Bye.");
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  console.log("Starting Telegram bot (long polling)...");
  bot.start({
    onStart: () => console.log("Telegram bot is running."),
  });
}

/** Split long messages to stay within Telegram's 4096-char limit. */
async function sendLongMessage(ctx: Context, text: string): Promise<void> {
  const MAX_LENGTH = 4096;
  if (text.length <= MAX_LENGTH) {
    await ctx.reply(text);
    return;
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitIndex === -1 || splitIndex < MAX_LENGTH / 2) {
      splitIndex = MAX_LENGTH;
    }
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
