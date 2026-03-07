import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Server } from "node:http";
import type { McpClient } from "./mcp-client.js";
import type { Config } from "./config.js";

/**
 * Create and start an Express HTTP server with x402 payment-gated endpoints.
 * Each endpoint wraps an MCP tool call — other agents pay USDC to query data.
 */
export function createSellerServer(
  mcpClient: McpClient,
  config: Config,
): Server {
  const port = config.x402ServerPort!;
  const app = express();

  const facilitatorClient = new HTTPFacilitatorClient({
    url: config.x402FacilitatorUrl,
  });

  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    config.x402Network,
    new ExactSvmScheme(),
  );

  const routes = {
    "GET /api/usdc-balance": {
      accepts: [
        {
          scheme: "exact" as const,
          price: "$0.001",
          network: config.x402Network,
          payTo: config.walletAddress,
        },
      ],
      description: "Query USDC balance for a Solana wallet",
      mimeType: "application/json",
    },
    "GET /api/sol-balance": {
      accepts: [
        {
          scheme: "exact" as const,
          price: "$0.001",
          network: config.x402Network,
          payTo: config.walletAddress,
        },
      ],
      description: "Query SOL balance for a Solana wallet",
      mimeType: "application/json",
    },
    "GET /api/wallet-info": {
      accepts: [
        {
          scheme: "exact" as const,
          price: "$0.001",
          network: config.x402Network,
          payTo: config.walletAddress,
        },
      ],
      description: "Get wallet information for a Solana address",
      mimeType: "application/json",
    },
    "GET /api/incoming-payments": {
      accepts: [
        {
          scheme: "exact" as const,
          price: "$0.01",
          network: config.x402Network,
          payTo: config.walletAddress,
        },
      ],
      description: "View recent incoming USDC payments for a wallet",
      mimeType: "application/json",
    },
  };

  app.use(paymentMiddleware(routes, resourceServer));

  app.get("/api/usdc-balance", async (req, res) => {
    try {
      const address = req.query.address as string | undefined;
      const result = await mcpClient.callTool("get_usdc_balance", {
        ...(address && { wallet_address: address }),
      });
      res.json({ result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sol-balance", async (req, res) => {
    try {
      const address = req.query.address as string | undefined;
      const result = await mcpClient.callTool("get_sol_balance", {
        ...(address && { wallet_address: address }),
      });
      res.json({ result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/wallet-info", async (req, res) => {
    try {
      const address = req.query.address as string | undefined;
      const result = await mcpClient.callTool("get_wallet_info", {
        ...(address && { wallet_address: address }),
      });
      res.json({ result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/incoming-payments", async (req, res) => {
    try {
      const address = req.query.address as string | undefined;
      const result = await mcpClient.callTool("get_incoming_usdc_payments", {
        ...(address && { wallet_address: address }),
      });
      res.json({ result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  const server = app.listen(port, () => {
    console.log(`x402 seller server listening on http://localhost:${port}`);
    console.log(`  Endpoints: /api/usdc-balance, /api/sol-balance, /api/wallet-info, /api/incoming-payments`);
    console.log(`  Network: ${config.x402Network} | Facilitator: ${config.x402FacilitatorUrl}`);
    console.log(`  Payments go to: ${config.walletAddress}`);
  });

  return server;
}
