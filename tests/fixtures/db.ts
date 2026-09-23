import type { NewAsset, NewPolicy } from "@/src/db/schema";

/*
 * Fictional fixtures for tests only. None of these values are real mints,
 * feeds or wallets, and seed.ts never imports this file.
 */

let counter = 0;
const next = () => `${Date.now().toString(36)}_${(counter++).toString(36)}`;

export function fakeWalletAddress(): string {
  return `TEST_WALLET_NOT_REAL_${next()}`;
}

export function fakeAsset(overrides: Partial<NewAsset> = {}): Omit<NewAsset, "id" | "createdAt" | "updatedAt"> {
  return {
    symbol: "TEST_ASSET",
    displayName: "Test Asset (fictional)",
    issuer: "Test Issuer (fictional)",
    underlyingSymbol: "TEST",
    mintAddress: `TEST_MINT_NOT_REAL_${next()}`,
    decimals: 8,
    pythFeedId: "TEST_FEED_NOT_REAL",
    metadata: { fixture: true },
    ...overrides,
  };
}

export function fakePolicy(
  ids: { walletId: string; assetId: string },
  overrides: Partial<NewPolicy> = {},
): Omit<NewPolicy, "id" | "updatedAt"> {
  const createdAt = overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z");
  return {
    ...ids,
    side: "BUY",
    triggerDirection: "BELOW",
    sourceExpressionType: "ABSOLUTE_PRICE",
    sourceExpressionValue: "100.00",
    compiledTriggerUsd: "100.00",
    amountAtomic: 1_000_000n,
    inputMint: "TEST_INPUT_MINT_NOT_REAL",
    outputMint: "TEST_OUTPUT_MINT_NOT_REAL",
    maxSlippageBps: 50,
    expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
    pythReferenceUsd: "102.00",
    pythFeedTimestamp: createdAt,
    pythSnapshotJson: { fixture: true },
    createdAt,
    ...overrides,
  };
}
