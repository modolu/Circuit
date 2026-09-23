import { z } from "zod";

/*
 * Pyth Pro REST types (POST /v1/latest_price, "parsed" JSON view).
 * Source: https://pyth-lazer-0.dourolabs.app/docs/openapi.json and
 * https://docs.pyth.network/price-feeds/pro/payload-reference.
 * Vendor names stop at src/integrations/pyth; the rest of Circuit uses EquityReference.
 */

/** Properties Circuit requests. bestBid/bestAsk are experimental in Pyth and informational only here. */
export const PYTH_REFERENCE_PROPERTIES = [
  "price",
  "exponent",
  "confidence",
  "publisherCount",
  "marketSession",
  "feedUpdateTimestamp",
  "bestBidPrice",
  "bestAskPrice",
] as const;

/** Sessions exactly as the price payload spells them (the symbols API uses snake_case instead). */
export const PYTH_MARKET_SESSIONS = ["regular", "preMarket", "postMarket", "overNight", "closed"] as const;
export type PythMarketSession = (typeof PYTH_MARKET_SESSIONS)[number];

// int64/u64 values are kept as their exact JSON source digits (see client.ts).
const integerString = z.string().regex(/^-?\d+$/);

export const pythFeedPayloadSchema = z.object({
  priceFeedId: z.number().int().nonnegative(),
  price: integerString.nullish(),
  exponent: z.number().int().min(-32768).max(32767).nullish(),
  confidence: integerString.nullish(),
  bestBidPrice: integerString.nullish(),
  bestAskPrice: integerString.nullish(),
  publisherCount: z.number().int().nonnegative().nullish(),
  // Unknown future session names are kept as null rather than rejecting the payload.
  marketSession: z.enum(PYTH_MARKET_SESSIONS).nullish().catch(null),
  feedUpdateTimestamp: integerString.nullish(),
});

export const pythLatestPriceResponseSchema = z.object({
  parsed: z.object({
    timestampUs: integerString,
    priceFeeds: z.array(pythFeedPayloadSchema),
  }),
});

export type PythFeedPayload = z.infer<typeof pythFeedPayloadSchema>;
export type PythLatestPriceResponse = z.infer<typeof pythLatestPriceResponseSchema>;
