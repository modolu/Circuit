import "server-only";
import type { DbExecutor } from "../db/client.ts";
import { listActiveAssets } from "../db/repositories/assets.ts";
import type { Asset } from "../db/schema.ts";
import type { AssetReferenceConfig } from "../domain/asset.ts";
import { assetMetadataSchema, referenceProviderOf, type PublicAsset } from "../domain/asset.ts";

/** Maps a catalog row to its public view. Rows with unreadable metadata are skipped, not guessed at. */
export function toPublicAsset(asset: Asset): PublicAsset | null {
  const metadata = assetMetadataSchema.safeParse(asset.metadata);
  if (!metadata.success) return null;
  return {
    id: asset.id,
    symbol: asset.symbol,
    displayName: asset.displayName,
    issuer: asset.issuer,
    underlyingSymbol: asset.underlyingSymbol,
    mintAddress: asset.mintAddress,
    decimals: asset.decimals,
    reference: publicReference(asset, metadata.data.reference),
    execution: {
      enabled: asset.inputEnabled && asset.outputEnabled && metadata.data.execution.status === "VERIFIED",
      status: metadata.data.execution.status,
    },
  };
}

/**
 * The curated reference, and whether the row's provider and configuration agree with its
 * metadata (Pyth: feed id; PreStocks: exact contract address = the asset's mint).
 */
function publicReference(asset: Asset, config: AssetReferenceConfig): PublicAsset["reference"] {
  const provider = referenceProviderOf(config);
  if (config.provider === "pyth_pro") {
    return {
      provider,
      symbol: config.symbol,
      label: `Pyth ${config.symbol.replace(/^Equity\.[A-Z]+\./, "")}`,
      configured: asset.referenceProvider === "PYTH" && String(config.feedId) === asset.pythFeedId,
    };
  }
  return {
    provider,
    symbol: config.symbol,
    label: "PreStocks mark",
    configured: asset.referenceProvider === "PRESTOCKS" && asset.pythFeedId === null && config.contractAddress === asset.mintAddress,
  };
}

export async function listPublicAssets(db: DbExecutor): Promise<PublicAsset[]> {
  const rows = await listActiveAssets(db);
  return rows.map(toPublicAsset).filter((asset): asset is PublicAsset => asset !== null);
}
