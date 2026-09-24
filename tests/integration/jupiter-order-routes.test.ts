import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeJupiterSession, JUPITER_SESSION_COOKIE_NAME } from "@/src/auth/jupiter-session";
import { USDC } from "@/src/config/tokens";
import { upsertAsset } from "@/src/db/repositories/assets";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import type { Wallet } from "@/src/db/schema";
import { JUPITER_VERIFICATION_LEVELS } from "@/src/domain/asset";
import { AppError } from "@/src/domain/errors";
import type * as jupiterClientModule from "@/src/integrations/jupiter/client";
import { createPolicyDraft } from "@/src/services/create-policy";
import { getAssetReference } from "@/src/services/get-reference";
import { fakeCatalogAsset } from "../fixtures/catalog";
import { FakeJupiter, historyOrder, TEST_JWT } from "../fixtures/jupiter-fake";
import { fixturePyth } from "../fixtures/policy";
import { signTransaction, testKeypair, transactionId } from "../fixtures/transactions";
import { createTestDb } from "./test-db";

// Live mode in its own file: the server env is parsed once per module graph.
let testDb: Awaited<ReturnType<typeof createTestDb>>;
let wallet: Wallet | null = null;
let client: FakeJupiter;

vi.mock("@/src/db/client", () => ({ getDb: () => testDb.db }));
vi.mock("@/src/auth/current-wallet", () => ({
  requireAuthenticatedWallet: async () => {
    if (!wallet) throw new AppError("UNAUTHENTICATED", "Sign in with your wallet to continue.");
    return wallet;
  },
}));
vi.mock("@/src/integrations/jupiter/client", async (importOriginal) => ({
  ...(await importOriginal<typeof jupiterClientModule>()),
  getJupiterClient: () => client,
}));

const keypair = testKeypair(20);
let owner: Wallet;
let assetId: string;
let assetMint: string;

const routes = {
  deposit: (await import("@/app/api/policies/[policyId]/jupiter/deposit/route")).POST,
  arm: (await import("@/app/api/policies/[policyId]/jupiter/arm/route")).POST,
  reconcile: (await import("@/app/api/policies/[policyId]/reconcile/route")).POST,
  cancel: (await import("@/app/api/policies/[policyId]/jupiter/cancel/route")).POST,
  confirm: (await import("@/app/api/policies/[policyId]/jupiter/confirm-cancel/route")).POST,
  genericArm: (await import("@/app/api/policies/[policyId]/arm/route")).POST,
  genericCancel: (await import("@/app/api/policies/[policyId]/cancel/route")).POST,
};
type Route = (request: Request, context: { params: Promise<{ policyId: string }> }) => Promise<Response>;

function call(route: Route, policyId: string, { body, cookie = true, raw }: { body?: unknown; cookie?: boolean; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie && wallet) headers.cookie = `${JUPITER_SESSION_COOKIE_NAME}=${encodeURIComponent(encodeJupiterSession(wallet.address, TEST_JWT))}`;
  const request = new Request(`http://localhost:3000/api/policies/${policyId}`, { method: "POST", headers, body: raw ?? JSON.stringify(body ?? {}) });
  return route(request, { params: Promise.resolve({ policyId }) });
}

beforeAll(async () => {
  vi.stubEnv("CIRCUIT_JUPITER_MODE", "live");
  vi.stubEnv("JUPITER_API_KEY", "test-key-not-real");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  testDb = await createTestDb();
  owner = await upsertWalletSeen(testDb.db, keypair.publicKey.toBase58());
  const base = fakeCatalogAsset().metadata as object;
  const asset = await upsertAsset(
    testDb.db,
    fakeCatalogAsset({
      mintAddress: testKeypair(41).publicKey.toBase58(),
      metadata: {
        ...base,
        jupiter: {
          checkedAt: "2026-09-23T17:00:00Z",
          docsVersion: "fixture",
          levels: Object.fromEntries(JUPITER_VERIFICATION_LEVELS.map((level) => [level, { result: "NOT_TESTED", detail: "fixture" }])),
          sides: { BUY: { result: "PASSED", detail: "fixture" }, SELL: { result: "RESTRICTED", detail: "fixture" } },
        },
        referenceBasis: {
          status: "RESOLVED",
          policyReference: "Pyth Equity.US.AAPL/USD",
          executionMonitor: "Jupiter AAPLx/USD",
          triggerMapping: "IDENTITY",
          disclosure: "fixture",
          detail: "fixture",
        },
        verification: { pythLiveCheck: { status: "PASSED" } },
      },
    }),
  );
  assetId = asset.id;
  assetMint = asset.mintAddress;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});
