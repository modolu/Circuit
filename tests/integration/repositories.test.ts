import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findAssetByMint, listActiveAssets, upsertAsset } from "@/src/db/repositories/assets";
import { findExecutionByPolicyId, insertExecutionOnce } from "@/src/db/repositories/executions";
import {
  appendPolicyEvent,
  findPolicyById,
  findPolicyForWallet,
  insertPolicy,
  listPoliciesForWallet,
  listPolicyEvents,
  updatePolicyStateIfStatus,
} from "@/src/db/repositories/policies";
import { findWalletByAddress, upsertWalletSeen } from "@/src/db/repositories/wallets";
import { policyEvents, wallets } from "@/src/db/schema";
import { fakeAsset, fakePolicy, fakeWalletAddress } from "../fixtures/db";
import { createTestDb } from "./test-db";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const db = () => testDb.db;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

async function walletAndAsset() {
  const wallet = await upsertWalletSeen(db(), fakeWalletAddress());
  const asset = await upsertAsset(db(), fakeAsset());
  return { walletId: wallet.id, assetId: asset.id };
}

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return `${(error as Error).message} ${cause?.message ?? ""}`;
  }
  throw new Error("expected the database to reject the operation");
}

describe("wallets", () => {
  it("keeps one row per address and refreshes last_seen_at", async () => {
    const address = fakeWalletAddress();
    const first = await upsertWalletSeen(db(), address, new Date("2026-01-01T00:00:00Z"));
    const second = await upsertWalletSeen(db(), address, new Date("2026-02-01T00:00:00Z"));

    expect(second.id).toBe(first.id);
    expect(second.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(second.lastSeenAt.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect((await findWalletByAddress(db(), address))?.id).toBe(first.id);
    expect(await findWalletByAddress(db(), fakeWalletAddress())).toBeUndefined();
  });

  it("rejects a duplicate address at the database level", async () => {
    const address = fakeWalletAddress();
    await db().insert(wallets).values({ address });
    expect(await rejection(db().insert(wallets).values({ address }))).toMatch(/wallets_address_unique/);
  });
});

describe("assets", () => {
  it("finds by exact mint and lists only active assets", async () => {
    const active = await upsertAsset(db(), fakeAsset());
    const inactive = await upsertAsset(db(), fakeAsset({ active: false }));

    expect((await findAssetByMint(db(), active.mintAddress))?.id).toBe(active.id);
    const listed = (await listActiveAssets(db())).map((asset) => asset.id);
    expect(listed).toContain(active.id);
    expect(listed).not.toContain(inactive.id);
  });
});

describe("policies", () => {
  it("round-trips atomic amounts as exact bigint and USD values as exact strings", async () => {
    const ids = await walletAndAsset();
    const huge = 10n ** 77n + 1n; // 78 digits: far beyond Number.MAX_SAFE_INTEGER
    const policy = await insertPolicy(
      db(),
      fakePolicy(ids, { amountAtomic: huge, compiledTriggerUsd: "181.000000000000000001" }),
    );

    const loaded = await findPolicyById(db(), policy.id);
    expect(typeof loaded?.amountAtomic).toBe("bigint");
    expect(loaded?.amountAtomic).toBe(huge);
    expect(loaded?.compiledTriggerUsd).toBe("181.000000000000000001");
    expect(loaded?.status).toBe("DRAFT");
  });

  it("scopes reads to the owning wallet and paginates newest first", async () => {
    const mine = await walletAndAsset();
    const theirs = await walletAndAsset();
    const times = ["2026-03-01", "2026-03-02", "2026-03-03"].map((d) => new Date(`${d}T00:00:00Z`));
    const created = [];
    for (const createdAt of times) created.push(await insertPolicy(db(), fakePolicy(mine, { createdAt })));
    const foreign = await insertPolicy(db(), fakePolicy(theirs));

    expect(await findPolicyForWallet(db(), { policyId: foreign.id, walletId: mine.walletId })).toBeUndefined();
    expect((await findPolicyForWallet(db(), { policyId: created[0]!.id, walletId: mine.walletId }))?.id).toBe(
      created[0]!.id,
    );

    const page1 = await listPoliciesForWallet(db(), mine.walletId, { limit: 2 });
    expect(page1.map((p) => p.id)).toEqual([created[2]!.id, created[1]!.id]);
    const last = page1.at(-1)!;
    const page2 = await listPoliciesForWallet(db(), mine.walletId, {
      limit: 2,
      before: { createdAt: last.createdAt, id: last.id },
    });
    expect(page2.map((p) => p.id)).toEqual([created[0]!.id]);
  });

  it("enforces architecture constraints in the database", async () => {
    const ids = await walletAndAsset();
    expect(await rejection(insertPolicy(db(), fakePolicy(ids, { amountAtomic: 0n })))).toMatch(
      /policies_amount_atomic_positive/,
    );
    expect(await rejection(insertPolicy(db(), fakePolicy(ids, { status: "ARMED" })))).toMatch(
      /policies_provider_backed_has_order_id/,
    );
    expect(await rejection(insertPolicy(db(), fakePolicy(ids, { compiledTriggerUsd: "0" })))).toMatch(
      /policies_compiled_trigger_positive/,
    );

    await insertPolicy(db(), fakePolicy(ids, { status: "ARMED", providerOrderId: "TEST_ORDER_NOT_REAL_1" }));
    expect(
      await rejection(
        insertPolicy(db(), fakePolicy(ids, { status: "ARMED", providerOrderId: "TEST_ORDER_NOT_REAL_1" })),
      ),
    ).toMatch(/policies_provider_order_id_key/);
  });

  it("applies state changes only from the expected status (compare-and-set)", async () => {
    const policy = await insertPolicy(db(), fakePolicy(await walletAndAsset()));

    const stale = await updatePolicyStateIfStatus(db(), {
      policyId: policy.id,
      expectedStatuses: ["ARMING"],
      changes: { status: "FAILED" },
    });
    expect(stale).toBeUndefined();

    const moved = await updatePolicyStateIfStatus(db(), {
      policyId: policy.id,
      expectedStatuses: ["DRAFT"],
      changes: { status: "ARMING" },
    });
    expect(moved?.status).toBe("ARMING");
  });
});

describe("policy events", () => {
  it("keeps append order within one transaction and rolls back with the policy change", async () => {
    const policy = await insertPolicy(db(), fakePolicy(await walletAndAsset()));

    await db().transaction(async (tx) => {
      await appendPolicyEvent(tx, { policyId: policy.id, eventType: "FIRST", source: "CIRCUIT", payload: {} });
      await appendPolicyEvent(tx, { policyId: policy.id, eventType: "SECOND", source: "USER", payload: {} });
      await appendPolicyEvent(tx, { policyId: policy.id, eventType: "THIRD", source: "SYSTEM", payload: {} });
    });
    expect((await listPolicyEvents(db(), policy.id)).map((e) => e.eventType)).toEqual(["FIRST", "SECOND", "THIRD"]);

    await expect(
      db().transaction(async (tx) => {
        await updatePolicyStateIfStatus(tx, {
          policyId: policy.id,
          expectedStatuses: ["DRAFT"],
          changes: { status: "CANCELLED" },
        });
        await appendPolicyEvent(tx, { policyId: policy.id, eventType: "ROLLED_BACK", source: "USER", payload: {} });
        throw new Error("simulated failure after both writes");
      }),
    ).rejects.toThrow("simulated failure");

    expect((await findPolicyById(db(), policy.id))?.status).toBe("DRAFT");
    expect((await listPolicyEvents(db(), policy.id)).map((e) => e.eventType)).not.toContain("ROLLED_BACK");
  });

  it("rejects updates, deletes and truncation of audit history", async () => {
    const policy = await insertPolicy(db(), fakePolicy(await walletAndAsset()));
    await appendPolicyEvent(db(), { policyId: policy.id, eventType: "CREATED", source: "CIRCUIT", payload: {} });

    const where = eq(policyEvents.policyId, policy.id);
    expect(await rejection(db().update(policyEvents).set({ eventType: "REWRITTEN" }).where(where))).toMatch(
      /append-only: UPDATE/,
    );
    expect(await rejection(db().delete(policyEvents).where(where))).toMatch(/append-only: DELETE/);
    expect(await rejection(db().execute(sql`truncate policy_events`))).toMatch(/append-only: TRUNCATE/);
    expect(await listPolicyEvents(db(), policy.id)).toHaveLength(1);
  });
});

describe("executions", () => {
  it("records exactly one execution per policy", async () => {
    const policy = await insertPolicy(
      db(),
      fakePolicy(await walletAndAsset(), { status: "EXECUTED", providerOrderId: "TEST_ORDER_NOT_REAL_2" }),
    );
    const base = {
      policyId: policy.id,
      providerOrderId: "TEST_ORDER_NOT_REAL_2",
      transactionSignature: "TEST_SIGNATURE_NOT_REAL_1",
      inputAmountAtomic: 1_000_000n,
      outputAmountAtomic: 5_522_120n,
      effectivePriceUsd: "181.09",
      fillJson: { fixture: true },
      executedAt: new Date("2026-01-02T02:18:41Z"),
    };

    const first = await insertExecutionOnce(db(), base);
    const retry = await insertExecutionOnce(db(), { ...base, transactionSignature: "TEST_SIGNATURE_NOT_REAL_2" });

    expect(first.inserted).toBe(true);
    expect(retry.inserted).toBe(false);
    expect(retry.execution.id).toBe(first.execution.id);
    expect(retry.execution.transactionSignature).toBe("TEST_SIGNATURE_NOT_REAL_1");
    expect((await findExecutionByPolicyId(db(), policy.id))?.outputAmountAtomic).toBe(5_522_120n);
  });
});
