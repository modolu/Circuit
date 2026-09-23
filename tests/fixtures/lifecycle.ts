import type { Database } from "@/src/db/client";
import { upsertAsset } from "@/src/db/repositories/assets";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import type { Wallet } from "@/src/db/schema";
import { createPolicyDraft } from "@/src/services/create-policy";
import { getAssetReference } from "@/src/services/get-reference";
import type { CreatePolicyRequest } from "@/src/validation/policy";
import { fakeCatalogAsset } from "./catalog";
import { fakeWalletAddress } from "./db";
import { fixturePyth } from "./policy";
import { FIXTURE_UPDATE_US } from "./pyth";

/** The fixture reference instant; drafts created "now" expire 24h later. */
export const LIFECYCLE_NOW = new Date(Number(FIXTURE_UPDATE_US / 1000n) + 500);
export const AFTER_EXPIRY = new Date(LIFECYCLE_NOW.getTime() + 25 * 3600 * 1000);

export async function lifecycleWorld(db: Database) {
  const wallet: Wallet = await upsertWalletSeen(db, fakeWalletAddress());
  const assetId = (await upsertAsset(db, fakeCatalogAsset())).id;
  async function draft(overrides: Partial<CreatePolicyRequest> = {}, owner: Wallet = wallet) {
    const view = await createPolicyDraft(
      db,
      {
        wallet: owner,
        request: {
          assetId,
          side: "BUY",
          triggerDirection: "BELOW",
          expressionType: "ABSOLUTE_PRICE",
          expressionValue: "181",
          amount: "100",
          maxSlippageBps: 50,
          expiryHours: 24,
          ...overrides,
        },
        now: LIFECYCLE_NOW,
      },
      { loadReference: (database, id) => getAssetReference(database, id, { pyth: fixturePyth() }) },
    );
    return view.id;
  }
  return { wallet, assetId, draft };
}
