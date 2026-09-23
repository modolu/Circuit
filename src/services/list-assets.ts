import "server-only";
import type { DbExecutor } from "../db/client.ts";
import { listActiveAssets } from "../db/repositories/assets.ts";
import type { Asset } from "../db/schema.ts";
import { assetMetadataSchema, type PublicAsset } from "../domain/asset.ts";

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
    reference: {
      provider: "pyth_pro",
      symbol: metadata.data.reference.symbol,
      configured: String(metadata.data.reference.feedId) === asset.pythFeedId,
    },
    execution: {
      enabled: asset.inputEnabled && asset.outputEnabled && metadata.data.execution.status === "VERIFIED",
      status: metadata.data.execution.status,
    },
  };
}

export async function listPublicAssets(db: DbExecutor): Promise<PublicAsset[]> {
  const rows = await listActiveAssets(db);
  return rows.map(toPublicAsset).filter((asset): asset is PublicAsset => asset !== null);
}
