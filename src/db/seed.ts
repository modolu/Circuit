import { ALL_VERIFIED_ASSETS, seedBlocker, verifiedAssetSchema, type VerifiedAssetConfig } from "../config/assets.ts";
import { assetRowFromConfig } from "./asset-rows.ts";
import { createPrestocksClient } from "../integrations/prestocks/client.ts";
import { closeDb, getDb } from "./client.ts";
import { upsertAsset } from "./repositories/assets.ts";

/*
 * Synchronizes the curated asset catalog from src/config/assets.ts.
 * A configured asset whose static verification gate now fails is retained as INACTIVE so
 * a previously seeded row cannot keep stale live-readiness metadata. It never invents assets.
 * The PreStocks API is
 * never used to create assets; for a curated PreStocks entry it is only re-checked that
 * the live first-party catalog still lists the EXACT mint.
 * Test fixtures live in tests/ and are never imported here.
 *
 * Run with `pnpm db:seed`.
 */

async function seed(): Promise<void> {
  const configured = ALL_VERIFIED_ASSETS.map((entry) => verifiedAssetSchema.parse(entry));
  const ready: VerifiedAssetConfig[] = [];
  const blocked: Array<{ asset: VerifiedAssetConfig; reason: string }> = [];
  let catalog: Awaited<ReturnType<ReturnType<typeof createPrestocksClient>["fetchCatalog"]>> | null = null;

  for (const asset of configured) {
    const blocker = seedBlocker(asset);
    if (blocker) {
      blocked.push({ asset, reason: blocker });
      console.log(`seed: disabled ${asset.symbol}: ${blocker}`);
      continue;
    }
    if (asset.referenceProvider === "PRESTOCKS") {
      try {
        catalog ??= await createPrestocksClient().fetchCatalog();
      } catch (error) {
        console.log(`seed: skipped ${asset.symbol}: PreStocks API unavailable (${error instanceof Error ? error.message : "error"})`);
        continue;
      }
      const product = catalog.products.find((p) => p.contractAddress === asset.mintAddress);
      if (!product || product.symbol !== asset.reference.symbol) {
        console.log(`seed: skipped ${asset.symbol}: the live PreStocks catalog does not list this exact mint`);
        continue;
      }
    }
    ready.push(asset);
  }
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const { asset } of blocked) {
      await upsertAsset(tx, { ...assetRowFromConfig(asset), active: false, inputEnabled: false, outputEnabled: false });
    }
    for (const asset of ready) await upsertAsset(tx, assetRowFromConfig(asset));
  });
  if (blocked.length > 0) console.log(`seed: disabled ${blocked.length} blocked asset(s): ${blocked.map(({ asset }) => asset.symbol).join(", ")}`);
  if (ready.length > 0) console.log(`seed: upserted ${ready.length} verified asset(s): ${ready.map((a) => a.symbol).join(", ")}`);
  if (blocked.length === 0 && ready.length === 0) console.log(`seed: 0 of ${configured.length} configured asset(s) changed.`);
}

try {
  await seed();
} catch (error) {
  // Print only the message: connection errors can embed connection details in other fields.
  console.error(`seed failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
