import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { USDC } from "@/src/config/tokens";
import { upsertAsset } from "@/src/db/repositories/assets";
import { listPolicyEvents } from "@/src/db/repositories/policies";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import { executions, jupiterCancelPreparations, jupiterDepositPreparations, policies, type Wallet } from "@/src/db/schema";
import { JUPITER_VERIFICATION_LEVELS } from "@/src/domain/asset";
import { JupiterRequestError } from "@/src/integrations/jupiter/client";
import { createPolicyDraft } from "@/src/services/create-policy";
import { getAssetReference } from "@/src/services/get-reference";
import { armLivePolicy, RESUBMIT_AFTER_MS } from "@/src/services/jupiter/arm-live";
import { confirmLiveCancel, initiateLiveCancel } from "@/src/services/jupiter/cancel-live";
import { LIVE_SELL_DISABLED_MESSAGE } from "@/src/services/jupiter/live-gates";
import { CRAFTED_REUSE_MS, prepareJupiterDeposit } from "@/src/services/jupiter/prepare-deposit";
import { reconcileLivePolicy } from "@/src/services/jupiter/reconcile-live";
import type { CreatePolicyRequest } from "@/src/validation/policy";
import { fakeCatalogAsset } from "../fixtures/catalog";
import { fakeSignature, FakeJupiter, historyOrder, TEST_JWT } from "../fixtures/jupiter-fake";
import { LIFECYCLE_NOW } from "../fixtures/lifecycle";
import { fixturePyth } from "../fixtures/policy";
import { buildUnsignedTransaction, signTransaction, signWithWrongKey, testKeypair, transactionId } from "../fixtures/transactions";
import { createTestDb } from "./test-db";

