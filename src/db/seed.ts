import { verifiedAssetSchema, VERIFIED_ASSETS } from "../config/assets.ts";
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

  if (configured.length === 0) {
    console.log("seed: 0 verified assets configured in src/config/assets.ts; nothing written.");
    return;
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    for (const { verification, ...asset } of configured) {
      await upsertAsset(tx, { ...asset, metadata: { verification } });
    }
  });
  console.log(`seed: upserted ${configured.length} verified asset(s): ${configured.map((a) => a.symbol).join(", ")}`);
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
