import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/src/db/client";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import { executions, mockProviderOrders, policies, policyEvents, type Policy } from "@/src/db/schema";
import { AppError } from "@/src/domain/errors";
import { armRequestId, EXECUTION_PROVIDERS } from "@/src/domain/policy";
import { createUnconfiguredLiveProvider } from "@/src/integrations/jupiter/live";
import { createMockProvider } from "@/src/integrations/jupiter/mock";
import { ProviderError, type ExecutionProvider, type ProviderOrder } from "@/src/integrations/jupiter/types";
import { armPolicy } from "@/src/services/arm-policy";
import { cancelPolicy } from "@/src/services/cancel-policy";
import { reconcilePolicy } from "@/src/services/reconcile-policy";
import { simulateProviderFill } from "@/src/services/simulate-provider-fill";
import { fakeWalletAddress } from "../fixtures/db";
import { AFTER_EXPIRY, LIFECYCLE_NOW, lifecycleWorld } from "../fixtures/lifecycle";
import { createTestDb } from "./test-db";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let world: Awaited<ReturnType<typeof lifecycleWorld>>;
const db = (): Database => testDb.db;
const mock = (now: Date = LIFECYCLE_NOW) => createMockProvider({ db: db(), now: () => now });

beforeAll(async () => {
  testDb = await createTestDb();
  world = await lifecycleWorld(db());
});
afterAll(async () => {
  await testDb.close();
});

const policyRow = async (id: string) => (await db().select().from(policies).where(eq(policies.id, id)))[0]!;
const eventsOf = async (id: string) =>
  (await db().select().from(policyEvents).where(eq(policyEvents.policyId, id)).orderBy(policyEvents.sequenceNumber)).map(
    (e) => [e.eventType, e.source] as const,
  );
const mockOrdersOf = async (id: string) => db().select().from(mockProviderOrders).where(eq(mockProviderOrders.policyId, id));
const arm = (id: string, provider: ExecutionProvider = mock(), now = LIFECYCLE_NOW) =>
  armPolicy(db(), { wallet: world.wallet, policyId: id, now }, { provider });
const reconcile = (id: string, provider: ExecutionProvider = mock()) =>
  reconcilePolicy(db(), { wallet: world.wallet, policyId: id, now: LIFECYCLE_NOW }, { provider });

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  throw new Error("expected failure");
}

/** Wraps the mock provider so a test can override what getOrder reports. */
function withOrder(override: (order: ProviderOrder) => ProviderOrder): ExecutionProvider {
  const base = mock();
  return { ...base, getOrder: async (id) => ((order) => (order ? override(order) : order))(await base.getOrder(id)) };
}

describe("arm (simulated provider)", () => {
  it("moves DRAFT → ARMING → ARMED with a mock order and truthful provenance", async () => {
    const id = await world.draft();
    const armed = await arm(id);

    expect(armed.status).toBe("ARMED");
    expect(armed.provider).toBe(EXECUTION_PROVIDERS.MOCK);
    expect(armed.providerOrderId).toMatch(/^mock_[0-9a-f]{32}$/);
    expect(armed.armedAt?.toISOString()).toBe(LIFECYCLE_NOW.toISOString());
    expect((await eventsOf(id)).slice(3)).toEqual([
      ["POLICY_ARMING", "CIRCUIT"],
      ["PROVIDER_ORDER_CREATED", "MOCK_PROVIDER"],
      ["POLICY_ARMED", "CIRCUIT"],
    ]);
    const [order] = await mockOrdersOf(id);
    expect(order!.clientRequestId).toBe(armRequestId(id));
    expect(order!.state).toBe("OPEN");
  });

  it("is still ARMING (never ARMED) while the provider is creating the order", async () => {
    const id = await world.draft();
    const base = mock();
    let statusDuringCreate: Policy["status"] | undefined;
    await arm(id, {
      ...base,
      createOrder: async (request) => {
        statusDuringCreate = (await policyRow(id)).status;
        return base.createOrder(request);
      },
    });
    expect(statusDuringCreate).toBe("ARMING");
  });

  it("marks FAILED when the provider definitively rejects, with a safe message", async () => {
    const id = await world.draft();
    const failing = createMockProvider({ db: db(), now: () => LIFECYCLE_NOW, failCreateWith: new ProviderError("rejected", true) });
    expect(await code(arm(id, failing))).toBe("PROVIDER_REJECTED");
    const row = await policyRow(id);
    expect(row.status).toBe("FAILED");
    expect(row.failureCode).toBe("PROVIDER_REJECTED");
    expect(row.failureMessage).not.toMatch(/Error|at |stack/);
    expect((await eventsOf(id)).at(-1)).toEqual(["POLICY_FAILED", "CIRCUIT"]);
    expect(await mockOrdersOf(id)).toHaveLength(0);
    expect(await code(arm(id))).toBe("POLICY_STATE_CONFLICT"); // terminal: cannot arm again
  });

  it("stays ARMING on an ambiguous failure, and a retry resumes without a second order", async () => {
    const id = await world.draft();
    const flaky = createMockProvider({ db: db(), now: () => LIFECYCLE_NOW, failCreateWith: new ProviderError("unavailable", false) });
    expect(await code(arm(id, flaky))).toBe("PROVIDER_UNAVAILABLE");
    expect((await policyRow(id)).status).toBe("ARMING");
    const armed = await arm(id);
    expect(armed.status).toBe("ARMED");
    expect(await mockOrdersOf(id)).toHaveLength(1);
  });

  it("creates exactly one provider order for concurrent and repeated arm requests", async () => {
    const id = await world.draft();
    const [a, b] = await Promise.all([arm(id), arm(id)]);
    expect(a.providerOrderId).toBe(b.providerOrderId);
    const again = await arm(id);
    expect(again.providerOrderId).toBe(a.providerOrderId);
    expect(await mockOrdersOf(id)).toHaveLength(1);
    expect((await eventsOf(id)).filter(([type]) => type === "POLICY_ARMED")).toHaveLength(1);
  });

  it("refuses another wallet, expired drafts, and live mode without touching state", async () => {
    const id = await world.draft();
    const stranger = await upsertWalletSeen(db(), fakeWalletAddress());
    expect(await code(armPolicy(db(), { wallet: stranger, policyId: id, now: LIFECYCLE_NOW }, { provider: mock() }))).toBe("NOT_FOUND");
    expect(await code(arm(id, mock(AFTER_EXPIRY), AFTER_EXPIRY))).toBe("POLICY_EXPIRED");
    expect(await code(arm(id, createUnconfiguredLiveProvider()))).toBe("PROVIDER_UNAVAILABLE");
    expect((await policyRow(id)).status).toBe("DRAFT");
    expect(await mockOrdersOf(id)).toHaveLength(0);
  });
});

