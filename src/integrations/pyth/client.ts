import "server-only";
import { DEFAULT_PYTH_BASE_URL, PYTH_REQUEST_TIMEOUT_MS, type PythChannel } from "../../config/reference.ts";
import { getServerEnv } from "../../config/env.ts";
import { PYTH_REFERENCE_PROPERTIES, pythLatestPriceResponseSchema, type PythLatestPriceResponse } from "./types.ts";

/*
 * Server-side Pyth Pro REST client: POST /v1/latest_price with a Bearer key.
 * The key is read from src/config/env.ts on the server only and never logged
 * or returned. No WebSocket, no stream, no SDK.
 */

export type PythFailureReason =
  | "missing_api_key"
  | "unauthorized"
  | "not_entitled"
  | "bad_request"
  | "http_error"
  | "timeout"
  | "network"
  | "malformed_response";

export class PythRequestError extends Error {
  override readonly name = "PythRequestError";
  readonly reason: PythFailureReason;
  readonly status: number | undefined;

  constructor(reason: PythFailureReason, status?: number) {
    super(`Pyth request failed: ${reason}${status ? ` (HTTP ${status})` : ""}`);
    this.reason = reason;
    this.status = status;
  }
}

export interface PythLatestPrice {
  response: PythLatestPriceResponse;
  receivedAt: Date;
}

export interface PythClient {
  latestPrice(request: { feedIds: number[]; channel: PythChannel }): Promise<PythLatestPrice>;
}

// Pyth encodes int64/u64 values as JSON numbers in places (e.g. confidence,
// feedUpdateTimestamp). Keep their exact source digits instead of lossy floats.
const EXACT_INTEGER_KEYS = new Set([
  "price",
  "confidence",
  "bestBidPrice",
  "bestAskPrice",
  "feedUpdateTimestamp",
  "timestampUs",
  "emaPrice",
  "emaConfidence",
]);

export function parsePythJson(text: string): unknown {
  return JSON.parse(text, function (key, value, context?: { source?: string }) {
    if (typeof value === "number" && EXACT_INTEGER_KEYS.has(key) && context?.source) return context.source;
    return value;
  });
}

export function createPythClient({
  apiKey,
  baseUrl = DEFAULT_PYTH_BASE_URL,
  fetchImpl = fetch,
  now = () => new Date(),
}: {
  apiKey: string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): PythClient {
  return {
    async latestPrice({ feedIds, channel }) {
      if (!apiKey) throw new PythRequestError("missing_api_key");

      let response: Response;
      try {
        response = await fetchImpl(new URL("/v1/latest_price", baseUrl), {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            priceFeedIds: feedIds,
            properties: PYTH_REFERENCE_PROPERTIES,
            formats: [],
            channel,
            parsed: true,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(PYTH_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new PythRequestError(timedOut ? "timeout" : "network");
      }
      const receivedAt = now();

      if (!response.ok) {
        const reason: PythFailureReason =
          response.status === 401
            ? "unauthorized"
            : response.status === 403
              ? "not_entitled"
              : response.status === 400
                ? "bad_request"
                : "http_error";
        throw new PythRequestError(reason, response.status);
      }

      let body: unknown;
      try {
        body = parsePythJson(await response.text());
      } catch {
        throw new PythRequestError("malformed_response", response.status);
      }
      const parsed = pythLatestPriceResponseSchema.safeParse(body);
      if (!parsed.success) throw new PythRequestError("malformed_response", response.status);
      return { response: parsed.data, receivedAt };
    },
  };
}

/** The deployment's client, configured from server-only env. */
export function getPythClient(): PythClient {
  const env = getServerEnv();
  return createPythClient({ apiKey: env.PYTH_API_KEY, baseUrl: env.PYTH_BASE_URL ?? DEFAULT_PYTH_BASE_URL });
}
