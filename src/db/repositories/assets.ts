import "server-only";
import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { assets, type Asset, type NewAsset } from "../schema.ts";

export async function findAssetById(db: DbExecutor, id: string): Promise<Asset | undefined> {
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return row;
}

/** Looks up by exact mint address. Never resolve an asset by ticker (CIRCUIT_ARCHITECTURE.md §5.2). */
export async function findAssetByMint(db: DbExecutor, mintAddress: string): Promise<Asset | undefined> {
  const [row] = await db.select().from(assets).where(eq(assets.mintAddress, mintAddress)).limit(1);
  return row;
}

export async function listActiveAssets(db: DbExecutor): Promise<Asset[]> {
  return db.select().from(assets).where(eq(assets.active, true)).orderBy(asc(assets.symbol));
}

/**
 * Inserts or refreshes a catalog entry keyed by mint. Only the controlled
 * seed/config workflow calls this; users can never submit mints.
 */
export async function upsertAsset(db: DbExecutor, asset: Omit<NewAsset, "id" | "createdAt" | "updatedAt">): Promise<Asset> {
  const [row] = await db
    .insert(assets)
    .values(asset)
    .onConflictDoUpdate({
      target: assets.mintAddress,
      set: {
        symbol: asset.symbol,
        displayName: asset.displayName,
        issuer: asset.issuer,
        underlyingSymbol: asset.underlyingSymbol,
        decimals: asset.decimals,
        pythFeedId: asset.pythFeedId,
        inputEnabled: asset.inputEnabled,
        outputEnabled: asset.outputEnabled,
        active: asset.active,
        metadata: asset.metadata,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("asset upsert returned no row");
  return row;
}
