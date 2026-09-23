import { describe, expect, it } from "vitest";
import { MAX_REFERENCE_AGE_MS } from "@/src/config/reference";
import { parsePythJson } from "@/src/integrations/pyth/client";
import { mantissaToDecimal, mapLatestPrice } from "@/src/integrations/pyth/mapper";
import { pythLatestPriceResponseSchema } from "@/src/integrations/pyth/types";
import { CAPTURED_BTC_RESPONSE_TEXT, equityResponseText, FIXTURE_UPDATE_US, receivedAfter } from "../fixtures/pyth";

const parse = (text: string) => pythLatestPriceResponseSchema.parse(parsePythJson(text));
const map = (text: string, receivedAt = receivedAfter(400)) =>
  mapLatestPrice(parse(text), { feedId: 922, symbol: "Equity.US.AAPL/USD", receivedAt });

describe("exact decimal conversion", () => {
  it.each([
    ["22735000", -5, "227.35"],
    ["22735123", -5, "227.35123"],
    ["8431037000000", -8, "84310.37"],
    ["5", -5, "0.00005"],
    ["-150", -2, "-1.5"],
    ["42", 0, "42"],
    ["42", 2, "4200"],
    ["0", 3, "0"],
    ["100000", -5, "1"],
  ])("%s × 10^%d = %s", (mantissa, exponent, expected) => {
    expect(mantissaToDecimal(mantissa, exponent)).toBe(expected);
  });

  it("keeps int64 digits that a float would round", () => {
    expect(mantissaToDecimal("9007199254740993", -5)).toBe("90071992547.40993");
    const raw = parsePythJson('{"confidence":9007199254740993,"exponent":-5}') as Record<string, unknown>;
    expect(raw.confidence).toBe("9007199254740993");
    expect(raw.exponent).toBe(-5);
  });
});

describe("mapLatestPrice", () => {
  it("maps a fresh reference with exact values and provider metadata", () => {
    const result = map(equityResponseText());
    expect(result.status).toBe("AVAILABLE");
    if (result.status !== "AVAILABLE") return;
    const r = result.reference;
    expect(r.priceUsd).toBe("227.35");
    expect(r.confidenceUsd).toBe("0.0125");
    expect(r.bestBidUsd).toBeNull();
    expect(r.bestAskUsd).toBeNull();
    expect(r.publisherCount).toBe(7);
    expect(r.marketSession).toBe("regular");
    expect(r.feedUpdateTimestampUs).toBe(FIXTURE_UPDATE_US.toString());
    expect(r.isCarriedForward).toBe(false);
    expect(r.ageMs).toBe(400);
    expect(r.freshness).toBe("FRESH");
  });

  it("maps every documented market session and nulls unknown ones", () => {
    for (const session of ["regular", "preMarket", "postMarket", "overNight", "closed"]) {
      const result = map(equityResponseText({ marketSession: session }));
      expect(result.status === "AVAILABLE" && result.reference.marketSession).toBe(session);
    }
    const unknown = map(equityResponseText({ marketSession: "lunchBreak" }));
    expect(unknown.status === "AVAILABLE" && unknown.reference.marketSession).toBeNull();
  });

  it("marks a value generated before this update as CARRIED, however old", () => {
    const fridayClose = FIXTURE_UPDATE_US - 60n * 60n * 60n * 1_000_000n;
    const result = map(equityResponseText({ feedUpdateUs: fridayClose, marketSession: "closed" }));
    expect(result.status === "AVAILABLE" && result.reference.freshness).toBe("CARRIED");
    expect(result.status === "AVAILABLE" && result.reference.isCarriedForward).toBe(true);
    const oneTickEarlier = map(equityResponseText({ feedUpdateUs: FIXTURE_UPDATE_US - 1n }));
    expect(oneTickEarlier.status === "AVAILABLE" && oneTickEarlier.reference.freshness).toBe("CARRIED");
  });

  it("marks a non-carried value older than the limit as STALE", () => {
    const edge = map(equityResponseText(), receivedAfter(MAX_REFERENCE_AGE_MS));
    expect(edge.status === "AVAILABLE" && edge.reference.freshness).toBe("FRESH");
    const stale = map(equityResponseText(), receivedAfter(MAX_REFERENCE_AGE_MS + 1));
    expect(stale.status === "AVAILABLE" && stale.reference.freshness).toBe("STALE");
  });

  it("returns UNAVAILABLE instead of guessing", () => {
    const cases: Array<[string, string]> = [
      [equityResponseText({ feedId: 1 }), "feed_absent"],
      [equityResponseText({ price: null }), "no_price"],
      [equityResponseText({ exponent: null }), "missing_exponent"],
      [equityResponseText({ feedUpdateUs: null }), "missing_timestamp"],
      [equityResponseText({ price: "0" }), "non_positive_price"],
    ];
    for (const [text, reason] of cases) expect(map(text)).toEqual({ status: "UNAVAILABLE", reason });
    expect(map(equityResponseText(), receivedAfter(-5_000))).toEqual({
      status: "UNAVAILABLE",
      reason: "timestamp_in_future",
    });
  });

  it("rejects malformed payloads at the schema boundary", () => {
    expect(() => parse(equityResponseText({ price: "227.35" }))).toThrow();
    expect(() => parse('{"parsed":{"priceFeeds":[]}}')).toThrow();
    expect(() => parse('{"error":"nope"}')).toThrow();
  });

  it("ignores unknown provider fields safely", () => {
    const text = equityResponseText({
      extraFeedFields: '"emaPrice":"22730000","futureField":{"nested":true}',
      extraTopLevel: '"solana":null,"evm":null,"newTopLevel":1,',
    });
    const result = map(text);
    expect(result.status === "AVAILABLE" && result.reference.priceUsd).toBe("227.35");
  });

  it("handles the captured live payload shape", () => {
    const result = mapLatestPrice(parse(CAPTURED_BTC_RESPONSE_TEXT), {
      feedId: 1,
      symbol: "Crypto.BTC/USD",
      receivedAt: receivedAfter(250),
    });
    expect(result.status === "AVAILABLE" && result.reference.priceUsd).toBe("84310.37");
    expect(result.status === "AVAILABLE" && result.reference.freshness).toBe("FRESH");
    expect(result.status === "AVAILABLE" && result.reference.publisherCount).toBe(25);
  });
});
