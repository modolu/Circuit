import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USDC } from "@/src/config/tokens";
import { upsertAsset } from "@/src/db/repositories/assets";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import { policies, policyEvents, type Wallet } from "@/src/db/schema";
import { AppError } from "@/src/domain/errors";
import { PythRequestError } from "@/src/integrations/pyth/client";
import { createPolicyDraft, type ReferenceLoader } from "@/src/services/create-policy";
import { getAssetReference } from "@/src/services/get-reference";
import { getPolicyViewForWallet, listPolicyViewsForWallet } from "@/src/services/policy-view";
import type { CreatePolicyRequest } from "@/src/validation/policy";
import { fakeCatalogAsset } from "../fixtures/catalog";
import { fakeWalletAddress } from "../fixtures/db";
import { fixturePyth } from "../fixtures/policy";
import { FIXTURE_UPDATE_US } from "../fixtures/pyth";
import { createTestDb } from "./test-db";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const db = () => testDb.db;
let wallet: Wallet;
let assetId: string;
const NOW = new Date(Number(FIXTURE_UPDATE_US / 1000n) + 500);

beforeAll(async () => {
  testDb = await createTestDb();
  wallet = await upsertWalletSeen(db(), fakeWalletAddress());
  assetId = (await upsertAsset(db(), fakeCatalogAsset())).id;
});
afterAll(async () => {
  await testDb.close();
});

const loader = (mode: Parameters<typeof fixturePyth>[0] = "FRESH"): ReferenceLoader => (database, id) =>
  getAssetReference(database, id, { pyth: fixturePyth(mode) });

