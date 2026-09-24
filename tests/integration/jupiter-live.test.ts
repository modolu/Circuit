import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeJupiterSession, JUPITER_SESSION_COOKIE_NAME } from "@/src/auth/jupiter-session";
import { USDC } from "@/src/config/tokens";
import { upsertAsset } from "@/src/db/repositories/assets";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import { jupiterDepositPreparations, type Wallet } from "@/src/db/schema";
import { JUPITER_VERIFICATION_LEVELS } from "@/src/domain/asset";
import { AppError } from "@/src/domain/errors";
import type * as jupiterClientModule from "@/src/integrations/jupiter/client";
import { JupiterRequestError } from "@/src/integrations/jupiter/client";
import { createPolicyDraft } from "@/src/services/create-policy";
import { getAssetReference } from "@/src/services/get-reference";
import { LIVE_SELL_DISABLED_MESSAGE, prepareJupiterDeposit } from "@/src/services/jupiter/prepare-deposit";
import type { CreatePolicyRequest } from "@/src/validation/policy";
import { fakeCatalogAsset } from "../fixtures/catalog";
import { FakeJupiter, TEST_CHALLENGE, TEST_JWT, TEST_VAULT } from "../fixtures/jupiter-fake";
import { LIFECYCLE_NOW } from "../fixtures/lifecycle";
import { fixturePyth } from "../fixtures/policy";
import { createTestWallet } from "../fixtures/wallet";
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

const JWT = TEST_JWT;
const VAULT = TEST_VAULT;
const CHALLENGE = TEST_CHALLENGE;

const routes = {
  challenge: (await import("@/app/api/jupiter/auth/challenge/route")).POST,
  verify: (await import("@/app/api/jupiter/auth/verify/route")).POST,
  logout: (await import("@/app/api/jupiter/auth/logout/route")).POST,
  status: (await import("@/app/api/jupiter/status/route")).GET,
  register: (await import("@/app/api/jupiter/vault/register/route")).POST,
  deposit: (await import("@/app/api/policies/[policyId]/jupiter/deposit/route")).POST,
  circuitLogout: (await import("@/app/api/auth/logout/route")).POST,
};

