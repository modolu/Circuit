import { z } from "zod";
import type { ReferenceProvider } from "./asset.ts";

/*
 * Provider-agnostic captured reference (CIRCUIT_ARCHITECTURE.md §5.3, §10, Task 10).
 * Common fields are what the compiler and audit trail need; provider-specific detail
 * stays in its own sub-object and is never forced into the other provider's concepts
 * (PreStocks has no feed id, publisher count, market session or carried-forward state).
 * Pure types and helpers: no I/O.
 */

/**
 * - FRESH / CARRIED / STALE: Pyth source freshness (see §10).
 * - CURRENT_RESPONSE: PreStocks. The API publishes no per-price timestamp, so Circuit can
 *   only say the value came from a successful response it just received. It does NOT claim
 *   the mark itself updated at that time.
 */
export const REFERENCE_FRESHNESS = ["FRESH", "CARRIED", "STALE", "CURRENT_RESPONSE"] as const;
export type ReferenceFreshness = (typeof REFERENCE_FRESHNESS)[number];

const decimal = z.string().regex(/^\d+(\.\d+)?$/);
const iso = z.string().min(1);

export const pythReferenceSnapshotSchema = z.object({
  provider: z.literal("PYTH"),
  referenceType: z.literal("UNDERLYING_EQUITY"),
  priceUsd: decimal,
  freshness: z.enum(["FRESH", "CARRIED", "STALE"]),
  /** SOURCE: `sourceTimestamp` is when the provider generated the price. */
  timestampKind: z.literal("SOURCE"),
  sourceTimestamp: iso,
  receivedTimestamp: iso,
  pyth: z.object({
    feedId: z.number().int(),
    symbol: z.string(),
    confidenceUsd: z.string().nullable(),
    bestBidUsd: z.string().nullable(),
    bestAskUsd: z.string().nullable(),
    exponent: z.number().int(),
    publisherCount: z.number().int().nullable(),
    marketSession: z.string().nullable(),
    feedUpdateTimestamp: iso,
    feedUpdateTimestampUs: z.string(),
    providerTimestamp: iso,
    ageMs: z.number(),
    isCarriedForward: z.boolean(),
  }),
});

export const prestocksReferenceSnapshotSchema = z.object({
  provider: z.literal("PRESTOCKS"),
  referenceType: z.literal("MARK_PRICE"),
  /** The PreStocks mark: the compile reference. */
  priceUsd: decimal,
  freshness: z.literal("CURRENT_RESPONSE"),
  /** RECEIVED: no source timestamp exists; only when Circuit received the response. */
  timestampKind: z.literal("RECEIVED"),
  sourceTimestamp: z.null(),
  receivedTimestamp: iso,
  prestocks: z.object({
    name: z.string(),
    symbol: z.string(),
    contractAddress: z.string(),
    markPriceUsd: decimal,
    tokenPriceUsd: decimal.nullable(),
    /** (token − mark) / mark × 100, exact decimal maths, 2 dp. Null without a token price. */
    premiumPercent: z.string().nullable(),
    productUrl: z.string(),
    apiUrl: z.string(),
  }),
});

export const referenceSnapshotSchema = z.discriminatedUnion("provider", [pythReferenceSnapshotSchema, prestocksReferenceSnapshotSchema]);
export type PythReferenceSnapshot = z.infer<typeof pythReferenceSnapshotSchema>;
export type PrestocksReferenceSnapshot = z.infer<typeof prestocksReferenceSnapshotSchema>;
export type ReferenceSnapshot = z.infer<typeof referenceSnapshotSchema>;

/** Short name of an asset's reference, for copy: "Pyth AAPL reference" or "PreStocks mark". */
export function referenceName(provider: ReferenceProvider, underlyingSymbol: string): string {
  return provider === "PYTH" ? `Pyth ${underlyingSymbol} reference` : "PreStocks mark";
}

/** The timestamp stored in `policies.reference_timestamp` (see its column comment). */
export function referenceTimestamp(snapshot: ReferenceSnapshot): Date {
  return new Date(snapshot.sourceTimestamp ?? snapshot.receivedTimestamp);
}
