# Copilot Instructions

## Build and Run

```bash
npm run build          # TypeScript → dist/ via tsc
npm start              # Run the CLI (node dist/index.js)
```

No test suite or linter is configured.

## Architecture

This is a CLI agent that bridges a user (readline), Google Gemini (LLM), and a Solana MCP server (subprocess over stdio):

```
User (readline) → index.ts → agent.ts → Gemini API
                                 ↕
                           mcp-client.ts → solana-x402-mcp (child process)
```

- **`index.ts`** — Readline loop, shutdown handling, confirmation prompts. Maintains a `conversationHistory: Content[]` across turns for multi-turn conversation.
- **`agent.ts`** — Gemini agentic tool-calling loop (max 10 rounds per user message). Converts MCP JSON-Schema to Gemini's FunctionDeclaration format. Manages the read-only allowlist for tool confirmation.
- **`mcp-client.ts`** — Spawns the MCP server via `StdioClientTransport`, exposes a `McpClient` interface with `tools`, `callTool()`, and `close()`.
- **`config.ts`** — Loads `.env` via dotenv, validates with Zod, builds an allowlisted env object for the MCP subprocess.

## Key Conventions

- **ESM with `.js` extensions** — All local imports use `.js` suffixes (e.g., `from "./config.js"`). Node builtins use `node:` prefix.
- **Double quotes** everywhere.
- **Type-only imports** — Use `import type { ... }` when importing only types.
- **Error coercion pattern** — `err instanceof Error ? err.message : String(err)` is used consistently.
- **Env var security** — The MCP subprocess receives only an allowlisted set of env vars (not the full `process.env`) to prevent leaking secrets like `GEMINI_API_KEY`.
- **Safe-by-default confirmation** — A `READ_ONLY_TOOLS` allowlist in `agent.ts` determines which tools skip confirmation. Any tool NOT in this set requires user approval, so newly added MCP tools are safe by default.
- **Conventional commits** — Use `feat:`, `fix:`, `docs:` prefixes. Always create feature/fix branches; never push directly to `main`.

## Git Workflow

Never push directly to `main`. Always create a feature or fix branch (e.g., `feat/my-feature`, `fix/my-bug`) and open a pull request.

## Required Environment Variables

Defined in `.env` (see `.env.example`). Validated by Zod in `config.ts`:

- `GEMINI_API_KEY` — Google Gemini API key
- `MCP_SERVER_PATH` — Path to compiled MCP server entry point (must not start with `-`)
- `SOLANA_PRIVATE_KEY` — Base58-encoded Solana wallet private key
