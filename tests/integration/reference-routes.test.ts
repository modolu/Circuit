import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertAsset } from "@/src/db/repositories/assets";
import { AppError } from "@/src/domain/errors";
import { fakeCatalogAsset } from "../fixtures/catalog";
import { equityResponseText } from "../fixtures/pyth";
import { createTestDb } from "./test-db";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let signedIn = true;
const KEY = "pyth-key-that-must-never-leak-0123456789";

vi.mock("@/src/db/client", () => ({ getDb: () => testDb.db }));
vi.mock("@/src/auth/session", () => ({
  requireSession: async () => {
    if (!signedIn) throw new AppError("UNAUTHENTICATED", "Sign in with your wallet to continue.");
    return { walletAddress: "TEST_WALLET_NOT_REAL", issuedAt: new Date(), expiresAt: new Date() };
  },
}));

const { GET: assetsRoute } = await import("@/app/api/assets/route");
const { GET: referenceRoute } = await import("@/app/api/reference/[assetId]/route");

const fetchCalls: Array<{ body: string; auth: string | undefined }> = [];

beforeAll(async () => {
  vi.stubEnv("PYTH_API_KEY", KEY);
  vi.stubEnv("PYTH_BASE_URL", "https://pyth.test");
  vi.stubGlobal("fetch", async (_url: URL, init: RequestInit) => {
    fetchCalls.push({ body: String(init.body), auth: (init.headers as Record<string, string>).Authorization });
    // Serve the fixture update as generated "now" so it maps as FRESH.
    const nowUs = BigInt(Date.now()) * 1000n;
    return new Response(equityResponseText({ updateUs: nowUs, feedUpdateUs: nowUs }), { status: 200 });
  });
  testDb = await createTestDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await testDb.close();
});

const reference = (assetId: string, query = "") =>
  referenceRoute(new Request(`http://localhost:3000/api/reference/${assetId}${query}`), {
    params: Promise.resolve({ assetId }),
  });

describe("GET /api/assets", () => {
  it("returns public catalog data without internal metadata", async () => {
    const asset = await upsertAsset(testDb.db, fakeCatalogAsset());
    const body = await (await assetsRoute()).json();
    expect(body.requestId).toMatch(/^req_/);
    const listed = body.data.assets.find((a: { id: string }) => a.id === asset.id);
    expect(listed.reference).toEqual({ provider: "pyth_pro", symbol: "Equity.US.AAPL/USD", configured: true });
    expect(listed.execution.enabled).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/verification|internal note|metadata/);
  });
});

describe("GET /api/reference/[assetId]", () => {
  it("serves the configured feed only and never exposes the Pyth key", async () => {
    const asset = await upsertAsset(testDb.db, fakeCatalogAsset());
    fetchCalls.length = 0;
    const response = await reference(asset.id, "?feedId=1&symbol=Crypto.BTC/USD");
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(fetchCalls[0]!.body).priceFeedIds).toEqual([922]);
    expect(fetchCalls[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/authorization|bearer/i);
    expect(JSON.parse(text).data.reference).toMatchObject({ priceUsd: "227.35", freshness: "FRESH" });
  });

  it("validates the asset id and requires a signed-in session", async () => {
    expect((await reference("not-a-uuid")).status).toBe(400);
    signedIn = false;
    try {
      expect((await reference("00000000-0000-4000-8000-000000000000")).status).toBe(401);
    } finally {
      signedIn = true;
    }
    expect((await reference("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