describe("reconcile", () => {
  it("leaves ARMED unchanged while the provider reports OPEN, writing nothing", async () => {
    const id = await world.draft();
    await arm(id);
    const before = await eventsOf(id);
    const result = await reconcile(id);
    expect(result).toMatchObject({ changed: false, providerState: "OPEN" });
    expect(result.policy.status).toBe("ARMED");
    expect(await eventsOf(id)).toEqual(before);
  });

  it("a simulated fill changes only the provider; reconciliation then records EXECUTED exactly once", async () => {
    const id = await world.draft();
    await arm(id);
    const fill = await simulateProviderFill(db(), { wallet: world.wallet, policyId: id }, { provider: mock() });
    expect(fill.providerState).toBe("FILLED");
    expect((await policyRow(id)).status).toBe("ARMED");

    const first = await reconcile(id);
    const second = await reconcile(id);
    expect([first.changed, second.changed]).toEqual([true, false]);
    expect(second.policy.status).toBe("EXECUTED");

    const rows = await db().select().from(executions).where(eq(executions.policyId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ evidenceSource: "SIMULATED", transactionSignature: null, outputAmountAtomic: null, inputAmountAtomic: 100_000_000n });
    expect((await eventsOf(id)).slice(-3)).toEqual([
      ["SIMULATED_FILL_REQUESTED", "USER"],
      ["PROVIDER_ORDER_FILLED", "MOCK_PROVIDER"],
      ["POLICY_EXECUTED", "CIRCUIT"],
    ]);
  });

  it("mirrors provider CANCELLED and EXPIRED exactly once", async () => {
    const cancelledId = await world.draft();
    const armed = await arm(cancelledId);
    await mock().cancelOrder(armed.providerOrderId!);
    expect((await reconcile(cancelledId)).policy.status).toBe("CANCELLED");
    expect((await reconcile(cancelledId)).changed).toBe(false);

    const expiredId = await world.draft();
    await arm(expiredId);
    const expired = await reconcilePolicy(db(), { wallet: world.wallet, policyId: expiredId, now: AFTER_EXPIRY }, { provider: mock(AFTER_EXPIRY) });
    expect(expired).toMatchObject({ changed: true, providerState: "EXPIRED" });
    expect(expired.policy.status).toBe("EXPIRED");
    expect((await eventsOf(expiredId)).filter(([type]) => type === "POLICY_EXPIRED")).toHaveLength(1);
  });

  it("maps provider FAILED to FAILED", async () => {
    const id = await world.draft();
    await arm(id);
    const result = await reconcile(id, withOrder((order) => ({ ...order, rawState: "FAILED" })));
    expect(result.policy.status).toBe("FAILED");
    expect(result.policy.failureCode).toBe("PROVIDER_FAILED");
  });

  it("does not guess unknown provider states", async () => {
    const id = await world.draft();
    await arm(id);
    const result = await reconcile(id, withOrder((order) => ({ ...order, rawState: "PARTIALLY_SETTLED" })));
    expect(result).toMatchObject({ changed: false, providerState: "PARTIALLY_SETTLED" });
    expect(result.diagnostic).toMatch(/unrecognized/);
    expect((await policyRow(id)).status).toBe("ARMED");
  });

  it("rejects a provider order that belongs to another policy", async () => {
    const id = await world.draft();
    await arm(id);
    const wrong = withOrder((order) => ({ ...order, clientRequestId: armRequestId("00000000-0000-4000-8000-000000000000") }));
    expect(await code(reconcile(id, wrong))).toBe("PROVIDER_REJECTED");
    expect((await policyRow(id)).status).toBe("ARMED");
  });
});

