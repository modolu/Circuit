import type { PrestocksReferenceSnapshot, PythReferenceSnapshot } from "@/src/domain/reference";

/*
 * Reference fixtures (test values only; not market quotes). The PreStocks response text
 * mirrors the live first-party shape observed 2026-09-24 (JSON numbers, no timestamps);
 * mints are the real PreStocks contract addresses because exact-mint matching is what
 * is being tested, but every price here is fictional.
 */

export function pythSnapshot(overrides: Partial<PythReferenceSnapshot> = {}, pyth: Partial<PythReferenceSnapshot["pyth"]> = {}): PythReferenceSnapshot {
  return {
    provider: "PYTH",
    referenceType: "UNDERLYING_EQUITY",
    priceUsd: "1234.5",
    freshness: "FRESH",
    timestampKind: "SOURCE",
    sourceTimestamp: "2026-09-23T15:00:00.000Z",
    receivedTimestamp: "2026-09-23T15:00:00.400Z",
    pyth: {
      feedId: 922,
      symbol: "Equity.US.AAPL/USD",
      confidenceUsd: "0.0125",
      bestBidUsd: null,
      bestAskUsd: null,
      exponent: -5,
      publisherCount: 7,
      marketSession: "regular",
      feedUpdateTimestamp: "2026-09-23T15:00:00.000Z",
      feedUpdateTimestampUs: "1790175600000000",
      providerTimestamp: "2026-09-23T15:00:00.000Z",
      ageMs: 400,
      isCarriedForward: false,
      ...pyth,
    },
    ...overrides,
  };
}

export const ANTHROPIC_MINT = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
export const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
export const ANDURIL_MINT = "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB";

export function prestocksSnapshot(overrides: Partial<PrestocksReferenceSnapshot["prestocks"]> = {}): PrestocksReferenceSnapshot {
  const prestocks = {
    name: "Anthropic PreStocks",
    symbol: "ANTHROPIC",
    contractAddress: ANTHROPIC_MINT,
    markPriceUsd: "1000.00",
    tokenPriceUsd: "986.10",
    premiumPercent: "-1.39",
    productUrl: "https://www.prestocks.com/anthropic",
    apiUrl: "https://prestocks.com/api/prestocks",
    ...overrides,
  };
  return {
    provider: "PRESTOCKS",
    referenceType: "MARK_PRICE",
    priceUsd: prestocks.markPriceUsd,
    freshness: "CURRENT_RESPONSE",
    timestampKind: "RECEIVED",
    sourceTimestamp: null,
    receivedTimestamp: "2026-09-24T06:40:00.000Z",
    prestocks,
  };
}

/** Raw first-party response text: numbers as JSON numbers, exactly as PreStocks sends them. */
export function prestocksResponseText({
  anthropicMark = "1000",
  anthropicToken = "1020" as string | null,
  extra = "",
}: { anthropicMark?: string; anthropicToken?: string | null; extra?: string } = {}): string {
  const token = anthropicToken === null ? "" : `,"tokenPrice":${anthropicToken}`;
  return `[
    {"name":"Anthropic PreStocks","symbol":"ANTHROPIC","description":"test","image":"https://www.prestocks.com/logos/anthropic.png","external_url":"https://www.prestocks.com/anthropic","contract_address":"${ANTHROPIC_MINT}","markPrice":${anthropicMark},"markValuation":123${token},"impliedValuation":456,"supply":7381.815097955,"futureField":{"ignored":true}},
    {"name":"Anduril PreStocks","symbol":"ANDURIL","external_url":"https://www.prestocks.com/anduril","contract_address":"${ANDURIL_MINT}","markPrice":152.58461595,"tokenPrice":149.84259417358612},
    {"name":"SpaceX PreStocks","symbol":"SPACEX","external_url":"https://www.prestocks.com/spacex","contract_address":"${SPACEX_MINT}","markPrice":150.0080855011176,"tokenPrice":118.62147858293471}${extra}
  ]`;
}
