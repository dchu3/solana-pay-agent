# Solana Pay Agent

A Gemini-powered CLI agent that interacts with the [solana-x402-mcp](https://github.com/dchu3/solana-x402-mcp) server using natural language. Ask questions and execute Solana USDC payment operations through a conversational interface.

## Features

- **Natural language interface** — describe what you want in plain English
- **Agentic tool calling** — Gemini automatically selects and invokes the right MCP tools
- **Full MCP tool support** — wallet balance, send USDC, incoming payments, x402 payments
- **Telegram bot mode** — interact via a private Telegram bot restricted to a single chat

## Prerequisites

- Node.js 20.18.0+ (required by `@solana/kit`)
- A compiled [solana-x402-mcp](https://github.com/dchu3/solana-x402-mcp) server (`npm run build` in that repo), **or** a remote MCP server URL (`REMOTE_MCP_URL`)
- A [Google AI Studio](https://aistudio.google.com/) API key
- A Solana wallet private key (base58-encoded)

## Setup

```bash
git clone https://github.com/dchu3/solana-pay-agent.git
cd solana-pay-agent
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

- `GEMINI_API_KEY` (required): Google Gemini API key
- `MCP_SERVER_PATH` (required): Path to compiled MCP server entry point (e.g. `../solana-x402-mcp/dist/index.js`)
- `SOLANA_PRIVATE_KEY` (required): Base58-encoded Solana wallet private key
- `GEMINI_MODEL` (optional): Gemini model (default: `gemini-3.1-flash-lite-preview`)
- `SOLANA_NETWORK` (optional): `devnet` or `mainnet-beta`. If unset, the effective default is determined by the MCP server.
- `SOLANA_RPC_URL` (optional): Custom Solana RPC endpoint
- `VERBOSE` (optional): Set to `true` or `1` to enable debug logging
- `X402_SERVER_PORT` (optional): Port to run the x402 seller HTTP server (e.g. `4021`). Server only starts when set.
- `X402_FACILITATOR_URL` (optional): x402 facilitator URL (default: `https://x402.org/facilitator`)
- `TELEGRAM_BOT_TOKEN` (optional): Telegram bot token from [@BotFather](https://t.me/BotFather). Required for `npm run start:telegram`.
- `TELEGRAM_CHAT_ID` (optional): Telegram chat ID the bot is restricted to. Required for `npm run start:telegram`.

## Usage

```bash
npm start
```

To enable debug logging (tool calls, MCP responses, errors), use the `--verbose` flag:

```bash
npm start -- --verbose
```

Or set the `VERBOSE` env var:

```bash
VERBOSE=true npm start
```

Debug output is written to stderr so it won't interfere with normal conversation output.

Example prompts:

```
> What is my USDC balance?
> Send 5 USDC to 7xKX...abc
> Show me my recent incoming USDC payments
> /quit
```

The agent connects to the MCP server, discovers available tools, and uses Gemini to decide which tools to call based on your input. Type `/quit` or press Ctrl+C to exit.

## Telegram Bot

The agent can also run as a **private Telegram bot**, allowing you to interact with it from your phone or desktop Telegram client.

### Setup

1. **Create a bot** — Message [@BotFather](https://t.me/BotFather) on Telegram and use `/newbot` to get a bot token.
2. **Get your chat ID** — Message [@userinfobot](https://t.me/userinfobot) on Telegram to get your numeric chat ID.
3. **Configure** — Add to your `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHAT_ID=123456789
```

### Run

```bash
npm run start:telegram
```

To enable debug logging:

```bash
npm run start:telegram -- --verbose
```

### Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message and usage examples |
| `/help` | Show available features |
| `/reset` | Clear conversation history |

### How It Works

- The bot uses **long polling** (no webhooks or public URL needed).
- Messages from any chat ID other than `TELEGRAM_CHAT_ID` are **silently ignored**.
- Destructive actions (like sending USDC) prompt an **inline keyboard** with Yes/No buttons. If no response within 60 seconds, the action is auto-rejected.
- The bot sends a typing indicator while the agent is processing your request.
- Conversation history is maintained in-memory across messages (same as the CLI).

## x402 Seller Server

The agent can also act as a **seller** — exposing its MCP tools as x402 payment-gated HTTP endpoints so other AI agents (or any HTTP client) can pay USDC to query Solana data.

### Enable

Add to your `.env`:

```bash
X402_SERVER_PORT=4021
```

The server starts alongside the CLI when this variable is set.

### Endpoints

| Endpoint | MCP Tool | Price |
|---|---|---|
| `GET /api/usdc-balance?address=<addr>` | `get_usdc_balance` | $0.001 |
| `GET /api/sol-balance?address=<addr>` | `get_sol_balance` | $0.001 |
| `GET /api/wallet-info?address=<addr>` | `get_wallet_info` | $0.001 |
| `GET /api/incoming-payments?address=<addr>` | `get_incoming_usdc_payments` | $0.01 |

### How It Works

1. A client requests an endpoint (e.g. `GET /api/usdc-balance?address=...`)
2. The server responds with **HTTP 402** and a JSON payment requirement (amount, USDC address, network)
3. The client pays USDC on Solana and retries the request with an `X-PAYMENT` header containing the proof
4. The server verifies the payment via the facilitator and returns the data

```
Client                           Seller Server
  │                                    │
  │── GET /api/usdc-balance ─────────▶│
  │◀─ 402 { pay 0.001 USDC to ... } ──│
  │                                    │
  │── pay USDC on Solana ──────────────│
  │                                    │
  │── GET /api/usdc-balance ─────────▶│
  │   X-PAYMENT: <proof>               │
  │◀─ 200 { "result": "5.076" } ──────│
```

Payments are received directly to your wallet address (derived from `SOLANA_PRIVATE_KEY`).

## Architecture

```
                       ┌─────────────┐     ┌──────────────────┐
  User (CLI) ─────────▶│ Gemini Agent │────▶│ solana-x402-mcp  │
    readline  ◀─────────│  tool loop   │◀────│   (MCP stdio)    │
                       └─────────────┘     └──────────────────┘
                              ▲                     ▲
  User (Telegram) ────▶  Telegram Bot  ─────────────┤
    grammY (polling)                                │
                                                    │
  Other agents ────▶  x402 HTTP Server ─────────────┘
   (pay USDC)        (Express + @x402/express)
```

- **`src/index.ts`** — Interactive readline CLI entrypoint
- **`src/telegram.ts`** — Telegram bot entrypoint (grammY, long polling)
- **`src/agent.ts`** — Gemini agentic loop with function calling
- **`src/mcp-client.ts`** — MCP client managing the server subprocess
- **`src/server.ts`** — Express HTTP server with x402 payment middleware
- **`src/config.ts`** — Environment variable loading and validation
- **`src/logger.ts`** — Debug logging utility (verbose mode)

## License

MIT
