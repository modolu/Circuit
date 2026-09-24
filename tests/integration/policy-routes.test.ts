import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertAsset } from "@/src/db/repositories/assets";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import type { Wallet } from "@/src/db/schema";
import { AppError } from "@/src/domain/errors";
import { PRESTOCKS_ASSETS, VERIFIED_ASSETS } from "@/src/config/assets";
import { assetRowFromConfig } from "@/src/db/asset-rows";
import { fakeCatalogAsset } from "../fixtures/catalog";
import { prestocksResponseText } from "../fixtures/references";
import { fakeWalletAddress } from "../fixtures/db";
import { equityResponseText } from "../fixtures/pyth";
import { createTestDb } from "./test-db";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let wallet: Wallet | null = null;
let pythStatus = 200;
/** FRESH: new price now. STALE: generated 10 s ago. CARRIED: the feed last updated before the snapshot. */
let pythShape: "FRESH" | "STALE" | "CARRIED" = "FRESH";

vi.mock("@/src/db/client", () => ({ getDb: () => testDb.db }));
vi.mock("@/src/auth/current-wallet", () => ({
  requireAuthenticatedWallet: async () => {
    if (!wallet) throw new AppError("UNAUTHENTICATED", "Sign in with your wallet to continue.");
    return wallet;
  },
}));

const { POST } = await import("@/app/api/policies/route");
let assetId: string;
let prestocksAssetId: string;
let aaplxAssetId: string;

beforeAll(async () => {
  vi.stubEnv("PYTH_API_KEY", "test-key-not-real");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input).includes("prestocks.com")) return new Response(prestocksResponseText(), { status: 200 });
    if (pythStatus !== 200) return new Response("Not entitled", { status: pythStatus });
    const nowUs = BigInt(Date.now()) * 1000n;
    const updateUs = pythShape === "STALE" ? nowUs - 10_000_000n : nowUs;
    const feedUpdateUs = pythShape === "CARRIED" ? nowUs - 60_000_000n : updateUs;
    return new Response(equityResponseText({ updateUs, feedUpdateUs }), { status: 200 });
  });
  testDb = await createTestDb();
  assetId = (await upsertAsset(testDb.db, fakeCatalogAsset())).id;
  prestocksAssetId = (await upsertAsset(testDb.db, assetRowFromConfig(PRESTOCKS_ASSETS[0]!))).id;
  const aaplx = VERIFIED_ASSETS.find((asset) => asset.symbol === "AAPLx");
  if (!aaplx) throw new Error("AAPLx missing from the curated config");
  aaplxAssetId = (await upsertAsset(testDb.db, assetRowFromConfig(aaplx))).id;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await testDb.close();
});

const post = (body: unknown) =>
  POST(new Request("http://localhost:3000/api/policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const valid = () => ({
  assetId,
  side: "BUY",
  triggerDirection: "BELOW",
  expressionType: "ABSOLUTE_PRICE",
  expressionValue: "181",
  amount: "100",
  maxSlippageBps: 50,
  expiryHours: 24,
});

describe("POST /api/policies", () => {
  it("requires a signed-in wallet", async () => {
    wallet = null;
    const response = await post(valid());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects client-supplied mints, feeds or reference prices and unsupported options", async () => {
    wallet = await upsertWalletSeen(testDb.db, fakeWalletAddress());
    for (const extra of [{ mint: "x" }, { feedId: 1 }, { referencePrice: "1" }]) {
      expect((await post({ ...valid(), ...extra })).status).toBe(400);
    }
    expect((await post({ ...valid(), maxSlippageBps: 75 })).status).toBe(400);
    expect((await post({ ...valid(), expiryHours: 12 })).status).toBe(400);
    expect((await post({ ...valid(), assetId: "not-a-uuid" })).status).toBe(400);
  });

  it("creates a draft for the signed-in wallet", async () => {
    wallet = await upsertWalletSeen(testDb.db, fakeWalletAddress());
    const response = await post(valid());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data.policy).toMatchObject({ status: "DRAFT", compiledTriggerUsd: "181.00", amount: { atomic: "100000000" } });
  });

  it("maps a Pyth entitlement failure to REFERENCE_UNAVAILABLE", async () => {
    pythStatus = 403;
    try {
      const response = await post(valid());
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("REFERENCE_UNAVAILABLE");
    } finally {
      pythStatus = 200;
    }
  });
});

describe("POST /api/policies (PreStocks asset)", () => {
  it("creates a DRAFT from the live PreStocks mark through the real route wiring", async () => {
    wallet = await upsertWalletSeen(testDb.db, fakeWalletAddress());
    const response = await POST(
      new Request("http://localhost:3000/api/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: prestocksAssetId, side: "BUY", triggerDirection: "BELOW", expressionType: "RELATIVE_PERCENT", expressionValue: "3", amount: "12", maxSlippageBps: 50, expiryHours: 24 }),
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data.policy).toMatchObject({ status: "DRAFT", compiledTriggerUsd: "970.00", reference: { provider: "PRESTOCKS", name: "PreStocks mark", priceUsd: "1000" } });
  });
});

describe("POST /api/policies (AAPLx, curated Pyth asset)", () => {
  const aaplxBody = (expressionType: "RELATIVE_PERCENT" | "ABSOLUTE_PRICE", expressionValue: string) => ({
    assetId: aaplxAssetId,
    side: "BUY",
    triggerDirection: "BELOW",
    expressionType,
    expressionValue,
    amount: "12",
    maxSlippageBps: 50,
    expiryHours: 24,
  });
  const withShape = async <T>(shape: typeof pythShape, run: () => Promise<T>) => {
    pythShape = shape;
    try {
      return await run();
    } finally {
      pythShape = "FRESH";
    }
  };

  it("compiles a relative trigger from a FRESH Pyth AAPL reference into a DRAFT", async () => {
    wallet = await upsertWalletSeen(testDb.db, fakeWalletAddress());
    const response = await post(aaplxBody("RELATIVE_PERCENT", "3"));
    const body = await response.json();
    expect(response.status).toBe(201);
    // 227.35 × 0.97 = 220.5295 → BELOW rounds down to cents.
    expect(body.data.policy).toMatchObject({ status: "DRAFT", compiledTriggerUsd: "220.52", reference: { provider: "PYTH", priceUsd: "227.35" } });
  });

  it("keeps the freshness rules: CARRIED blocks relative only, STALE blocks both", async () => {
    wallet = await upsertWalletSeen(testDb.db, fakeWalletAddress());
    await withShape("CARRIED", async () => {
      expect((await (await post(aaplxBody("RELATIVE_PERCENT", "3"))).json()).error.code).toBe("REFERENCE_STALE");
      expect((await post(aaplxBody("ABSOLUTE_PRICE", "220"))).status).toBe(201);
    });
    await withShape("STALE", async () => {
      expect((await (await post(aaplxBody("RELATIVE_PERCENT", "3"))).json()).error.code).toBe("REFERENCE_STALE");
      expect((await (await post(aaplxBody("ABSOLUTE_PRICE", "220"))).json()).error.code).toBe("REFERENCE_STALE");
    });
  });
});
