import { MAX_FUTURE_SKEW_MS, MAX_REFERENCE_AGE_MS } from "../../config/reference.ts";
import type { PythFeedPayload, PythLatestPriceResponse, PythMarketSession } from "./types.ts";

/*
 * Pure mapping from a validated Pyth payload to Circuit's EquityReference
 * (CIRCUIT_ARCHITECTURE.md §10). No floats: mantissa × 10^exponent is applied
 * as string/bigint arithmetic, and timestamps stay exact microseconds.
 */

export type ReferenceFreshness = "FRESH" | "CARRIED" | "STALE" | "UNAVAILABLE";

export interface EquityReference {
  feedId: number;
  symbol: string;
  priceUsd: string;
  confidenceUsd: string | null;
  /** Experimental in Pyth: informational only, never used for safety decisions. */
  bestBidUsd: string | null;
  bestAskUsd: string | null;
  exponent: number;
  publisherCount: number | null;
  marketSession: PythMarketSession | null;
  /** When this feed's price was generated. */
  feedUpdateTimestamp: string;
  feedUpdateTimestampUs: string;
  /** Timestamp of the Pyth update that carried this value. */
  providerTimestamp: string;
  receivedTimestamp: string;
  ageMs: number;
  isCarriedForward: boolean;
  freshness: Exclude<ReferenceFreshness, "UNAVAILABLE">;
}

export type UnavailableReason = "feed_absent" | "no_price" | "missing_exponent" | "missing_timestamp" | "non_positive_price" | "timestamp_in_future";

export type ReferenceResult =
  | { status: "AVAILABLE"; reference: EquityReference }
  | { status: "UNAVAILABLE"; reason: UnavailableReason };

/** Exact decimal string for `mantissa × 10^exponent`. */
export function mantissaToDecimal(mantissa: string, exponent: number): string {
  if (!/^-?\d+$/.test(mantissa)) throw new Error("mantissa must be an integer string");
  const negative = mantissa.startsWith("-");
  const digits = (negative ? mantissa.slice(1) : mantissa).replace(/^0+(?=\d)/, "");
  let result: string;
  if (exponent >= 0) {
    result = digits === "0" ? "0" : digits + "0".repeat(exponent);
  } else {
    const scale = -exponent;
    const padded = digits.padStart(scale + 1, "0");
    const whole = padded.slice(0, padded.length - scale);
    const fraction = padded.slice(padded.length - scale).replace(/0+$/, "");
    result = fraction ? `${whole}.${fraction}` : whole;
  }
  return negative && result !== "0" ? `-${result}` : result;
}

function microsToIso(micros: bigint): string {
  return new Date(Number(micros / 1000n)).toISOString();
}

/**
 * Classifies one feed from a latest-price response.
 * - UNAVAILABLE: feed absent, no price, missing exponent/timestamps, non-positive price, or a timestamp from the future.
 * - CARRIED: feedUpdateTimestamp < the update's timestampUs (Pyth's documented carried-forward signal), whatever its age.
 * - STALE: generated in this update, but older than MAX_REFERENCE_AGE_MS when received.
 * - FRESH: generated in this update and within MAX_REFERENCE_AGE_MS.
 */
export function mapLatestPrice(
  response: PythLatestPriceResponse,
  {
    feedId,
    symbol,
    receivedAt,
    maxAgeMs = MAX_REFERENCE_AGE_MS,
  }: { feedId: number; symbol: string; receivedAt: Date; maxAgeMs?: number },
): ReferenceResult {
  const feed: PythFeedPayload | undefined = response.parsed.priceFeeds.find((f) => f.priceFeedId === feedId);
  if (!feed) return { status: "UNAVAILABLE", reason: "feed_absent" };
  if (!feed.price) return { status: "UNAVAILABLE", reason: "no_price" };
  if (feed.exponent === null || feed.exponent === undefined) return { status: "UNAVAILABLE", reason: "missing_exponent" };
  if (!feed.feedUpdateTimestamp) return { status: "UNAVAILABLE", reason: "missing_timestamp" };
  if (BigInt(feed.price) <= 0n) return { status: "UNAVAILABLE", reason: "non_positive_price" };

  const updateUs = BigInt(response.parsed.timestampUs);
  const feedUs = BigInt(feed.feedUpdateTimestamp);
  const receivedUs = BigInt(receivedAt.getTime()) * 1000n;
  const rawAgeMs = Number((receivedUs - feedUs) / 1000n);
  if (rawAgeMs < -MAX_FUTURE_SKEW_MS) return { status: "UNAVAILABLE", reason: "timestamp_in_future" };

  const ageMs = Math.max(0, rawAgeMs);
  const isCarriedForward = feedUs < updateUs;
  const freshness = isCarriedForward ? "CARRIED" : ageMs > maxAgeMs ? "STALE" : "FRESH";
  const decimal = (value: string | null | undefined) =>
    value ? mantissaToDecimal(value, feed.exponent as number) : null;

  return {
    status: "AVAILABLE",
    reference: {
      feedId,
      symbol,
      priceUsd: mantissaToDecimal(feed.price, feed.exponent),
      confidenceUsd: decimal(feed.confidence),
      bestBidUsd: decimal(feed.bestBidPrice),
      bestAskUsd: decimal(feed.bestAskPrice),
      exponent: feed.exponent,
      publisherCount: feed.publisherCount ?? null,
      marketSession: feed.marketSession ?? null,
      feedUpdateTimestamp: microsToIso(feedUs),
      feedUpdateTimestampUs: feedUs.toString(),
      providerTimestamp: microsToIso(updateUs),
      receivedTimestamp: receivedAt.toISOString(),
      ageMs,
      isCarriedForward,
      freshness,
    },
  };
}
