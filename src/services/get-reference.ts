import "server-only";
import type { DbExecutor } from "../db/client.ts";
import { findAssetById } from "../db/repositories/assets.ts";
import { assetMetadataSchema, type PublicAsset } from "../domain/asset.ts";
import { AppError } from "../domain/errors.ts";
import { PythRequestError, type PythClient } from "../integrations/pyth/client.ts";
import { mapLatestPrice, type EquityReference } from "../integrations/pyth/mapper.ts";
import { toPublicAsset } from "./list-assets.ts";

/*
 * Resolves the live reference for a curated asset (CIRCUIT_ARCHITECTURE.md §10, §28).
 * The feed comes only from the stored catalog row, never from the caller, so this
 * can't be used as a general-purpose Pyth proxy. Nothing is cached: when Pyth is
 * unavailable there is no reference, rather than an old value shown as current.
 */

const UNAVAILABLE_MESSAGE = "The Pyth reference for this asset is unavailable right now.";

export interface AssetReference {
  asset: PublicAsset;
  reference: EquityReference;
}

export async function getAssetReference(
  db: DbExecutor,
  assetId: string,
  { pyth }: { pyth: PythClient },
): Promise<AssetReference> {
  const row = await findAssetById(db, assetId);
  if (!row) throw new AppError("NOT_FOUND", "Asset not found.");
  if (!row.active) throw new AppError("ASSET_DISABLED", "This asset is not currently available in Circuit.");

  const asset = toPublicAsset(row);
  const metadata = assetMetadataSchema.safeParse(row.metadata);
  if (!asset || !metadata.success || String(metadata.data.reference.feedId) !== row.pythFeedId) {
    throw new AppError("REFERENCE_UNAVAILABLE", UNAVAILABLE_MESSAGE, { cause: "reference_not_configured" });
  }
  const { feedId, symbol, channel } = metadata.data.reference;

  let latest;
  try {
    latest = await pyth.latestPrice({ feedIds: [feedId], channel });
  } catch (error) {
    const reason = error instanceof PythRequestError ? `pyth_${error.reason}` : "pyth_unexpected";
    throw new AppError("REFERENCE_UNAVAILABLE", UNAVAILABLE_MESSAGE, { cause: reason, retryable: true });
  }

  const result = mapLatestPrice(latest.response, { feedId, symbol, receivedAt: latest.receivedAt });
  if (result.status === "UNAVAILABLE") {
    throw new AppError("REFERENCE_UNAVAILABLE", UNAVAILABLE_MESSAGE, { cause: `reference_${result.reason}` });
  }
  return { asset, reference: result.reference };
}