beforeEach(() => {
  client = new FakeJupiter();
  client.vaultOwner = owner.address;
  client.vaultRegistered = true;
  wallet = owner;
});

async function draft(): Promise<string> {
  // Drafts are created "now" so the route's real clock sees them as unexpired.
  const view = await createPolicyDraft(
    testDb.db,
    {
      wallet: owner,
      request: { assetId, side: "BUY", triggerDirection: "BELOW", expressionType: "ABSOLUTE_PRICE", expressionValue: "194", amount: "25", maxSlippageBps: 50, expiryHours: 24 },
    },
    { loadReference: (db, id) => getAssetReference(db, id, { pyth: fixturePyth() }) },
  );
  return view.id;
}

describe("live order routes", () => {
  it("run prepare → arm → reconcile → cancel → confirm without ever echoing signed transactions or the JWT", async () => {
    const id = await draft();
    const prepared = await (await call(routes.deposit, id)).json();
    expect(prepared.data.unsignedTransaction).toBeTypeOf("string");
    const signed = signTransaction(prepared.data.unsignedTransaction, keypair);

    const armResponse = await call(routes.arm, id, { body: { preparationId: prepared.data.preparation.id, signedTransaction: signed } });
    const armText = await armResponse.text();
    expect(armResponse.status).toBe(200);
    expect(armText).not.toContain(signed);
    expect(armText).not.toContain(TEST_JWT);
    const armed = JSON.parse(armText);
    expect(armed.data).toMatchObject({ outcome: "ARMED", depositTxSignature: transactionId(signed), policy: { status: "ARMED", simulated: false } });

    client.orders.push(
      historyOrder({ id: armed.data.policy.providerOrderId, userPubkey: owner.address, inputMint: USDC.mintAddress, outputMint: assetMint, amount: "25000000", depositTxSignature: transactionId(signed) }),
    );
    const reconciled = await (await call(routes.reconcile, id)).json();
    expect(reconciled.data).toMatchObject({ providerState: "OPEN", policy: { status: "ARMED" } });

    const started = await (await call(routes.cancel, id)).json();
    expect(started.data).toMatchObject({ outcome: "WITHDRAWAL_READY", policy: { status: "ARMED", providerState: "PENDING_WITHDRAW" } });
    const withdrawal = signTransaction(started.data.unsignedTransaction, keypair);
    const confirmText = await (await call(routes.confirm, id, { body: { preparationId: started.data.preparation.id, signedTransaction: withdrawal } })).text();
    expect(confirmText).not.toContain(withdrawal);
    expect(JSON.parse(confirmText).data.policy.status).toBe("CANCELLED");
  });

  it("require a Circuit session, a JSON body and a valid preparation id", async () => {
    const id = await draft();
    wallet = null;
    expect((await call(routes.arm, id, { body: { preparationId: crypto.randomUUID(), signedTransaction: "AAAA" } })).status).toBe(401);
    wallet = owner;
    expect((await call(routes.arm, id, { raw: "not json" })).status).toBe(400);
    expect((await call(routes.arm, id, { body: { preparationId: "nope" } })).status).toBe(400);
    expect((await call(routes.arm, "not-a-uuid", { body: { preparationId: crypto.randomUUID() } })).status).toBe(400);
    expect(client.created).toHaveLength(0);
  });

  it("clear the Jupiter cookie when Jupiter auth is missing or expired", async () => {
    const id = await draft();
    const noCookie = await call(routes.deposit, id, { cookie: false });
    expect((await noCookie.json()).error.code).toBe("PROVIDER_AUTH_REQUIRED");
    expect(noCookie.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    client.unauthorized = true;
    const expired = await call(routes.deposit, id);
    expect((await expired.json()).error.code).toBe("PROVIDER_AUTH_REQUIRED");
    expect(expired.headers.get("set-cookie")).toMatch(new RegExp(`${JUPITER_SESSION_COOKIE_NAME}=;`));
  });

  it("route live policies away from the simulated-provider actions", async () => {
    const id = await draft();
    expect((await (await call(routes.genericArm, id)).json()).error.code).toBe("PROVIDER_UNAVAILABLE");
    expect((await (await call(routes.genericCancel, id)).json()).error.code).toBe("POLICY_STATE_CONFLICT");
  });
});
