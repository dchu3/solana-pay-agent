# Solana Pay Agent

A Gemini-powered CLI agent that interacts with the [solana-x402-mcp](https://github.com/dchu3/solana-x402-mcp) server using natural language. Ask questions and execute Solana USDC payment operations through a conversational interface.

## Features

- **Natural language interface** — describe what you want in plain English
- **Agentic tool calling** — Gemini automatically selects and invokes the right MCP tools
- **Full MCP tool support** — wallet balance, send USDC, incoming payments, x402 payments

## Prerequisites

- Node.js 18+
- A compiled [solana-x402-mcp](https://github.com/dchu3/solana-x402-mcp) server (`npm run build` in that repo)
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

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `MCP_SERVER_PATH` | Yes | Path to compiled MCP server entry point (e.g. `../solana-x402-mcp/dist/index.js`) |
| `SOLANA_PRIVATE_KEY` | Yes | Base58-encoded Solana wallet private key |
| `GEMINI_MODEL` | No | Gemini model (default: `gemini-3.1-flash-lite-preview`) |
| `SOLANA_NETWORK` | No | `devnet` or `mainnet-beta` (default: `devnet`) |
| `SOLANA_RPC_URL` | No | Custom Solana RPC endpoint |

## Usage

```bash
npm start
```

Example prompts:

```
> What is my USDC balance?
> Send 5 USDC to 7xKX...abc
> Show me my recent incoming USDC payments
> /quit
```

The agent connects to the MCP server, discovers available tools, and uses Gemini to decide which tools to call based on your input. Type `/quit` or press Ctrl+C to exit.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│  User (CLI)  │────▶│ Gemini Agent │────▶│ solana-x402-mcp  │
│   readline   │◀────│  tool loop   │◀────│   (MCP stdio)    │
└─────────────┘     └─────────────┘     └──────────────────┘
```

- **`src/index.ts`** — Interactive readline CLI entrypoint
- **`src/agent.ts`** — Gemini agentic loop with function calling
- **`src/mcp-client.ts`** — MCP client managing the server subprocess
- **`src/config.ts`** — Environment variable loading and validation

## License

MIT