function request(path: string, { body, jwtFor }: { body?: unknown; jwtFor?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (jwtFor) headers.cookie = `${JUPITER_SESSION_COOKIE_NAME}=${encodeURIComponent(encodeJupiterSession(jwtFor, JWT))}`;
  return new Request(`http://localhost:3000${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const deposit = (policyId: string, jwtFor?: string) =>
  routes.deposit(request(`/api/policies/${policyId}/jupiter/deposit`, { body: {}, jwtFor }), { params: Promise.resolve({ policyId }) });

const GATE_PASSING = {
  jupiter: {
    checkedAt: "2026-09-23T17:00:00Z",
    docsVersion: "test fixture",
    levels: Object.fromEntries(JUPITER_VERIFICATION_LEVELS.map((level) => [level, { result: "NOT_TESTED", detail: "fixture" }])),
    sides: { BUY: { result: "PASSED", detail: "fixture" }, SELL: { result: "RESTRICTED", detail: "fixture" } },
  },
  referenceBasis: {
    status: "RESOLVED",
    policyReference: "Pyth Equity.US.AAPL/USD",
    executionMonitor: "Jupiter AAPLx/USD",
    triggerMapping: "IDENTITY",
    disclosure: "AAPLx is a secondary-market token and may trade at a premium or discount to underlying AAPL.",
    detail: "fixture only",
  },
  verification: { pythLiveCheck: { status: "PASSED" } },
};

let owner: Wallet;
let readyAssetId: string;
let blockedAssetId: string;

async function draft(assetId: string, overrides: Partial<CreatePolicyRequest> = {}, by: Wallet = owner) {
  const view = await createPolicyDraft(
    testDb.db,
    {
      wallet: by,
      request: {
        assetId,
        side: "BUY",
        triggerDirection: "BELOW",
        expressionType: "ABSOLUTE_PRICE",
        expressionValue: "181",
        amount: "25",
        maxSlippageBps: 50,
        expiryHours: 24,
        ...overrides,
      },
      now: LIFECYCLE_NOW,
    },
    { loadReference: (db, id) => getAssetReference(db, id, { pyth: fixturePyth() }) },
  );
  return view.id;
}

beforeAll(async () => {
  vi.stubEnv("CIRCUIT_JUPITER_MODE", "live");
  vi.stubEnv("JUPITER_API_KEY", "test-key-not-real");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  testDb = await createTestDb();
  owner = await upsertWalletSeen(testDb.db, createTestWallet().address);
  const base = fakeCatalogAsset();
  readyAssetId = (await upsertAsset(testDb.db, fakeCatalogAsset({ metadata: { ...(base.metadata as object), ...GATE_PASSING } }))).id;
  blockedAssetId = (
    await upsertAsset(
      testDb.db,
      fakeCatalogAsset({
        metadata: {
          ...(base.metadata as object),
          ...GATE_PASSING,
          referenceBasis: { ...GATE_PASSING.referenceBasis, status: "UNRESOLVED" },
          verification: { pythLiveCheck: { status: "NOT_ENTITLED" } },
        },
      }),
    )
  ).id;
  // Drafts use the fixture instant with a 24h expiry; the deposit route reads the real clock.
  vi.useFakeTimers({ toFake: ["Date"], now: LIFECYCLE_NOW });
});
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await testDb.close();
});
beforeEach(() => {
  client = new FakeJupiter();
  wallet = owner;
});

describe("Jupiter authentication routes", () => {
  it("require a Circuit session", async () => {
    wallet = null;
    expect((await routes.challenge(request("/api/jupiter/auth/challenge", { body: {} }))).status).toBe(401);
    expect((await routes.status(request("/api/jupiter/status"))).status).toBe(401);
    expect((await routes.register(request("/api/jupiter/vault/register", { body: {} }))).status).toBe(401);
    expect(client.calls).toEqual([]);
  });

  it("issue the challenge for the session wallet only, returned byte for byte", async () => {
    const response = await routes.challenge(request("/api/jupiter/auth/challenge", { body: { walletPubkey: "someone-else" } }));
    const body = await response.json();
    expect(body.data).toEqual({ type: "message", challenge: CHALLENGE, walletAddress: owner.address });
    expect(client.calls).toEqual([`challenge:${owner.address}:message`]);
  });

  it("verify with a base58 signature and keep the JWT only in the HttpOnly cookie", async () => {
    const signature = Buffer.from(new Uint8Array(64).fill(9)).toString("base64");
    const response = await routes.verify(request("/api/jupiter/auth/verify", { body: { signature } }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(JWT);
    expect(JSON.parse(text).data).toEqual({ authenticated: true, walletAddress: owner.address });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${JUPITER_SESSION_COOKIE_NAME}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/circuit_session=/);
    expect(client.calls[0]).toMatch(new RegExp(`^verify:${owner.address}:[1-9A-HJ-NP-Za-km-z]+$`));
  });

  it("reject malformed signatures before calling Jupiter", async () => {
    const response = await routes.verify(request("/api/jupiter/auth/verify", { body: { signature: "abc" } }));
    expect(response.status).toBe(400);
    expect(client.calls).toEqual([]);
  });

  it("report status without the JWT, and never register a vault on a status read", async () => {
    expect((await (await routes.status(request("/api/jupiter/status"))).json()).data).toMatchObject({ authenticated: false, vault: null });
    client.vaultOwner = owner.address;
    const text = await (await routes.status(request("/api/jupiter/status", { jwtFor: owner.address }))).text();
    expect(text).not.toContain(JWT);
    expect(JSON.parse(text).data).toMatchObject({ mode: "live", authenticated: true, vault: { status: "NOT_REGISTERED" } });
    expect(client.calls).not.toContain("register");
  });

  it("ignore a Jupiter cookie bound to a different wallet", async () => {
    const other = createTestWallet().address;
    const body = await (await routes.status(request("/api/jupiter/status", { jwtFor: other }))).json();
    expect(body.data.authenticated).toBe(false);
    expect(client.calls).toEqual([]);
  });

  it("clear the cookie and report expiry when Jupiter returns 401", async () => {
    client.unauthorized = true;
    const response = await routes.status(request("/api/jupiter/status", { jwtFor: owner.address }));
    expect((await response.json()).data).toMatchObject({ authenticated: false, expired: true });
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`${JUPITER_SESSION_COOKIE_NAME}=;.*Max-Age=0`));
    const register = await routes.register(request("/api/jupiter/vault/register", { body: {}, jwtFor: owner.address }));
    expect((await register.json()).error.code).toBe("PROVIDER_AUTH_REQUIRED");
    expect(register.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("register a vault only on request, and treat an existing vault as success", async () => {
    client.vaultOwner = owner.address;
    const noSession = await routes.register(request("/api/jupiter/vault/register", { body: {} }));
    expect((await noSession.json()).error.code).toBe("PROVIDER_AUTH_REQUIRED");
    const first = await (await routes.register(request("/api/jupiter/vault/register", { body: {}, jwtFor: owner.address }))).json();
    expect(first.data).toEqual({ vault: { status: "READY", vaultPubkey: VAULT }, created: true });
    const again = await (await routes.register(request("/api/jupiter/vault/register", { body: {}, jwtFor: owner.address }))).json();
    expect(again.data.created).toBe(false);
    const status = await (await routes.status(request("/api/jupiter/status", { jwtFor: owner.address }))).json();
    expect(status.data.vault).toEqual({ status: "READY", vaultPubkey: VAULT });
  });

  it("Jupiter logout clears only the Jupiter cookie; Circuit logout clears both", async () => {
    const jupiter = (await routes.logout()).headers.get("set-cookie") ?? "";
    expect(jupiter).toContain(`${JUPITER_SESSION_COOKIE_NAME}=;`);
    expect(jupiter).not.toContain("circuit_session=");
    const circuit = (await routes.circuitLogout()).headers.get("set-cookie") ?? "";
    expect(circuit).toContain("circuit_session=;");
    expect(circuit).toContain(`${JUPITER_SESSION_COOKIE_NAME}=;`);
  });
});

describe("Jupiter deposit preparation", () => {
  const preparations = (policyId: string) =>
    testDb.db.select().from(jupiterDepositPreparations).where(eq(jupiterDepositPreparations.policyId, policyId));
  beforeEach(() => {
    client.vaultOwner = owner.address;
    client.vaultRegistered = true;
  });

  it("requires Jupiter auth and policy ownership", async () => {
    const id = await draft(readyAssetId);
    expect((await (await deposit(id)).json()).error.code).toBe("PROVIDER_AUTH_REQUIRED");
    const stranger = await upsertWalletSeen(testDb.db, createTestWallet().address);
    wallet = stranger;
    expect((await deposit(id, stranger.address)).status).toBe(404);
    expect((await deposit("not-a-uuid", stranger.address)).status).toBe(400);
    expect(client.craftCount).toBe(0);
  });

  it("rejects SELL before any craft", async () => {
    const id = await draft(readyAssetId, { side: "SELL", triggerDirection: "ABOVE", expressionValue: "250", amount: "1" });
    const body = await (await deposit(id, owner.address)).json();
    expect(body.error).toMatchObject({ code: "ASSET_DISABLED", message: LIVE_SELL_DISABLED_MESSAGE });
    expect(client.craftCount).toBe(0);
    expect(await preparations(id)).toEqual([]);
  });

  it("stays blocked for production-state assets (Pyth not entitled, calibration required)", async () => {
    const id = await draft(blockedAssetId);
    const body = await (await deposit(id, owner.address)).json();
    expect(body.error.code).toBe("ASSET_DISABLED");
    expect(client.craftCount).toBe(0);
  });

  it("enforces the reference-basis gate even when Pyth has passed", async () => {
    const calibrationOnly = (
      await upsertAsset(
        testDb.db,
        fakeCatalogAsset({
          metadata: {
            ...(fakeCatalogAsset().metadata as object),
            ...GATE_PASSING,
            referenceBasis: { ...GATE_PASSING.referenceBasis, status: "UNRESOLVED" },
          },
        }),
      )
    ).id;
    const id = await draft(calibrationOnly);
    await expect(
      prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "live", now: LIFECYCLE_NOW }, { client }),
    ).rejects.toMatchObject({ code: "ASSET_DISABLED", cause: "REFERENCE_BASIS_UNRESOLVED" });
    expect(client.craftCount).toBe(0);
  });

  it("rejects orders below the 10 USD provider minimum", async () => {
    const id = await draft(readyAssetId, { amount: "9.99" });
    await expect(
      prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "live", now: LIFECYCLE_NOW }, { client }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", cause: "BELOW_PROVIDER_MINIMUM" });
    expect(client.craftCount).toBe(0);
  });

  it("refuses in mock mode", async () => {
    const id = await draft(readyAssetId);
    await expect(
      prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "mock", now: LIFECYCLE_NOW }, { client }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("commits the requestId before returning the unsigned transaction, and reuses it", async () => {
    const id = await draft(readyAssetId);
    const prepared = await prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "live", now: LIFECYCLE_NOW }, { client });
    expect(prepared.reused).toBe(false);
    expect(prepared.unsignedTransaction).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const [row] = await preparations(id);
    expect(row).toMatchObject({ status: "CRAFTED", depositRequestId: expect.stringMatching(/^req-\d+-not-real$/), inputAmountAtomic: 25_000_000n });
    expect(prepared.preparation.depositRequestId).toBe(row!.depositRequestId);
    expect(client.calls).toEqual(["vault:true", "craft:25000000"]);

    const again = await prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "live", now: LIFECYCLE_NOW }, { client });
    expect(again).toMatchObject({ reused: true, preparation: { id: row!.id, depositRequestId: row!.depositRequestId } });
    expect(client.craftCount).toBe(1);
  });

  it("allows at most one active preparation under 5 concurrent requests", async () => {
    const id = await draft(readyAssetId);
    client.craftDelayMs = 50;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "live", now: LIFECYCLE_NOW }, { client }),
      ),
    );
    expect(client.craftCount).toBe(1);
    const rows = await preparations(id);
    expect(rows.filter((row) => row.status === "PREPARING" || row.status === "CRAFTED")).toHaveLength(1);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "POLICY_STATE_CONFLICT", retryable: true });
    }
  });

  it("invalidates the reservation when the craft fails, so a retry can proceed", async () => {
    const id = await draft(readyAssetId);
    client.craftFailure = new JupiterRequestError("bad_request", 400, "Amount too small");
    await expect(
      prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "live", now: LIFECYCLE_NOW }, { client }),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
    expect((await preparations(id)).map((r) => r.status)).toEqual(["INVALIDATED"]);
    client.craftFailure = null;
    await prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "live", now: LIFECYCLE_NOW }, { client });
    expect((await preparations(id)).map((r) => r.status).sort()).toEqual(["CRAFTED", "INVALIDATED"]);
  });

  it("maps a Jupiter 401 during craft to re-authentication and clears the cookie", async () => {
    const id = await draft(readyAssetId);
    client.craftFailure = new JupiterRequestError("unauthorized", 401);
    // The route evaluates expiry against the real clock, so call the service with the fixture time instead.
    await expect(
      prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "live", now: LIFECYCLE_NOW }, { client }),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTH_REQUIRED" });
  });

  it("reclaims a PREPARING reservation abandoned for over a minute", async () => {
    const id = await draft(readyAssetId);
    const stale = new Date(LIFECYCLE_NOW.getTime() - 120_000);
    await testDb.db.insert(jupiterDepositPreparations).values({
      policyId: id,
      walletId: owner.id,
      status: "PREPARING",
      inputMint: USDC.mintAddress,
      outputMint: "x",
      inputAmountAtomic: 1n,
      createdAt: stale,
      updatedAt: stale,
    });
    const prepared = await prepareJupiterDeposit(testDb.db, { wallet: owner, policyId: id, jwt: JWT, mode: "live", now: LIFECYCLE_NOW }, { client });
    expect(prepared.reused).toBe(false);
    expect((await preparations(id)).map((r) => r.status).sort()).toEqual(["CRAFTED", "INVALIDATED"]);
  });

  it("the database refuses a second active preparation for a policy", async () => {
    const id = await draft(readyAssetId);
    const values = { policyId: id, walletId: owner.id, status: "PREPARING" as const, inputMint: "a", outputMint: "b", inputAmountAtomic: 1n };
    await testDb.db.insert(jupiterDepositPreparations).values(values);
    await expect(testDb.db.insert(jupiterDepositPreparations).values(values)).rejects.toThrow();
    await expect(
      testDb.db.insert(jupiterDepositPreparations).values({ ...values, status: "CRAFTED" }),
    ).rejects.toThrow();
  });
});
