/*
 * Pyth Pro /v1/latest_price fixtures. Shapes follow the live response observed
 * on 2026-09-23; values in `equityResponseText` are test data, not market quotes.
 */

/** Verbatim live response (public market data, no credentials) for Crypto.BTC/USD, feed 1. */
export const CAPTURED_BTC_RESPONSE_TEXT =
  '{"parsed":{"timestampUs":"1790180303000000","priceFeeds":[{"priceFeedId":1,"price":"8431037000000","publisherCount":25,"exponent":-8,"marketSession":"regular","feedUpdateTimestamp":1790180303000000}]}}';

export const FIXTURE_UPDATE_US = 1_790_180_303_000_000n;

/** Builds raw JSON text the way Pyth sends it: int64 confidence and u64 timestamps as JSON numbers. */
export function equityResponseText({
  feedId = 922,
  price = "22735000" as string | null,
  exponent = -5 as number | null,
  confidence = "1250" as string | null,
  publisherCount = 7 as number | null,
  marketSession = "regular" as string | null,
  feedUpdateUs = FIXTURE_UPDATE_US as bigint | null,
  updateUs = FIXTURE_UPDATE_US,
  extraFeedFields = "",
  extraTopLevel = "",
}: {
  feedId?: number;
  price?: string | null;
  exponent?: number | null;
  confidence?: string | null;
  publisherCount?: number | null;
  marketSession?: string | null;
  feedUpdateUs?: bigint | null;
  updateUs?: bigint;
  extraFeedFields?: string;
  extraTopLevel?: string;
} = {}): string {
  const fields = [
    `"priceFeedId":${feedId}`,
    price !== null ? `"price":"${price}"` : null,
    exponent !== null ? `"exponent":${exponent}` : null,
    confidence !== null ? `"confidence":${confidence}` : null,
    publisherCount !== null ? `"publisherCount":${publisherCount}` : null,
    marketSession !== null ? `"marketSession":"${marketSession}"` : null,
    feedUpdateUs !== null ? `"feedUpdateTimestamp":${feedUpdateUs}` : null,
    extraFeedFields || null,
  ].filter(Boolean);
  return `{${extraTopLevel}"parsed":{"timestampUs":"${updateUs}","priceFeeds":[{${fields.join(",")}}]}}`;
}

/** The instant the fixture update was produced, plus `ms`. */
export function receivedAfter(ms: number, updateUs: bigint = FIXTURE_UPDATE_US): Date {
  return new Date(Number(updateUs / 1000n) + ms);
}
