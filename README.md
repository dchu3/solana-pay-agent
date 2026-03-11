# Solana Pay Agent

A Gemini-powered CLI agent for making Solana USDC payments via the [x402](https://x402.org) protocol. Talk to it in plain English — it connects to a [solana-x402-mcp](https://github.com/dchu3/solana-x402-mcp) server and uses Gemini to decide which tools to call.

## Features

- **Natural language interface** — describe what you want in plain English
- **Agentic tool calling** — Gemini automatically selects and invokes the right MCP tools
- **x402 payment support** — wallet balance, send USDC, incoming payments, and x402 protocol payments

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
cp .env.example .env   # then fill in your keys
npm run build
```

## Configuration

Edit `.env` with your values:

- `GEMINI_API_KEY` (required): Google Gemini API key
- `MCP_SERVER_PATH` (required if `REMOTE_MCP_URL` is not set): Path to compiled MCP server entry point (e.g. `../solana-x402-mcp/dist/index.js`)
- `REMOTE_MCP_URL` (required if `MCP_SERVER_PATH` is not set): URL of a remote MCP server. x402 payments are handled automatically.
- `SOLANA_PRIVATE_KEY` (required): Base58-encoded Solana wallet private key
- `GEMINI_MODEL` (optional): Gemini model (default: `gemini-3.1-flash-lite-preview`)
- `SOLANA_NETWORK` (optional): `devnet` or `mainnet-beta`. If unset, the effective default is determined by the MCP server.
- `SOLANA_RPC_URL` (optional): Custom Solana RPC endpoint
- `VERBOSE` (optional): Set to `true` or `1` to enable debug logging

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
> Pay for <url> using x402
> /quit
```

The agent connects to the MCP server, discovers available tools, and uses Gemini to decide which tools to call based on your input. Destructive actions (like sending payments) always ask for confirmation. Type `/quit` or press Ctrl+C to exit.

## Architecture

```
                       ┌─────────────┐     ┌──────────────────┐
  User (CLI) ─────────▶│ Gemini Agent │────▶│ solana-x402-mcp  │
    readline  ◀─────────│  tool loop   │◀────│  (MCP stdio/HTTP) │
                       └─────────────┘     └──────────────────┘
```

- **`src/index.ts`** — Interactive readline CLI entrypoint
- **`src/agent.ts`** — Gemini agentic loop with function calling
- **`src/mcp-client.ts`** — MCP client (local stdio or remote HTTP with x402 payments)
- **`src/x402-fetch.ts`** — x402 payment-handling fetch wrapper
- **`src/config.ts`** — Environment variable loading and validation
- **`src/logger.ts`** — Debug logging utility (verbose mode)

## License

MIT
