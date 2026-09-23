import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertAsset } from "@/src/db/repositories/assets";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import type { Wallet } from "@/src/db/schema";
import { AppError } from "@/src/domain/errors";
import { fakeCatalogAsset } from "../fixtures/catalog";
import { fakeWalletAddress } from "../fixtures/db";
import { equityResponseText } from "../fixtures/pyth";
import { createTestDb } from "./test-db";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let wallet: Wallet | null = null;
let pythStatus = 200;

vi.mock("@/src/db/client", () => ({ getDb: () => testDb.db }));
vi.mock("@/src/auth/current-wallet", () => ({
  requireAuthenticatedWallet: async () => {
    if (!wallet) throw new AppError("UNAUTHENTICATED", "Sign in with your wallet to continue.");
    return wallet;
  },
}));

const { POST } = await import("@/app/api/policies/route");
let assetId: string;

beforeAll(async () => {
  vi.stubEnv("PYTH_API_KEY", "test-key-not-real");
  vi.stubGlobal("fetch", async () => {
    if (pythStatus !== 200) return new Response("Not entitled", { status: pythStatus });
    const nowUs = BigInt(Date.now()) * 1000n;
    return new Response(equityResponseText({ updateUs: nowUs, feedUpdateUs: nowUs }), { status: 200 });
  });
  testDb = await createTestDb();
  assetId = (await upsertAsset(testDb.db, fakeCatalogAsset())).id;
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
