import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PRESTOCKS_ASSETS } from "@/src/config/assets";
import { USDC } from "@/src/config/tokens";
import { assetRowFromConfig } from "@/src/db/asset-rows";
import { upsertAsset } from "@/src/db/repositories/assets";
import { listPolicyEvents } from "@/src/db/repositories/policies";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import { assets, policies, type Wallet } from "@/src/db/schema";
import { createPrestocksClient, PrestocksRequestError, type PrestocksClient } from "@/src/integrations/prestocks/client";
import type { PythClient } from "@/src/integrations/pyth/client";
import { createPolicyDraft } from "@/src/services/create-policy";
import { getAssetReference, type ReferenceClients } from "@/src/services/get-reference";
import { armLivePolicy } from "@/src/services/jupiter/arm-live";
import { LIVE_SELL_DISABLED_MESSAGE } from "@/src/services/jupiter/live-gates";
import { prepareJupiterDeposit } from "@/src/services/jupiter/prepare-deposit";
import { getPolicyViewForWallet } from "@/src/services/policy-view";
import { listPrestocksMarkets } from "@/src/services/prestocks-markets";
import type { CreatePolicyRequest } from "@/src/validation/policy";
import { fakeCatalogAsset } from "../fixtures/catalog";
import { FakeJupiter, TEST_JWT } from "../fixtures/jupiter-fake";
import { fixturePyth } from "../fixtures/policy";
import { ANTHROPIC_MINT, prestocksResponseText, SPACEX_MINT } from "../fixtures/references";
import { signTransaction, testKeypair } from "../fixtures/transactions";
import { createTestDb } from "./test-db";

/* PreStocks as a second reference provider: routing, drafts, markets and the live Jupiter mapping. */

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const keypair = testKeypair(30);
let owner: Wallet;
let pythAssetId: string;
let anthropicId: string;
const NOW = new Date("2026-09-24T06:40:00.500Z");
const anthropic = PRESTOCKS_ASSETS[0]!;

function fakePrestocks(body: string | Error = prestocksResponseText()) {
  let calls = 0;
  const inner = typeof body === "string" ? createPrestocksClient({ fetchImpl: (async () => new Response(body)) as unknown as typeof fetch, now: () => new Date("2026-09-24T06:40:00.000Z") }) : null;
  const client: PrestocksClient = {
    async fetchCatalog() {
      calls += 1;
      if (body instanceof Error) throw body;
      return inner!.fetchCatalog();
    },
  };
  return { client, calls: () => calls };
}

function countingPyth() {
  let calls = 0;
  const inner = fixturePyth();
  const client: PythClient = {
    async latestPrice(request) {
      calls += 1;
      return inner.latestPrice(request);
    },
  };
  return { client, calls: () => calls };
}

beforeAll(async () => {
  testDb = await createTestDb();
  owner = await upsertWalletSeen(testDb.db, keypair.publicKey.toBase58());
  pythAssetId = (await upsertAsset(testDb.db, fakeCatalogAsset())).id;
  anthropicId = (await upsertAsset(testDb.db, assetRowFromConfig(anthropic))).id;
});
afterAll(async () => {
  await testDb.close();
});

async function draft(overrides: Partial<CreatePolicyRequest> = {}, clients: ReferenceClients = { prestocks: fakePrestocks().client }) {
  return createPolicyDraft(
    testDb.db,
    {
      wallet: owner,
      request: {
        assetId: anthropicId,
        side: "BUY",
        triggerDirection: "BELOW",
        expressionType: "RELATIVE_PERCENT",
        expressionValue: "3",
        amount: "25",
        maxSlippageBps: 50,
        expiryHours: 24,
        ...overrides,
      },
      now: NOW,
    },
    { loadReference: (db, id) => getAssetReference(db, id, clients) },
  );
}