/*
 * The complete live Jupiter Trigger lifecycle against PGlite and an in-memory Jupiter.
 * Test keys only; no network, no funds.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let client: FakeJupiter;
const keypair = testKeypair(10);
const stranger = testKeypair(11);
let owner: Wallet;
let readyAssetId: string;
let readyAssetMint: string;
let blockedAssetId: string;
const NOW = LIFECYCLE_NOW;
const later = (ms: number) => new Date(NOW.getTime() + ms);

const REFERENCE_BASIS = {
  status: "RESOLVED",
  policyReference: "Pyth Equity.US.AAPL/USD",
  executionMonitor: "Jupiter AAPLx/USD",
  triggerMapping: "IDENTITY",
  disclosure: "AAPLx is a secondary-market token and may trade at a premium or discount to underlying AAPL.",
  detail: "fixture",
};
const GATE_PASSING = {
  jupiter: {
    checkedAt: "2026-09-23T17:00:00Z",
    docsVersion: "fixture",
    levels: Object.fromEntries(JUPITER_VERIFICATION_LEVELS.map((level) => [level, { result: "NOT_TESTED", detail: "fixture" }])),
    sides: { BUY: { result: "PASSED", detail: "fixture" }, SELL: { result: "RESTRICTED", detail: "fixture" } },
  },
  referenceBasis: REFERENCE_BASIS,
  verification: { pythLiveCheck: { status: "PASSED" } },
};

beforeAll(async () => {
  testDb = await createTestDb();
  owner = await upsertWalletSeen(testDb.db, keypair.publicKey.toBase58());
  const base = fakeCatalogAsset().metadata as object;
  const ready = await upsertAsset(testDb.db, fakeCatalogAsset({ mintAddress: testKeypair(40).publicKey.toBase58(), metadata: { ...base, ...GATE_PASSING } }));
  readyAssetId = ready.id;
  readyAssetMint = ready.mintAddress;
  blockedAssetId = (
    await upsertAsset(
      testDb.db,
      fakeCatalogAsset({ metadata: { ...base, ...GATE_PASSING, verification: { pythLiveCheck: { status: "NOT_ENTITLED" } } } }),
    )
  ).id;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});
beforeEach(() => {
  client = new FakeJupiter();
  client.vaultOwner = owner.address;
  client.vaultRegistered = true;
});

async function draft(overrides: Partial<CreatePolicyRequest> = {}, assetId = readyAssetId, by: Wallet = owner) {
  const view = await createPolicyDraft(
    testDb.db,
    {
      wallet: by,
      request: {
        assetId,
        side: "BUY",
        triggerDirection: "BELOW",
        expressionType: "ABSOLUTE_PRICE",
        expressionValue: "194",
        amount: "25",
        maxSlippageBps: 50,
        expiryHours: 24,
        ...overrides,
      },
      now: NOW,
    },
    { loadReference: (db, id) => getAssetReference(db, id, { pyth: fixturePyth() }) },
  );
  return view.id;
}

const live = { jwt: TEST_JWT, mode: "live" as const };
const prepare = (policyId: string, now = NOW) => prepareJupiterDeposit(testDb.db, { wallet: owner, policyId, ...live, now }, { client });
const arm = (policyId: string, preparationId: string, signedTransaction?: string, now = NOW, jwt: string | null = TEST_JWT) =>
  armLivePolicy(testDb.db, { wallet: owner, policyId, preparationId, signedTransaction, jwt, mode: "live", now }, { client });
const reconcile = (policyId: string, now = later(120_000)) => reconcileLivePolicy(testDb.db, { wallet: owner, policyId, ...live, now }, { client });

async function preparedAndSigned(overrides: Partial<CreatePolicyRequest> = {}) {
  const policyId = await draft(overrides);
  const prepared = await prepare(policyId);
  const signed = signTransaction(prepared.unsignedTransaction, keypair);
  return { policyId, preparationId: prepared.preparation.id, signed, depositSig: transactionId(signed) };
}

async function armedPolicy(overrides: Partial<CreatePolicyRequest> = {}) {
  const ctx = await preparedAndSigned(overrides);
  const result = await arm(ctx.policyId, ctx.preparationId, ctx.signed);
  const orderId = result.policy.providerOrderId!;
  client.orders.push(
    historyOrder({ id: orderId, userPubkey: owner.address, inputMint: USDC.mintAddress, outputMint: readyAssetMint, amount: "25000000", depositTxSignature: ctx.depositSig }),
  );
  return { ...ctx, orderId };
}

const policyRow = async (id: string) => (await testDb.db.select().from(policies).where(eq(policies.id, id)))[0]!;
const prepRow = async (id: string) => (await testDb.db.select().from(jupiterDepositPreparations).where(eq(jupiterDepositPreparations.id, id)))[0]!;
const eventTypes = async (id: string) => (await listPolicyEvents(testDb.db, id)).map((event) => `${event.eventType}:${event.source}`);
const executionRows = (id: string) => testDb.db.select().from(executions).where(eq(executions.policyId, id));
const order = (id: string) => client.orders.find((o) => o.id === id)!;

describe("live arm: happy paths", () => {
  it.each([
    ["BELOW", "below"],
    ["ABOVE", "above"],
  ] as const)("BUY %s: exact signed deposit → Jupiter order → ARMED with real provenance", async (direction, condition) => {
    const { policyId, preparationId, signed, depositSig } = await preparedAndSigned({ triggerDirection: direction });
    const result = await arm(policyId, preparationId, signed);

    expect(result.outcome).toBe("ARMED");
    expect(result.policy).toMatchObject({ status: "ARMED", provider: "jupiter_trigger_v2", providerState: "OPEN" });
    expect(result.policy.providerOrderId).toMatch(/^order-\d+-not-real$/);
    const prep = await prepRow(preparationId);
    expect(prep).toMatchObject({ status: "CONSUMED", depositTxSignature: depositSig, signedTransaction: null, providerOrderId: result.policy.providerOrderId });

    // The order body comes only from persisted policy/config/preparation values.
    expect(client.created).toHaveLength(1);
    expect(client.created[0]).toEqual({
      orderType: "single",
      depositRequestId: prep.depositRequestId,
      depositSignedTx: signed,
      userPubkey: owner.address,
      inputMint: USDC.mintAddress,
      outputMint: readyAssetMint,
      inputAmount: "25000000",
      triggerMint: readyAssetMint,
      triggerCondition: condition,
      triggerPriceUsd: 194,
      slippageBps: 50,
      expiresAt: (await policyRow(policyId)).expiresAt.getTime(),
    });
    expect(await eventTypes(policyId)).toEqual(
      expect.arrayContaining(["JUPITER_DEPOSIT_PREPARED:JUPITER", "DEPOSIT_SIGNED:USER", "POLICY_ARMING:CIRCUIT", "PROVIDER_ORDER_CREATED:JUPITER", "POLICY_ARMED:CIRCUIT"]),
    );
  });

  it("commits the deposit signature and ARMING before Jupiter is called", async () => {
    const { policyId, preparationId, signed, depositSig } = await preparedAndSigned();
    let seen: { status: string; signature: string | null; submitted: boolean } | null = null;
    client.onCreate = async () => {
      const [policy, prep] = [await policyRow(policyId), await prepRow(preparationId)];
      seen = { status: policy.status, signature: prep.depositTxSignature, submitted: prep.submissionStartedAt !== null };
    };
    await arm(policyId, preparationId, signed);
    expect(seen).toEqual({ status: "ARMING", signature: depositSig, submitted: true });
  });

  it("is idempotent: repeated and concurrent arms create exactly one Jupiter order", async () => {
    const { policyId, preparationId, signed } = await preparedAndSigned();
    client.createDelayMs = 30;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => arm(policyId, preparationId, signed)));
    expect(client.created).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "POLICY_STATE_CONFLICT" });
    expect((await policyRow(policyId)).status).toBe("ARMED");
    const again = await arm(policyId, preparationId, signed);
    expect(again.outcome).toBe("ALREADY_ARMED");
    expect(client.created).toHaveLength(1);
  });
});

describe("live arm: gates and rejections before any provider call", () => {
  it("rejects SELL before craft, signing or create", async () => {
    const policyId = await draft({ side: "SELL", triggerDirection: "ABOVE", expressionValue: "250", amount: "1" });
    await expect(prepare(policyId)).rejects.toMatchObject({ code: "ASSET_DISABLED", message: LIVE_SELL_DISABLED_MESSAGE });
    await expect(arm(policyId, crypto.randomUUID(), "AAAA")).rejects.toMatchObject({ code: "ASSET_DISABLED", message: LIVE_SELL_DISABLED_MESSAGE });
    expect(client.calls).toEqual([]);
  });

  it("rejects below the 10 USD minimum, another wallet's policy, and a missing Jupiter session", async () => {
    await expect(prepare(await draft({ amount: "9.99" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR", cause: "BELOW_PROVIDER_MINIMUM" });
    const other = await upsertWalletSeen(testDb.db, stranger.publicKey.toBase58());
    const { policyId, preparationId, signed } = await preparedAndSigned();
    await expect(armLivePolicy(testDb.db, { wallet: other, policyId, preparationId, signedTransaction: signed, ...live, now: NOW }, { client })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(arm(policyId, preparationId, signed, NOW, null)).rejects.toMatchObject({ code: "PROVIDER_AUTH_REQUIRED" });
    expect(client.created).toHaveLength(0);
  });

  it("keeps production blocked by the Pyth gate, and a reference-basis regression blocks too", async () => {
    await expect(prepare(await draft({}, blockedAssetId))).rejects.toMatchObject({ code: "ASSET_DISABLED", cause: "PYTH_LIVE_CHECK_REQUIRED" });
    const base = fakeCatalogAsset().metadata as object;
    const regressed = await upsertAsset(
      testDb.db,
      fakeCatalogAsset({ metadata: { ...base, ...GATE_PASSING, referenceBasis: { ...REFERENCE_BASIS, status: "UNRESOLVED" } } }),
    );
    await expect(prepare(await draft({}, regressed.id))).rejects.toMatchObject({ code: "ASSET_DISABLED", cause: "REFERENCE_BASIS_UNRESOLVED" });
    expect(client.calls.filter((c) => c.startsWith("craft"))).toEqual([]);
  });

  it("requires the wallet's own vault and a transaction paid by the wallet", async () => {
    client.vaultRegistered = false;
    await expect(prepare(await draft())).rejects.toMatchObject({ code: "PROVIDER_REJECTED", cause: "NO_VAULT" });
    client.vaultRegistered = true;
    const original = client.craftDeposit.bind(client);
    client.craftDeposit = async (jwt, request) => ({ ...(await original(jwt, request)), transaction: buildUnsignedTransaction({ payer: stranger.publicKey, extraSigner: keypair.publicKey }) });
    await expect(prepare(await draft())).rejects.toMatchObject({ code: "PROVIDER_REJECTED", cause: "DEPOSIT_TX_FEE_PAYER_MISMATCH" });
    client.craftDeposit = async (jwt, request) => ({ ...(await original(jwt, request)), receiverAddress: stranger.publicKey.toBase58() });
    await expect(prepare(await draft())).rejects.toMatchObject({ code: "PROVIDER_REJECTED", cause: "DEPOSIT_MISMATCH" });
  });

  it("rejects a wrong signer, a modified transaction and a stale preparation, submitting nothing", async () => {
    const { policyId, preparationId, signed } = await preparedAndSigned();
    const prepared = (await prepRow(preparationId)).unsignedTransaction!;
    await expect(arm(policyId, preparationId, signWithWrongKey(prepared, 0, stranger))).rejects.toMatchObject({ code: "VALIDATION_ERROR", cause: "SIGNED_TX_SIGNATURE_INVALID" });
    const tampered = signTransaction(buildUnsignedTransaction({ payer: keypair.publicKey, lamports: 1 }), keypair);
    await expect(arm(policyId, preparationId, tampered)).rejects.toMatchObject({ code: "VALIDATION_ERROR", cause: "SIGNED_TX_MESSAGE_MISMATCH" });
    await expect(arm(policyId, preparationId, "not-base64!")).rejects.toMatchObject({ code: "VALIDATION_ERROR", cause: "SIGNED_TX_MALFORMED" });
    expect((await policyRow(policyId)).status).toBe("DRAFT");

    // An unsubmitted preparation older than the reuse window is re-crafted; the old one can't be armed.
    const fresh = await prepare(policyId, later(CRAFTED_REUSE_MS + 1_000));
    expect(fresh.preparation.id).not.toBe(preparationId);
    await expect(arm(policyId, preparationId, signed)).rejects.toMatchObject({ code: "POLICY_STATE_CONFLICT" });
    expect(client.created).toHaveLength(0);
  });
});

describe("ambiguous create and ARMING recovery", () => {
  it("timeout → ARMING (never FAILED, no second deposit); history recovery → ARMED", async () => {
    const { policyId, preparationId, signed, depositSig } = await preparedAndSigned();
    client.failures.create = [new JupiterRequestError("timeout")];
    await expect(arm(policyId, preparationId, signed)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect((await policyRow(policyId)).status).toBe("ARMING");
    expect(await prepRow(preparationId)).toMatchObject({ status: "CRAFTED", depositTxSignature: depositSig });

    expect(await reconcile(policyId)).toMatchObject({ changed: false, diagnostic: expect.stringContaining("no order for this deposit") });
    client.orders.push(
      historyOrder({ id: "order-late", userPubkey: owner.address, inputMint: USDC.mintAddress, outputMint: readyAssetMint, amount: "25000000", depositTxSignature: depositSig }),
    );
    const recovered = await reconcile(policyId);
    expect(recovered.policy).toMatchObject({ status: "ARMED", providerOrderId: "order-late", providerState: "OPEN" });
    expect((await prepRow(preparationId)).status).toBe("CONSUMED");
    expect(await eventTypes(policyId)).toContain("PROVIDER_ORDER_RECOVERED:JUPITER");
    expect(client.craftCount).toBe(1);
    expect(client.created).toHaveLength(1);
  });

  it("5xx and duplicate-deposit responses stay ARMING; a definitive 400 marks FAILED with no deposit", async () => {
    const a = await preparedAndSigned();
    client.failures.create = [new JupiterRequestError("http_error", 500)];
    await expect(arm(a.policyId, a.preparationId, a.signed)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect((await policyRow(a.policyId)).status).toBe("ARMING");

    const b = await preparedAndSigned();
    client.failures.create = [new JupiterRequestError("bad_request", 400, "duplicate deposit")];
    await expect(arm(b.policyId, b.preparationId, b.signed)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect((await policyRow(b.policyId)).status).toBe("ARMING");

    const c = await preparedAndSigned();
    client.failures.create = [new JupiterRequestError("bad_request", 400, "Invalid signed deposit transaction")];
    await expect(arm(c.policyId, c.preparationId, c.signed)).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
    expect(await policyRow(c.policyId)).toMatchObject({ status: "FAILED", failureCode: "PROVIDER_REJECTED" });
    expect(await prepRow(c.preparationId)).toMatchObject({ status: "INVALIDATED", signedTransaction: null });
  });

  it("history reporting FILLED recovers straight through ARMED to EXECUTED with real evidence", async () => {
    const { policyId, preparationId, signed, depositSig } = await preparedAndSigned();
    client.failures.create = [new JupiterRequestError("network")];
    await expect(arm(policyId, preparationId, signed)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    client.orders.push(
      historyOrder({
        id: "order-filled",
        userPubkey: owner.address,
        inputMint: USDC.mintAddress,
        outputMint: readyAssetMint,
        amount: "25000000",
        depositTxSignature: depositSig,
        orderState: "filled",
        rawState: "fill_success",
        inputUsed: "25000000",
        outputAmount: "7401234",
        fillPercent: 1,
        fills: [{ txSignature: fakeSignature(61), timestamp: 1_790_190_000_000, outputAmount: "7401234" }],
      }),
    );
    const result = await reconcile(policyId);
    expect(result.policy.status).toBe("EXECUTED");
    const [execution] = await executionRows(policyId);
    expect(execution).toMatchObject({ evidenceSource: "ONCHAIN", transactionSignature: fakeSignature(61), inputAmountAtomic: 25_000_000n, outputAmountAtomic: 7_401_234n });
    expect(await eventTypes(policyId)).toEqual(expect.arrayContaining(["POLICY_ARMED:CIRCUIT", "PROVIDER_ORDER_FILLED:JUPITER", "POLICY_EXECUTED:CIRCUIT"]));
  });

  it("multiple strong matches are never guessed", async () => {
    const { policyId, preparationId, signed, depositSig } = await preparedAndSigned();
    client.failures.create = [new JupiterRequestError("timeout")];
    await expect(arm(policyId, preparationId, signed)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    for (const id of ["dup-a", "dup-b"]) {
      client.orders.push(historyOrder({ id, userPubkey: owner.address, inputMint: USDC.mintAddress, outputMint: readyAssetMint, amount: "25000000", depositTxSignature: depositSig }));
    }
    await expect(reconcile(policyId)).rejects.toMatchObject({ code: "PROVIDER_REJECTED", cause: "PROVIDER_AMBIGUOUS" });
    expect(await policyRow(policyId)).toMatchObject({ status: "ARMING", providerOrderId: null });
    expect(await eventTypes(policyId)).toContain("PROVIDER_ORDER_AMBIGUOUS:CIRCUIT");
  });

  it("a Jupiter session expiring mid-arm keeps the signed deposit; after re-auth it is resubmitted without a new signature", async () => {
    const { policyId, preparationId, signed } = await preparedAndSigned();
    client.unauthorized = true;
    await expect(arm(policyId, preparationId, signed)).rejects.toMatchObject({ code: "PROVIDER_AUTH_REQUIRED" });
    expect((await policyRow(policyId)).status).toBe("ARMING");
    expect((await prepRow(preparationId)).signedTransaction).toBe(signed);

    client.unauthorized = false;
    await expect(arm(policyId, preparationId, undefined, later(10_000))).rejects.toMatchObject({ code: "POLICY_STATE_CONFLICT" }); // too soon
    const resumed = await arm(policyId, preparationId, undefined, later(RESUBMIT_AFTER_MS + 1_000));
    expect(resumed.policy.status).toBe("ARMED");
    expect(client.craftCount).toBe(1);
    expect(client.created.map((body) => body.depositSignedTx)).toEqual([signed, signed]);
  });

  it("an unconfirmed deposit keeps ARMING with the order id until history shows it open", async () => {
    const { policyId, preparationId, signed, depositSig } = await preparedAndSigned();
    client.createResponse = (body) => ({ id: "order-pending", txSignature: transactionId(body.depositSignedTx), depositConfirmed: false });
    const result = await arm(policyId, preparationId, signed);
    expect(result).toMatchObject({ outcome: "CONFIRMATION_PENDING", policy: { status: "ARMING", providerOrderId: "order-pending", providerState: "PENDING" } });
    const pending = historyOrder({ id: "order-pending", userPubkey: owner.address, inputMint: USDC.mintAddress, outputMint: readyAssetMint, amount: "25000000", depositTxSignature: depositSig, orderState: "pending" });
    client.orders.push(pending);
    expect((await reconcile(policyId)).policy.status).toBe("ARMING");
    pending.orderState = "open";
    expect((await reconcile(policyId)).policy).toMatchObject({ status: "ARMED", providerState: "OPEN" });
  });
});

describe("live reconciliation", () => {
  it("open → unchanged; executing and partial fills stay ARMED with provider-reported progress", async () => {
    const { policyId, orderId } = await armedPolicy();
    expect(await reconcile(policyId)).toMatchObject({ changed: false, providerState: "OPEN" });
    Object.assign(order(orderId), { orderState: "executing", rawState: "partial_fill_success", inputUsed: "10000000", outputAmount: "2960000", fillPercent: 0.4 });
    const partial = await reconcile(policyId);
    expect(partial.policy).toMatchObject({ status: "ARMED", providerState: "EXECUTING" });
    expect(partial.policy.providerProgressJson).toMatchObject({ inputUsed: "10000000", outputAmount: "2960000", fillPercent: "0.4" });
    expect(await executionRows(policyId)).toHaveLength(0);
  });

  it("filled → EXECUTED exactly once, keeping every fill event and never the deposit signature", async () => {
    const { policyId, orderId, depositSig } = await armedPolicy();
    Object.assign(order(orderId), {
      orderState: "filled",
      rawState: "fill_success",
      inputUsed: "25000000",
      outputAmount: "123456789012345678901234567890",
      fillPercent: 1,
    });
    order(orderId).events.push(
      { type: "fill", timestamp: 1_790_190_000_000, state: "success", txSignature: fakeSignature(71), outputMint: readyAssetMint, outputAmount: "1" },
      { type: "fill", timestamp: 1_790_190_500_000, state: "success", txSignature: fakeSignature(72), outputMint: readyAssetMint, outputAmount: "2" },
    );
    const first = await reconcile(policyId);
    const second = await reconcile(policyId);
    expect(first).toMatchObject({ changed: true, policy: { status: "EXECUTED" } });
    expect(second.changed).toBe(false);
    const rows = await executionRows(policyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ evidenceSource: "ONCHAIN", transactionSignature: fakeSignature(72), outputAmountAtomic: 123456789012345678901234567890n });
    expect(rows[0]!.transactionSignature).not.toBe(depositSig);
    expect((rows[0]!.fillJson as { fills: unknown[] }).fills).toHaveLength(2);
    const events = await eventTypes(policyId);
    expect(events.filter((e) => e === "POLICY_EXECUTED:CIRCUIT")).toHaveLength(1);
  });

  it("filled without genuine fill signatures is not recorded as onchain evidence", async () => {
    const { policyId, orderId } = await armedPolicy();
    Object.assign(order(orderId), { orderState: "filled", inputUsed: "25000000", outputAmount: "7000000" });
    order(orderId).events.push({ type: "fill", timestamp: 1_790_190_000_000, state: "success", txSignature: "mock_notarealsignature", outputMint: readyAssetMint, outputAmount: "7000000" });
    const result = await reconcile(policyId);
    expect(result.policy).toMatchObject({ status: "ARMED", providerState: "FILLED" });
    expect(result.diagnostic).toMatch(/fill evidence/);
    expect(await executionRows(policyId)).toHaveLength(0);
  });

  it.each([
    ["expired", "EXPIRED"],
    ["failed", "FAILED"],
    ["cancelled", "CANCELLED"],
  ] as const)("%s → %s once", async (state, status) => {
    const { policyId, orderId } = await armedPolicy();
    order(orderId).orderState = state;
    expect((await reconcile(policyId)).policy.status).toBe(status);
    expect((await reconcile(policyId)).changed).toBe(false);
    expect((await eventTypes(policyId)).filter((e) => e.startsWith(`POLICY_${status}`))).toHaveLength(1);
  });

  it("pending_withdraw keeps ARMED but shows the cancellation is pending; unknown states change nothing", async () => {
    const { policyId, orderId } = await armedPolicy();
    order(orderId).orderState = "pending_withdraw";
    expect((await reconcile(policyId)).policy).toMatchObject({ status: "ARMED", providerState: "PENDING_WITHDRAW" });
    order(orderId).orderState = "brand_new_state";
    expect(await reconcile(policyId)).toMatchObject({ changed: false, providerState: "UNKNOWN", diagnostic: expect.stringContaining("unrecognized") });
    expect((await policyRow(policyId)).providerState).toBe("PENDING_WITHDRAW");
  });

  it("rejects an order that belongs to another wallet", async () => {
    const { policyId, orderId } = await armedPolicy();
    order(orderId).userPubkey = stranger.publicKey.toBase58();
    await expect(reconcile(policyId)).rejects.toMatchObject({ code: "PROVIDER_REJECTED", cause: "ORDER_MISMATCH" });
  });

  it("an executed policy never becomes CANCELLED", async () => {
    const { policyId, orderId } = await armedPolicy();
    Object.assign(order(orderId), { orderState: "filled", inputUsed: "25000000", outputAmount: "7000000" });
    order(orderId).events.push({ type: "fill", timestamp: 1_790_190_000_000, state: "success", txSignature: fakeSignature(81), outputMint: readyAssetMint, outputAmount: "7000000" });
    await reconcile(policyId);
    order(orderId).orderState = "cancelled";
    await reconcile(policyId);
    expect((await policyRow(policyId)).status).toBe("EXECUTED");
  });
});

describe("live cancellation and withdrawal", () => {
  const initiate = (policyId: string, jwt: string | null = TEST_JWT) =>
    initiateLiveCancel(testDb.db, { wallet: owner, policyId, jwt, mode: "live", now: later(200_000) }, { client });
  const confirm = (policyId: string, preparationId: string, signedTransaction?: string, now = later(210_000), jwt: string | null = TEST_JWT) =>
    confirmLiveCancel(testDb.db, { wallet: owner, policyId, preparationId, signedTransaction, jwt, mode: "live", now }, { client });
  const cancelRows = (policyId: string) => testDb.db.select().from(jupiterCancelPreparations).where(eq(jupiterCancelPreparations.policyId, policyId));

  it("open → stop fills (not CANCELLED) → verified withdrawal → CANCELLED", async () => {
    const { policyId } = await armedPolicy();
    const started = await initiate(policyId);
    expect(started.outcome).toBe("WITHDRAWAL_READY");
    expect(started.policy).toMatchObject({ status: "ARMED", providerState: "PENDING_WITHDRAW" });
    expect(started.preparation).toMatchObject({ status: "PREPARED", purpose: "CANCEL" });

    const signed = signTransaction(started.unsignedTransaction!, keypair);
    const done = await confirm(policyId, started.preparation!.id, signed);
    expect(done.policy).toMatchObject({ status: "CANCELLED", providerState: "CANCELLED" });
    expect(done.withdrawalTxSignature).toBe(transactionId(signed));
    expect(await cancelRows(policyId)).toEqual([expect.objectContaining({ status: "CONFIRMED", signedTransaction: null })]);
    expect(await eventTypes(policyId)).toEqual(
      expect.arrayContaining(["CANCEL_REQUESTED:USER", "PROVIDER_CANCEL_INITIATED:JUPITER", "WITHDRAWAL_SIGNED:USER", "FUNDS_WITHDRAWN:JUPITER", "POLICY_CANCELLED:CIRCUIT"]),
    );
  });

  it("rejects a wrong signer or a modified withdrawal before calling confirm", async () => {
    const { policyId } = await armedPolicy();
    const started = await initiate(policyId);
    await expect(confirm(policyId, started.preparation!.id, signWithWrongKey(started.unsignedTransaction!, 0, stranger))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const other = signTransaction(buildUnsignedTransaction({ payer: keypair.publicKey, lamports: 42 }), keypair);
    await expect(confirm(policyId, started.preparation!.id, other)).rejects.toMatchObject({ code: "VALIDATION_ERROR", cause: "SIGNED_TX_MESSAGE_MISMATCH" });
    expect(client.confirmCount).toBe(0);
    expect((await policyRow(policyId)).status).toBe("ARMED");
  });

  it("a confirm timeout is not CANCELLED and is retried with the same signed withdrawal", async () => {
    const { policyId } = await armedPolicy();
    const started = await initiate(policyId);
    const signed = signTransaction(started.unsignedTransaction!, keypair);
    client.failures.confirm = [new JupiterRequestError("timeout")];
    await expect(confirm(policyId, started.preparation!.id, signed)).rejects.toMatchObject({ code: "CANCELLATION_FAILED", retryable: true });
    expect((await policyRow(policyId)).status).toBe("ARMED");
    expect((await cancelRows(policyId))[0]).toMatchObject({ status: "SUBMITTING" });
    const retried = await confirm(policyId, started.preparation!.id, undefined, later(300_000));
    expect(retried.policy.status).toBe("CANCELLED");
  });

  it("a Jupiter session expiring between steps keeps the preparation; after re-auth the withdrawal completes", async () => {
    const { policyId } = await armedPolicy();
    const started = await initiate(policyId);
    const signed = signTransaction(started.unsignedTransaction!, keypair);
    await expect(confirm(policyId, started.preparation!.id, signed, later(210_000), null)).rejects.toMatchObject({ code: "PROVIDER_AUTH_REQUIRED" });
    client.unauthorized = true;
    await expect(confirm(policyId, started.preparation!.id, signed)).rejects.toMatchObject({ code: "PROVIDER_AUTH_REQUIRED" });
    expect((await cancelRows(policyId))[0]).toMatchObject({ status: "SUBMITTING" });
    client.unauthorized = false;
    expect((await confirm(policyId, started.preparation!.id, undefined, later(400_000))).policy.status).toBe("CANCELLED");
  });

  it("an expired order stays EXPIRED and its funds can still be withdrawn", async () => {
    const { policyId, orderId } = await armedPolicy();
    order(orderId).orderState = "expired";
    expect((await reconcile(policyId)).policy.status).toBe("EXPIRED");
    const started = await initiate(policyId);
    expect(started.preparation).toMatchObject({ purpose: "WITHDRAW_EXPIRED" });
    const done = await confirm(policyId, started.preparation!.id, signTransaction(started.unsignedTransaction!, keypair));
    expect(done.policy).toMatchObject({ status: "EXPIRED", providerState: "CANCELLED" });
    expect(await eventTypes(policyId)).toContain("FUNDS_WITHDRAWN:JUPITER");
    expect(await eventTypes(policyId)).not.toContain("POLICY_CANCELLED:CIRCUIT");
    expect((await initiate(policyId)).outcome).toBe("ALREADY_WITHDRAWN");
  });

  it("a fill before cancellation wins: EXECUTED, and no cancellation is started", async () => {
    const { policyId, orderId } = await armedPolicy();
    Object.assign(order(orderId), { orderState: "filled", inputUsed: "25000000", outputAmount: "7000000" });
    order(orderId).events.push({ type: "fill", timestamp: 1_790_190_000_000, state: "success", txSignature: fakeSignature(91), outputMint: readyAssetMint, outputAmount: "7000000" });
    const result = await initiate(policyId);
    expect(result).toMatchObject({ outcome: "ALREADY_FILLED", policy: { status: "EXECUTED" } });
    expect(client.cancelCount).toBe(0);
  });

  it("re-crafting a lost withdrawal keeps exactly one active preparation", async () => {
    const { policyId } = await armedPolicy();
    const first = await initiate(policyId);
    const second = await initiate(policyId);
    expect(second.preparation!.id).not.toBe(first.preparation!.id);
    const rows = await cancelRows(policyId);
    expect(rows.filter((row) => row.status === "PREPARED" || row.status === "SUBMITTING")).toHaveLength(1);
    await expect(confirm(policyId, first.preparation!.id, signTransaction(first.unsignedTransaction!, keypair))).rejects.toMatchObject({ code: "CANCELLATION_FAILED" });
    expect(client.confirmCount).toBe(0);
  });
});