describe("cancel", () => {
  it("records CANCELLED only after the provider confirms", async () => {
    const id = await world.draft();
    await arm(id);
    const result = await cancelPolicy(db(), { wallet: world.wallet, policyId: id, now: LIFECYCLE_NOW }, { provider: mock() });
    expect(result.outcome).toBe("CANCELLED");
    expect(result.policy.status).toBe("CANCELLED");
    expect(result.policy.cancelledAt).not.toBeNull();
    expect((await eventsOf(id)).slice(-3)).toEqual([
      ["CANCEL_REQUESTED", "USER"],
      ["PROVIDER_ORDER_CANCELLED", "MOCK_PROVIDER"],
      ["POLICY_CANCELLED", "CIRCUIT"],
    ]);
  });

  it("lets provider truth win when the order filled before cancellation confirmed", async () => {
    const id = await world.draft();
    await arm(id);
    await simulateProviderFill(db(), { wallet: world.wallet, policyId: id }, { provider: mock() });
    const result = await cancelPolicy(db(), { wallet: world.wallet, policyId: id, now: LIFECYCLE_NOW }, { provider: mock() });
    expect(result.outcome).toBe("ALREADY_FILLED");
    expect(result.policy.status).toBe("EXECUTED");
    expect(await code(cancelPolicy(db(), { wallet: world.wallet, policyId: id }, { provider: mock() }))).toBe("POLICY_STATE_CONFLICT");
    expect((await policyRow(id)).status).toBe("EXECUTED");
  });

  it("refuses to cancel a DRAFT with the provider", async () => {
    const id = await world.draft();
    expect(await code(cancelPolicy(db(), { wallet: world.wallet, policyId: id }, { provider: mock() }))).toBe("POLICY_STATE_CONFLICT");
  });
});

describe("mock provenance", () => {
  it("never records Solana evidence, JUPITER-sourced events or a non-mock provider for simulated orders", async () => {
    const signatures = await db().select({ s: executions.transactionSignature }).from(executions).where(eq(executions.evidenceSource, "SIMULATED"));
    expect(signatures.length).toBeGreaterThan(0);
    expect(signatures.every((row) => row.s === null)).toBe(true);
    const jupiterEvents = await db().select().from(policyEvents).where(eq(policyEvents.source, "JUPITER"));
    expect(jupiterEvents).toHaveLength(0);
    const armedProviders = await db().select({ p: policies.provider }).from(policies).where(sql`${policies.providerOrderId} IS NOT NULL`);
    expect(armedProviders.every((row) => row.p === EXECUTION_PROVIDERS.MOCK)).toBe(true);
    for (const order of await db().select().from(mockProviderOrders)) expect(order.providerOrderId).toMatch(/^mock_[0-9a-f]{32}$/);
  });

  it("the database refuses fake signatures on simulated rows and missing evidence on onchain rows", async () => {
    const id = await world.draft();
    await arm(id);
    const base = { policyId: id, providerOrderId: "mock_x", inputAmountAtomic: 1n, fillJson: {}, executedAt: LIFECYCLE_NOW };
    await expect(db().insert(executions).values({ ...base, evidenceSource: "SIMULATED", transactionSignature: "5YhNfake" })).rejects.toThrow();
    await expect(db().insert(executions).values({ ...base, evidenceSource: "ONCHAIN", transactionSignature: null, outputAmountAtomic: null })).rejects.toThrow();
  });

  it("mock-only operations are unavailable in live mode, with no fallback", async () => {
    const id = await world.draft();
    await arm(id);
    const live = createUnconfiguredLiveProvider();
    expect(live).toMatchObject({ simulated: false, configured: false, id: EXECUTION_PROVIDERS.LIVE });
    expect(await code(simulateProviderFill(db(), { wallet: world.wallet, policyId: id }, { provider: live }))).toBe("NOT_FOUND");
    expect(await code(reconcile(id, live))).toBe("PROVIDER_UNAVAILABLE");
    expect(await code(cancelPolicy(db(), { wallet: world.wallet, policyId: id }, { provider: live }))).toBe("PROVIDER_UNAVAILABLE");
    expect((await policyRow(id)).status).toBe("ARMED");
  });
});
