import "server-only";
import { mapPrestocksItem, type PrestocksProduct } from "./mapper.ts";
import { PRESTOCKS_API_URL, PRESTOCKS_DECIMAL_KEYS, prestocksCatalogSchema } from "./types.ts";

/*
 * Server-side PreStocks catalog client. Public endpoint: no API key exists or is invented.
 * Prices are kept as their exact JSON source digits (Node 22 JSON.parse source text, the
 * same technique as the Pyth client), so no value passes through a JS number.
 * Nothing is cached: when PreStocks is unavailable there is no reference.
 */

export type PrestocksFailureReason = "timeout" | "network" | "http_error" | "malformed_response";

export class PrestocksRequestError extends Error {
  override readonly name = "PrestocksRequestError";
  readonly reason: PrestocksFailureReason;
  readonly status: number | undefined;

  constructor(reason: PrestocksFailureReason, status?: number) {
    super(`PreStocks request failed: ${reason}${status ? ` (HTTP ${status})` : ""}`);
    this.reason = reason;
    this.status = status;
  }
}

export interface PrestocksCatalog {
  products: PrestocksProduct[];
  /** Items that failed validation (skipped, never guessed at). */
  rejectedCount: number;
  /** When Circuit received this response. The API provides no per-price timestamp. */
  receivedAt: Date;
}

export interface PrestocksClient {
  fetchCatalog(): Promise<PrestocksCatalog>;
}

const REQUEST_TIMEOUT_MS = 10_000;

export function parsePrestocksJson(text: string): unknown {
  return JSON.parse(text, function (key, value, context?: { source?: string }) {
    if (typeof value === "number" && PRESTOCKS_DECIMAL_KEYS.has(key) && context?.source) return context.source;
    return value;
  });
}

export function createPrestocksClient({
  url = PRESTOCKS_API_URL,
  fetchImpl = fetch,
  now = () => new Date(),
}: { url?: string; fetchImpl?: typeof fetch; now?: () => Date } = {}): PrestocksClient {
  return {
    async fetchCatalog() {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new PrestocksRequestError(timedOut ? "timeout" : "network");
      }
      const receivedAt = now();
      if (!response.ok) throw new PrestocksRequestError("http_error", response.status);
      let body: unknown;
      try {
        body = parsePrestocksJson(await response.text());
      } catch {
        throw new PrestocksRequestError("malformed_response", response.status);
      }
      const list = prestocksCatalogSchema.safeParse(body);
      if (!list.success) throw new PrestocksRequestError("malformed_response", response.status);
      const products: PrestocksProduct[] = [];
      let rejectedCount = 0;
      for (const raw of list.data) {
        const product = mapPrestocksItem(raw);
        if (product) products.push(product);
        else rejectedCount += 1;
      }
      if (products.length === 0) throw new PrestocksRequestError("malformed_response", response.status);
      return { products, rejectedCount, receivedAt };
    },
  };
}

export function getPrestocksClient(): PrestocksClient {
  return createPrestocksClient();
}