function request(overrides: Partial<CreatePolicyRequest> = {}): CreatePolicyRequest {
  return {
    assetId,
    side: "BUY",
    triggerDirection: "BELOW",
    expressionType: "ABSOLUTE_PRICE",
    expressionValue: "181",
    amount: "100",
    maxSlippageBps: 50,
    expiryHours: 24,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  throw new Error("expected failure");
}

describe("createPolicyDraft", () => {
  it("creates a DRAFT with the captured reference, exact values and three ordered events", async () => {
    const view = await createPolicyDraft(db(), { wallet, request: request(), now: NOW }, { loadReference: loader() });
    const [row] = await db().select().from(policies).where(eq(policies.id, view.id));

    expect(row!.status).toBe("DRAFT");
    expect(row!.walletId).toBe(wallet.id);
    expect(row!.amountAtomic).toBe(100_000_000n);
    expect(typeof row!.amountAtomic).toBe("bigint");
    expect(row!.compiledTriggerUsd).toBe("181.00");
    expect(row!.inputMint).toBe(USDC.mintAddress);
    expect(row!.referenceProvider).toBe("PYTH");
    expect(row!.referenceUsd).toBe("227.35");
    expect(row!.referenceSnapshotJson).toMatchObject({ provider: "PYTH", freshness: "FRESH", timestampKind: "SOURCE" });
    expect(row!.expiresAt.toISOString()).toBe(new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString());

    const events = await db().select().from(policyEvents).where(eq(policyEvents.policyId, view.id)).orderBy(policyEvents.sequenceNumber);
    expect(events.map((e) => [e.eventType, e.source])).toEqual([
      ["POLICY_CREATED", "USER"],
      ["REFERENCE_CAPTURED", "CIRCUIT"],
      ["POLICY_COMPILED", "CIRCUIT"],
    ]);
    expect(view.summary).toBe("Buy up to 100 USDC of TEST_ASSET if the USD price falls to or below $181.00 before expiry.");
  });

  it("compiles relative drafts from the live reference, never a caller-supplied price", async () => {
    const view = await createPolicyDraft(
      db(),
      { wallet, request: request({ expressionType: "RELATIVE_PERCENT", expressionValue: "3" }), now: NOW },
      { loadReference: loader() },
    );
    expect(view.compiledTriggerUsd).toBe("220.52"); // 227.35 × 0.97 = 220.5295, rounded down
    expect(view.reference?.priceUsd).toBe("227.35");
  });

  it("uses the stock token as input for SELL", async () => {
    const view = await createPolicyDraft(
      db(),
      { wallet, request: request({ side: "SELL", triggerDirection: "ABOVE", expressionValue: "250", amount: "0.25" }), now: NOW },
      { loadReference: loader() },
    );
    expect(view.amount).toEqual({ atomic: "25000000", display: "0.25", symbol: "TEST_ASSET" });
    expect(view.outputMint).toBe(USDC.mintAddress);
  });

  it("blocks unknown and disabled assets", async () => {
    expect(await failure(createPolicyDraft(db(), { wallet, request: request({ assetId: "00000000-0000-4000-8000-000000000000" }), now: NOW }, { loadReference: loader() }))).toBe("NOT_FOUND");
    const disabled = await upsertAsset(db(), fakeCatalogAsset({ active: false }));
    expect(await failure(createPolicyDraft(db(), { wallet, request: request({ assetId: disabled.id }), now: NOW }, { loadReference: loader() }))).toBe("ASSET_DISABLED");
  });

  it("blocks stale and unavailable references, and relative triggers on carried references", async () => {
    expect(await failure(createPolicyDraft(db(), { wallet, request: request(), now: NOW }, { loadReference: loader("STALE") }))).toBe("REFERENCE_STALE");
    expect(
      await failure(createPolicyDraft(db(), { wallet, request: request(), now: NOW }, { loadReference: loader(new PythRequestError("not_entitled", 403)) })),
    ).toBe("REFERENCE_UNAVAILABLE");
    expect(
      await failure(
        createPolicyDraft(db(), { wallet, request: request({ expressionType: "RELATIVE_PERCENT", expressionValue: "3" }), now: NOW }, { loadReference: loader("CARRIED") }),
      ),
    ).toBe("REFERENCE_STALE");
    const carriedAbsolute = await createPolicyDraft(db(), { wallet, request: request(), now: NOW }, { loadReference: loader("CARRIED") });
    expect(carriedAbsolute.reference?.freshness).toBe("CARRIED");
  });

  it("rolls back the policy and every event if any write fails", async () => {
    const before = (await db().select().from(policies)).length;
    const eventsBefore = (await db().select().from(policyEvents)).length;
    await db().execute(sql`
      CREATE FUNCTION test_fail_compiled_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'POLICY_COMPILED' THEN RAISE EXCEPTION 'simulated failure'; END IF;
        RETURN NEW;
      END; $$`);
    await db().execute(sql`CREATE TRIGGER test_fail_compiled BEFORE INSERT ON policy_events FOR EACH ROW EXECUTE FUNCTION test_fail_compiled_event()`);
    try {
      await expect(createPolicyDraft(db(), { wallet, request: request(), now: NOW }, { loadReference: loader() })).rejects.toThrow();
    } finally {
      await db().execute(sql`DROP TRIGGER test_fail_compiled ON policy_events`);
    }
    expect((await db().select().from(policies)).length).toBe(before);
    expect((await db().select().from(policyEvents)).length).toBe(eventsBefore);
  });

  it("scopes reads to the owning wallet", async () => {
    const view = await createPolicyDraft(db(), { wallet, request: request(), now: NOW }, { loadReference: loader() });
    const other = await upsertWalletSeen(db(), fakeWalletAddress());
    expect(await getPolicyViewForWallet(db(), { walletId: other.id, policyId: view.id })).toBeNull();
    expect(await listPolicyViewsForWallet(db(), other.id)).toEqual([]);
    const own = await getPolicyViewForWallet(db(), { walletId: wallet.id, policyId: view.id });
    expect(own?.policy.id).toBe(view.id);
    expect(own?.events.map((e) => e.eventType)).toEqual(["POLICY_CREATED", "REFERENCE_CAPTURED", "POLICY_COMPILED"]);
  });
});
