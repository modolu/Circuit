import { seedableAssets, verifiedAssetSchema, VERIFIED_ASSETS } from "../config/assets.ts";
import { closeDb, getDb } from "./client.ts";
import { upsertAsset } from "./repositories/assets.ts";

/*
 * Seeds only the verified asset catalog from src/config/assets.ts.
 * It never invents assets: with an empty catalog it writes nothing.
 * Test fixtures live in tests/ and are never imported here.
 *
 * Run with `pnpm db:seed`.
 */

async function seed(): Promise<void> {
  const configured = VERIFIED_ASSETS.map((entry) => verifiedAssetSchema.parse(entry));
  const ready = seedableAssets(configured);

  for (const asset of configured.filter((entry) => !ready.includes(entry))) {
    console.log(
      `seed: skipped ${asset.symbol}: Pyth live check is ${asset.verification.pythLiveCheck.status} (${asset.verification.pythLiveCheck.detail})`,
    );
  }
  if (ready.length === 0) {
    console.log(`seed: 0 of ${configured.length} configured asset(s) are ready; nothing written.`);
    return;
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    for (const asset of ready) {
      await upsertAsset(tx, {
        symbol: asset.symbol,
        displayName: asset.displayName,
        issuer: asset.issuer,
        underlyingSymbol: asset.underlyingSymbol,
        mintAddress: asset.mintAddress,
        decimals: asset.decimals,
        pythFeedId: String(asset.reference.feedId),
        active: true,
        // Execution stays off until Jupiter Trigger compatibility is verified.
        inputEnabled: asset.execution.status === "VERIFIED",
        outputEnabled: asset.execution.status === "VERIFIED",
        metadata: {
          reference: asset.reference,
          comparisonFeeds: asset.comparisonFeeds,
          execution: asset.execution,
          jupiter: asset.jupiter,
          executionPriceCalibration: asset.executionPriceCalibration,
          tokenProgram: asset.tokenProgram,
          issuerIds: asset.issuerIds,
          verification: asset.verification,
          notes: asset.notes,
        },
      });
    }
  });
  console.log(`seed: upserted ${ready.length} verified asset(s): ${ready.map((a) => a.symbol).join(", ")}`);
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
