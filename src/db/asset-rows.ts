import type { VerifiedAssetConfig } from "../config/assets.ts";

/**
 * The `assets` row for a curated config entry (used by `pnpm db:seed` and tests). Pure:
 * no I/O. PYTH rows carry their feed id; PRESTOCKS rows have none (no fake feed ids).
 */
export function assetRowFromConfig(asset: VerifiedAssetConfig) {
  const common = {
    symbol: asset.symbol,
    displayName: asset.displayName,
    issuer: asset.issuer,
    underlyingSymbol: asset.underlyingSymbol,
    mintAddress: asset.mintAddress,
    decimals: asset.decimals,
    active: true,
    // Execution stays off until Jupiter Trigger compatibility is verified.
    inputEnabled: asset.execution.status === "VERIFIED",
    outputEnabled: asset.execution.status === "VERIFIED",
  };
  if (asset.referenceProvider === "PYTH") {
    return {
      ...common,
      referenceProvider: "PYTH" as const,
      pythFeedId: String(asset.reference.feedId),
      metadata: {
        reference: asset.reference,
        comparisonFeeds: asset.comparisonFeeds,
        execution: asset.execution,
        jupiter: asset.jupiter,
        referenceBasis: asset.referenceBasis,
        tokenProgram: asset.tokenProgram,
        issuerIds: asset.issuerIds,
        verification: asset.verification,
        notes: asset.notes,
      },
    };
  }
  return {
    ...common,
    referenceProvider: "PRESTOCKS" as const,
    pythFeedId: null,
    metadata: {
      reference: asset.reference,
      comparisonFeeds: [],
      execution: asset.execution,
      jupiter: asset.jupiter,
      referenceBasis: asset.referenceBasis,
      tokenProgram: asset.tokenProgram,
      tokenRestrictions: asset.tokenRestrictions,
      verification: asset.verification,
      notes: asset.notes,
    },
  };
}