describe("reference provider routing", () => {
  it("a Pyth asset calls Pyth only; a PreStocks asset calls PreStocks only", async () => {
    const pyth = countingPyth();
    const prestocks = fakePrestocks();
    const a = await getAssetReference(testDb.db, pythAssetId, { pyth: pyth.client, prestocks: prestocks.client });
    expect(a.reference.provider).toBe("PYTH");
    expect([pyth.calls(), prestocks.calls()]).toEqual([1, 0]);
    const b = await getAssetReference(testDb.db, anthropicId, { pyth: pyth.client, prestocks: prestocks.client });
    expect(b.reference).toMatchObject({ provider: "PRESTOCKS", priceUsd: "1000", freshness: "CURRENT_RESPONSE", timestampKind: "RECEIVED", sourceTimestamp: null });
    expect([pyth.calls(), prestocks.calls()]).toEqual([1, 1]);
    expect(b.asset.reference).toMatchObject({ provider: "PRESTOCKS", label: "PreStocks mark", configured: true });
  });

  it("never falls back between providers and fails safely when PreStocks is down", async () => {
    await expect(getAssetReference(testDb.db, anthropicId, { pyth: countingPyth().client })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await expect(getAssetReference(testDb.db, anthropicId, { prestocks: fakePrestocks(new PrestocksRequestError("timeout")).client })).rejects.toMatchObject({
      code: "REFERENCE_UNAVAILABLE",
      cause: "prestocks_timeout",
    });
  });

  it("uses only the EXACT curated mint: a same-symbol product with another contract is refused", async () => {
    const swapped = prestocksResponseText().replace(ANTHROPIC_MINT, "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB");
    await expect(getAssetReference(testDb.db, anthropicId, { prestocks: fakePrestocks(swapped).client })).rejects.toMatchObject({
      code: "REFERENCE_UNAVAILABLE",
      cause: "prestocks_product_absent",
    });
  });

  it("stores no fake Pyth feed id for a PreStocks asset", async () => {
    const [row] = await testDb.db.select().from(assets).where(eq(assets.id, anthropicId));
    expect(row).toMatchObject({ referenceProvider: "PRESTOCKS", pythFeedId: null, mintAddress: ANTHROPIC_MINT });
    await expect(upsertAsset(testDb.db, { ...assetRowFromConfig(anthropic), mintAddress: testKeypair(31).publicKey.toBase58(), pythFeedId: "922" })).rejects.toThrow();
  });
});

describe("PreStocks policy drafts", () => {
  it("compile 3% below the captured mark (1000 → 970.00) and persist an auditable PreStocks snapshot", async () => {
    const view = await draft();
    expect(view.compiledTriggerUsd).toBe("970.00");
    expect(view.summary).toBe(
      "Buy up to 25 USDC of ANTHROPIC if the USD price falls to or below $970.00 before expiry. Compiled from 3% below the captured PreStocks mark of $1,000.00.",
    );
    const [row] = await testDb.db.select().from(policies).where(eq(policies.id, view.id));
    expect(row).toMatchObject({ referenceProvider: "PRESTOCKS", referenceUsd: "1000", inputMint: USDC.mintAddress, outputMint: ANTHROPIC_MINT });
    expect(row!.referenceTimestamp.toISOString()).toBe("2026-09-24T06:40:00.000Z");
    expect(row!.referenceSnapshotJson).toEqual({
      provider: "PRESTOCKS",
      referenceType: "MARK_PRICE",
      priceUsd: "1000",
      freshness: "CURRENT_RESPONSE",
      timestampKind: "RECEIVED",
      sourceTimestamp: null,
      receivedTimestamp: "2026-09-24T06:40:00.000Z",
      prestocks: {
        name: "Anthropic PreStocks",
        symbol: "ANTHROPIC",
        contractAddress: ANTHROPIC_MINT,
        markPriceUsd: "1000",
        tokenPriceUsd: "1020",
        premiumPercent: "2.00",
        productUrl: "https://www.prestocks.com/anthropic",
        apiUrl: "https://prestocks.com/api/prestocks",
      },
    });
    const events = await listPolicyEvents(testDb.db, view.id);
    const captured = events.find((e) => e.eventType === "REFERENCE_CAPTURED")!;
    expect(captured.source).toBe("CIRCUIT");
    expect(captured.payload).toMatchObject({ provider: "PRESTOCKS", markPriceUsd: "1000", contractAddress: ANTHROPIC_MINT });
    expect(JSON.stringify(events.map((e) => [e.eventType, e.payload]))).not.toMatch(/pyth/i);
  });

  it("compile 2% above → 1020.00, and still compile when the token price is missing", async () => {
    expect((await draft({ triggerDirection: "ABOVE", expressionValue: "2" })).compiledTriggerUsd).toBe("1020.00");
    const noToken = await draft({}, { prestocks: fakePrestocks(prestocksResponseText({ anthropicToken: null })).client });
    expect(noToken.reference).toMatchObject({ provider: "PRESTOCKS", tokenPriceUsd: null, premiumPercent: null });
  });

  it("create no policy when PreStocks is unavailable, while old policies stay explainable from their snapshot", async () => {
    const existing = await draft();
    const before = (await testDb.db.select().from(policies)).length;
    await expect(draft({}, { prestocks: fakePrestocks(new PrestocksRequestError("http_error", 503)).client })).rejects.toMatchObject({ code: "REFERENCE_UNAVAILABLE" });
    expect((await testDb.db.select().from(policies)).length).toBe(before);
    const view = await getPolicyViewForWallet(testDb.db, { walletId: owner.id, policyId: existing.id });
    expect(view!.policy.reference).toMatchObject({ provider: "PRESTOCKS", name: "PreStocks mark", priceUsd: "1000", tokenPriceUsd: "1020", timestampKind: "RECEIVED" });
  });
});

describe("markets: catalog vs curated execution assets", () => {
  it("only the curated, seeded mint is SUPPORTED; SpaceX is not eligible; unknown products stay unverified and are never inserted", async () => {
    const extra = `,{"name":"Newco PreStocks","symbol":"NEWCO","external_url":"https://www.prestocks.com/newco","contract_address":"${testKeypair(32).publicKey.toBase58()}","markPrice":10,"tokenPrice":11}`;
    const assetCount = (await testDb.db.select().from(assets)).length;
    const markets = await listPrestocksMarkets(testDb.db, { prestocks: fakePrestocks(prestocksResponseText({ extra })).client });
    if (markets.status !== "available") throw new Error("expected markets");
    const bySymbol = Object.fromEntries(markets.rows.map((row) => [row.symbol, row]));
    expect(bySymbol.ANTHROPIC).toMatchObject({ support: { state: "SUPPORTED" }, assetId: anthropicId, premiumPercent: "2.00" });
    expect(bySymbol.ANDURIL!.support.state).toBe("ROUTE_VERIFIED");
    expect(bySymbol.SPACEX).toMatchObject({ contractAddress: SPACEX_MINT, support: { state: "NOT_ELIGIBLE" }, assetId: null });
    expect(bySymbol.NEWCO).toMatchObject({ support: { state: "UNVERIFIED" }, assetId: null });
    expect((await testDb.db.select().from(assets)).length).toBe(assetCount);
  });

  it("show an unavailable state instead of stale data when PreStocks is down", async () => {
    expect(await listPrestocksMarkets(testDb.db, { prestocks: fakePrestocks(new PrestocksRequestError("timeout")).client })).toEqual({ status: "unavailable", reason: "timeout" });
  });
});

describe("live Jupiter mapping for the PreStocks asset (fixtures, no funds)", () => {
  let client: FakeJupiter;
  beforeEach(() => {
    client = new FakeJupiter();
    client.vaultOwner = owner.address;
    client.vaultRegistered = true;
  });

  it.each([
    ["BELOW", "3", "below", 970],
    ["ABOVE", "2", "above", 1020],
  ] as const)("BUY %s: USDC → ANTHROPIC, triggerMint ANTHROPIC, mark-relative target sent unchanged", async (direction, pct, condition, trigger) => {
    const view = await draft({ triggerDirection: direction, expressionValue: pct });
    const prepared = await prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: view.id, jwt: TEST_JWT, mode: "live", now: NOW }, { client });
    const signed = signTransaction(prepared.unsignedTransaction, keypair);
    const armed = await armLivePolicy(testDb.db, { wallet: owner, policyId: view.id, preparationId: prepared.preparation.id, signedTransaction: signed, jwt: TEST_JWT, mode: "live", now: NOW }, { client });
    expect(armed.policy.status).toBe("ARMED");
    expect(client.created[0]).toMatchObject({
      inputMint: USDC.mintAddress,
      outputMint: ANTHROPIC_MINT,
      triggerMint: ANTHROPIC_MINT,
      triggerCondition: condition,
      triggerPriceUsd: trigger,
      inputAmount: "25000000",
    });
  });

  it("rejects SELL before any craft and enforces the 10 USD minimum", async () => {
    const sell = await draft({ side: "SELL", triggerDirection: "ABOVE", expressionType: "ABSOLUTE_PRICE", expressionValue: "1100", amount: "0.02" });
    await expect(prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: sell.id, jwt: TEST_JWT, mode: "live", now: NOW }, { client })).rejects.toMatchObject({
      message: LIVE_SELL_DISABLED_MESSAGE,
    });
    const small = await draft({ amount: "9.99" });
    await expect(prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: small.id, jwt: TEST_JWT, mode: "live", now: NOW }, { client })).rejects.toMatchObject({
      cause: "BELOW_PROVIDER_MINIMUM",
    });
    expect(client.craftCount).toBe(0);
  });
});
