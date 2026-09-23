import "server-only";
import { getServerEnv } from "../../config/env.ts";
import {
  authChallengeResponseSchema,
  gatewayErrorSchema,
  swapQuoteResponseSchema,
  tokenInfoSchema,
  tokenSearchResponseSchema,
  triggerErrorSchema,
  type AuthChallengeResponse,
  type SwapQuote,
  type TokenInfo,
} from "./schemas.ts";
import { JUPITER_API_BASE_URL, JUPITER_TRIGGER_PATH } from "./trigger.ts";

/*
 * Server-side Jupiter HTTP client, limited to Task 7's read-only verification calls:
 * exact-mint token lookup, quote-only route (never a `taker`, so no transaction is
 * built), and the Trigger auth challenge. There is no vault, deposit, order or cancel
 * I/O yet. The API key goes only in the `x-api-key` header, never in errors or logs.
 */

export type JupiterFailureReason =
  | "gateway_forbidden"
  | "forbidden"
  | "unauthorized"
  | "bad_request"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "http_error"
  | "timeout"
  | "network"
  | "malformed_response";

export class JupiterRequestError extends Error {
  override readonly name = "JupiterRequestError";
  readonly reason: JupiterFailureReason;
  readonly status: number | undefined;
  /** Provider message with any secret-looking values stripped; safe to log. */
  readonly providerMessage: string | undefined;

  constructor(reason: JupiterFailureReason, status?: number, providerMessage?: string) {
    super(`Jupiter request failed: ${reason}${status ? ` (HTTP ${status})` : ""}`);
    this.reason = reason;
    this.status = status;
    this.providerMessage = providerMessage;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

function scrub(message: string, apiKey: string | undefined): string {
  let safe = message.slice(0, 300);
  if (apiKey) safe = safe.split(apiKey).join("[REDACTED]");
  return safe.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[REDACTED_JWT]");
}

async function classify(response: Response, apiKey: string | undefined): Promise<JupiterRequestError> {
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const gateway = gatewayErrorSchema.safeParse(body);
  const service = triggerErrorSchema.safeParse(body);
  const message = gateway.success ? gateway.data.message : service.success ? service.data.error : undefined;
  const safeMessage = message ? scrub(message, apiKey) : undefined;
  switch (response.status) {
    case 400:
      return new JupiterRequestError("bad_request", 400, safeMessage);
    case 401:
      return new JupiterRequestError("unauthorized", 401, safeMessage);
    case 403:
      // Gateway shape `{ code, message }` means the API key lacks permission for this endpoint.
      return new JupiterRequestError(gateway.success ? "gateway_forbidden" : "forbidden", 403, safeMessage);
    case 404:
      return new JupiterRequestError("not_found", 404, safeMessage);
    case 409:
      return new JupiterRequestError("conflict", 409, safeMessage);
    case 429:
      return new JupiterRequestError("rate_limited", 429, safeMessage);
    default:
      return new JupiterRequestError("http_error", response.status, safeMessage);
  }
}

export interface JupiterClient {
  /** True when a key is configured. Without one, requests use Jupiter's documented keyless tier (0.5 RPS). */
  readonly hasApiKey: boolean;
  findTokenByMint(mint: string): Promise<TokenInfo | null>;
  quoteRoute(request: { inputMint: string; outputMint: string; amountAtomic: bigint }): Promise<SwapQuote>;
  requestAuthChallenge(walletPubkey: string, type: "message" | "transaction"): Promise<AuthChallengeResponse>;
}

export function createJupiterClient({
  apiKey,
  apiBaseUrl = JUPITER_API_BASE_URL,
  triggerBaseUrl = `${JUPITER_API_BASE_URL}${JUPITER_TRIGGER_PATH}`,
  fetchImpl = fetch,
}: {
  apiKey: string | undefined;
  apiBaseUrl?: string;
  triggerBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): JupiterClient {
  async function request(url: URL, init: RequestInit = {}): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body) headers["Content-Type"] = "application/json";
    if (apiKey) headers["x-api-key"] = apiKey;
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new JupiterRequestError(timedOut ? "timeout" : "network");
    }
    if (!response.ok) throw await classify(response, apiKey);
    try {
      return await response.json();
    } catch {
      throw new JupiterRequestError("malformed_response", response.status);
    }
  }

  return {
    hasApiKey: Boolean(apiKey),

    async findTokenByMint(mint) {
      const url = new URL("/tokens/v2/search", apiBaseUrl);
      url.searchParams.set("query", mint);
      const list = tokenSearchResponseSchema.safeParse(await request(url));
      if (!list.success) throw new JupiterRequestError("malformed_response");
      // Search is fuzzy: accept only an object whose id is exactly the requested mint.
      for (const item of list.data) {
        const token = tokenInfoSchema.safeParse(item);
        if (token.success && token.data.id === mint) return token.data;
      }
      return null;
    },

    async quoteRoute({ inputMint, outputMint, amountAtomic }) {
      const url = new URL("/swap/v2/order", apiBaseUrl);
      url.searchParams.set("inputMint", inputMint);
      url.searchParams.set("outputMint", outputMint);
      url.searchParams.set("amount", amountAtomic.toString());
      // Deliberately no `taker`: Jupiter returns a quote only, with no transaction to sign.
      const quote = swapQuoteResponseSchema.safeParse(await request(url));
      if (!quote.success) throw new JupiterRequestError("malformed_response");
      if (quote.data.transaction) throw new JupiterRequestError("malformed_response", undefined, "unexpected transaction in a quote-only request");
      return quote.data;
    },

    async requestAuthChallenge(walletPubkey, type) {
      const url = new URL(`${triggerBaseUrl.replace(/\/$/, "")}/auth/challenge`);
      const parsed = authChallengeResponseSchema.safeParse(
        await request(url, { method: "POST", body: JSON.stringify({ walletPubkey, type }) }),
      );
      if (!parsed.success) throw new JupiterRequestError("malformed_response");
      return parsed.data;
    },
  };
}

/** The deployment's client, configured from server-only env. */
export function getJupiterClient(): JupiterClient {
  const env = getServerEnv();
  return createJupiterClient({
    apiKey: env.JUPITER_API_KEY,
    triggerBaseUrl: env.JUPITER_TRIGGER_BASE_URL ?? `${JUPITER_API_BASE_URL}${JUPITER_TRIGGER_PATH}`,
  });
}
