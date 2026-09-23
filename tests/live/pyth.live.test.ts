import { describe, expect, it } from "vitest";
import { VERIFIED_ASSETS } from "@/src/config/assets";
import { getPythClient, PythRequestError } from "@/src/integrations/pyth/client";
import { mapLatestPrice } from "@/src/integrations/pyth/mapper";

/*
 * OPT-IN live checks against real Pyth Pro. Never part of `pnpm test`.
 * Run with `pnpm test:live` (loads .env.local; needs PYTH_API_KEY).
 * Prints public market data only, never the key.
 */

const SYMBOLS_URL = "https://pyth.dourolabs.app/v1/symbols";
const CHANNEL_ORDER = ["real_time", "fixed_rate@50ms", "fixed_rate@200ms", "fixed_rate@1000ms"];

interface PythSymbol {
  pyth_lazer_id: number;
  symbol: string;
  description: string;
  asset_type: string;
  min_channel: string;
  state: string;
}

describe("Pyth Pro connectivity", () => {
  // Diagnostic only: proves authentication, request shape and mapping against a real
  // payload using a feed any Pro key can read. It is never used as an asset reference.
  it("authenticates and maps a live payload (Crypto.BTC/USD, feed 1)", async () => {
    const { response, receivedAt } = await getPythClient().latestPrice({ feedIds: [1], channel: "fixed_rate@200ms" });
    const result = mapLatestPrice(response, { feedId: 1, symbol: "Crypto.BTC/USD", receivedAt });
    console.log("connectivity diagnostic:", JSON.stringify(result, null, 1));
    expect(result.status).toBe("AVAILABLE");
  });
});

describe.each(VERIFIED_ASSETS.map((asset) => [asset.symbol, asset] as const))("%s live Pyth checks", (_symbol, asset) => {
  it("configured feeds match current Pyth symbology", async () => {
    const symbols = (await (await fetch(SYMBOLS_URL)).json()) as PythSymbol[];
    const primary = symbols.find((s) => s.pyth_lazer_id === asset.reference.feedId);
    console.log("primary feed (symbology):", JSON.stringify(primary && { id: primary.pyth_lazer_id, symbol: primary.symbol, description: primary.description, asset_type: primary.asset_type, min_channel: primary.min_channel, state: primary.state }));

    expect(primary?.symbol).toBe(asset.reference.symbol);
    expect(primary?.asset_type).toBe("equity");
    expect(primary?.state).toBe("stable");
    expect(CHANNEL_ORDER.indexOf(asset.reference.channel)).toBeGreaterThanOrEqual(
      CHANNEL_ORDER.indexOf(primary!.min_channel),
    );
    for (const feed of asset.comparisonFeeds) {
      const found = symbols.find((s) => s.pyth_lazer_id === feed.feedId);
      console.log("comparison feed (symbology):", JSON.stringify(found && { id: found.pyth_lazer_id, symbol: found.symbol, asset_type: found.asset_type }));
      expect(found?.symbol).toBe(feed.symbol);
    }
  });

  it("the configured key can read the primary reference and the mapper handles it", async () => {
    try {
      const { response, receivedAt } = await getPythClient().latestPrice({
        feedIds: [asset.reference.feedId],
        channel: asset.reference.channel,
      });
      const result = mapLatestPrice(response, { feedId: asset.reference.feedId, symbol: asset.reference.symbol, receivedAt });
      console.log("live reference:", JSON.stringify(result, null, 1));
      expect(result.status).toBe("AVAILABLE");
    } catch (error) {
      if (error instanceof PythRequestError) {
        console.log(`live reference: FAILED with ${error.reason}${error.status ? ` (HTTP ${error.status})` : ""}`);
      }
      throw error;
    }
  });
});
