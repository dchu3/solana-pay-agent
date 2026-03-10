import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import bs58 from "bs58";
import { debug } from "./logger.js";

/**
 * Build a fetch function that transparently handles x402 payment challenges.
 *
 * When the remote server responds with HTTP 402, this wrapper:
 * 1. Parses the payment requirements from the response
 * 2. Creates a signed Solana USDC payment payload via the x402 SDK
 * 3. Retries the original request with the X-PAYMENT header attached
 */
export async function createX402Fetch(
  privateKeyBase58: string,
): Promise<typeof globalThis.fetch> {
  const keypairBytes = bs58.decode(privateKeyBase58);
  const signer = await createKeyPairSignerFromBytes(keypairBytes);

  const coreClient = new x402Client();
  registerExactSvmScheme(coreClient, { signer });
  const httpClient = new x402HTTPClient(coreClient);

  const wrappedFetch: typeof globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // Clone Request inputs so the body can be re-sent on a 402 retry.
    // If input is a Request with a body, the first fetch consumes it.
    const retryInput = input instanceof Request ? input.clone() : input;
    const response = await globalThis.fetch(input, init);

    if (response.status !== 402) {
      return response;
    }

    debug("Received 402 — processing x402 payment");

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      debug("Failed to parse 402 response body as JSON");
      throw new Error(
        "x402 payment challenge response is not valid JSON — cannot process payment",
      );
    }

    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name: string) => response.headers.get(name),
      body,
    );

    // Check if any registered hook can resolve without payment
    const hookHeaders = await httpClient.handlePaymentRequired(paymentRequired);
    const baseHeaders = {
      ...requestHeadersToRecord(input),
      ...headersToRecord(init?.headers),
    };
    if (hookHeaders) {
      debug("Hook provided headers, retrying without payment");
      const mergedInit = { ...init, headers: { ...baseHeaders, ...hookHeaders } };
      return globalThis.fetch(retryInput, mergedInit);
    }

    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

    debug("Payment payload created, retrying with X-PAYMENT header");

    const retryInit: RequestInit = {
      ...init,
      headers: { ...baseHeaders, ...paymentHeaders },
    };

    return globalThis.fetch(retryInput, retryInit);
  };

  return wrappedFetch;
}

function requestHeadersToRecord(
  input: RequestInfo | URL,
): Record<string, string> {
  if (input instanceof Request) {
    return headersToRecord(input.headers);
  }
  return {};
}

function headersToRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers as Record<string, string>;
}
