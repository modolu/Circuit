import "server-only";
import { getServerEnv } from "../../config/env.ts";
import {
  authChallengeResponseSchema,
  authVerifyResponseSchema,
  depositCraftResponseSchema,
  gatewayErrorSchema,
  swapQuoteResponseSchema,
  tokenInfoSchema,
  tokenSearchResponseSchema,
  triggerErrorSchema,
  vaultResponseSchema,
  type AuthChallengeResponse,
  type DepositCraftRequest,
  type DepositCraftResponse,
  type SwapQuote,
  type TokenInfo,
} from "./schemas.ts";
import { JUPITER_API_BASE_URL, JUPITER_TRIGGER_PATH } from "./trigger.ts";

/*
 * Server-side Jupiter HTTP client (Trigger V2 docs re-verified 2026-09-23).
 * - The API key goes only in the `x-api-key` header, never in errors or logs.
 * - The Trigger JWT is passed in per call (`Authorization: Bearer`) and never stored here.
 * - There is no order creation, cancellation or transaction submission (Task 9+).
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
  /** Provider message with secret-looking values stripped; safe to log. */
  readonly providerMessage: string | undefined;

  constructor(reason: JupiterFailureReason, status?: number, providerMessage?: string) {
    super(`Jupiter request failed: ${reason}${status ? ` (HTTP ${status})` : ""}`);
    this.reason = reason;
    this.status = status;
    this.providerMessage = providerMessage;
  }
}

export interface JupiterVault {
  userPubkey: string;
  vaultPubkey: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

function scrub(message: string, secrets: Array<string | undefined>): string {
  let safe = message.slice(0, 300);
  for (const secret of secrets) if (secret) safe = safe.split(secret).join("[REDACTED]");
  return safe.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[REDACTED_JWT]");
}

function reasonFor(status: number, gatewayShape: boolean): JupiterFailureReason {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      // Gateway `{ code, message }` = the API key lacks permission; otherwise a Trigger-side refusal.
      return gatewayShape ? "gateway_forbidden" : "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return "http_error";
  }
}

export interface JupiterClient {
  /** True when a key is configured. Without one, requests use Jupiter's documented keyless tier (0.5 RPS). */
  readonly hasApiKey: boolean;
  findTokenByMint(mint: string): Promise<TokenInfo | null>;
  quoteRoute(request: { inputMint: string; outputMint: string; amountAtomic: bigint }): Promise<SwapQuote>;
  requestAuthChallenge(walletPubkey: string, type: "message" | "transaction"): Promise<AuthChallengeResponse>;
  /** Exchanges a base58 message signature for a Trigger JWT (24h, no refresh). */
  verifyAuth(walletPubkey: string, signatureBase58: string): Promise<string>;
  /** The caller's vault, or null when none is registered (404). */
  getVault(jwt: string): Promise<JupiterVault | null>;
  /** Registers the caller's vault. An existing vault (409) is returned, not treated as a failure. */
  registerVault(jwt: string): Promise<{ vault: JupiterVault; created: boolean }>;
  /** Builds an UNSIGNED deposit transaction plus a single-use requestId. It moves no funds by itself. */
  craftDeposit(jwt: string, request: DepositCraftRequest): Promise<DepositCraftResponse>;
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
  const triggerUrl = (path: string) => new URL(`${triggerBaseUrl.replace(/\/$/, "")}${path}`);

  /** Sends one request. Returns status and parsed JSON body (or undefined); never throws for HTTP status. */
  async function send(url: URL, { method = "GET", body, jwt }: { method?: string; body?: unknown; jwt?: string } = {}) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (apiKey) headers["x-api-key"] = apiKey;
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new JupiterRequestError(timedOut ? "timeout" : "network");
    }
    const text = await response.text().catch(() => "");
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, ok: response.ok, json, jwt };
  }

  function failure(result: { status: number; json: unknown; jwt?: string }): JupiterRequestError {
    const gateway = gatewayErrorSchema.safeParse(result.json);
    const service = triggerErrorSchema.safeParse(result.json);
    const message = gateway.success ? gateway.data.message : service.success ? service.data.error : undefined;
    return new JupiterRequestError(
      reasonFor(result.status, gateway.success),
      result.status,
      message ? scrub(message, [apiKey, result.jwt]) : undefined,
    );
  }

  function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }, json: unknown, status: number): T {
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new JupiterRequestError("malformed_response", status);
    return parsed.data;
  }

  const toVault = (v: { userPubkey: string; vaultPubkey: string }): JupiterVault => ({
    userPubkey: v.userPubkey,
    vaultPubkey: v.vaultPubkey,
  });

  async function getVault(jwt: string): Promise<JupiterVault | null> {
    const result = await send(triggerUrl("/vault"), { jwt });
    if (result.status === 404) return null;
    if (!result.ok) throw failure(result);
    return toVault(parse(vaultResponseSchema, result.json, result.status));
  }

  return {
    hasApiKey: Boolean(apiKey),

    async findTokenByMint(mint) {
      const url = new URL("/tokens/v2/search", apiBaseUrl);
      url.searchParams.set("query", mint);
      const result = await send(url);
      if (!result.ok) throw failure(result);
      const list = parse(tokenSearchResponseSchema, result.json, result.status);
      // Search is fuzzy: accept only an object whose id is exactly the requested mint.
      for (const item of list) {
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
      const result = await send(url);
      if (!result.ok) throw failure(result);
      const quote = parse(swapQuoteResponseSchema, result.json, result.status);
      if (quote.transaction) throw new JupiterRequestError("malformed_response", result.status, "unexpected transaction in a quote-only request");
      return quote;
    },

    async requestAuthChallenge(walletPubkey, type) {
      const result = await send(triggerUrl("/auth/challenge"), { method: "POST", body: { walletPubkey, type } });
      if (!result.ok) throw failure(result);
      return parse(authChallengeResponseSchema, result.json, result.status);
    },

    async verifyAuth(walletPubkey, signatureBase58) {
      const result = await send(triggerUrl("/auth/verify"), {
        method: "POST",
        body: { type: "message", walletPubkey, signature: signatureBase58 },
      });
      if (!result.ok) throw failure(result);
      return parse(authVerifyResponseSchema, result.json, result.status).token;
    },

    getVault,

    async registerVault(jwt) {
      const result = await send(triggerUrl("/vault/register"), { jwt });
      if (result.ok) return { vault: toVault(parse(vaultResponseSchema, result.json, result.status)), created: true };
      if (result.status === 409) {
        // Documented: the existing vault is returned in `details`. Otherwise re-fetch it.
        const details = triggerErrorSchema.safeParse(result.json);
        const existing = details.success ? vaultResponseSchema.safeParse(details.data.details) : null;
        if (existing?.success) return { vault: toVault(existing.data), created: false };
        const vault = await getVault(jwt);
        if (vault) return { vault, created: false };
      }
      throw failure(result);
    },

    async craftDeposit(jwt, request) {
      const result = await send(triggerUrl("/deposit/craft"), { method: "POST", body: request, jwt });
      if (!result.ok) throw failure(result);
      return parse(depositCraftResponseSchema, result.json, result.status);
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
