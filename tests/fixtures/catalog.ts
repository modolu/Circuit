import type { NewAsset } from "@/src/db/schema";
import { fakeAsset } from "./db";

/** A fictional catalog row with well-formed reference metadata (test DB only). */
export function fakeCatalogAsset(overrides: Partial<NewAsset> = {}): Omit<NewAsset, "id" | "createdAt" | "updatedAt"> {
  return fakeAsset({
    pythFeedId: "922",
    inputEnabled: false,
    outputEnabled: false,
    metadata: {
      reference: {
        provider: "pyth_pro",
        role: "underlying_equity",
        symbol: "Equity.US.AAPL/USD",
        feedId: 922,
        channel: "fixed_rate@200ms",
        assetType: "equity",
        description: "TEST FIXTURE",
      },
      comparisonFeeds: [],
      execution: { status: "PENDING_JUPITER_VERIFICATION" },
      verification: { internal: "must never reach API responses" },
      notes: ["internal note"],
    },
    ...overrides,
  });
}
