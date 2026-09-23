import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import type { Wallet } from "@/src/db/schema";
import type * as jupiterClientModule from "@/src/integrations/jupiter/client";
import type { JupiterClient } from "@/src/integrations/jupiter/client";
import { createTestWallet } from "../fixtures/wallet";
import { createTestDb } from "./test-db";

// Default (mock) mode: live Jupiter routes refuse without calling Jupiter, and there is no fallback.
let testDb: Awaited<ReturnType<typeof createTestDb>>;
let wallet: Wallet;
const calls: string[] = [];
const client = new Proxy({} as JupiterClient, {
  get: (_target, prop) => (prop === "hasApiKey" ? true : () => {
    calls.push(String(prop));
    throw new Error("Jupiter must not be called in mock mode");
  }),
});

vi.mock("@/src/db/client", () => ({ getDb: () => testDb.db }));
vi.mock("@/src/auth/current-wallet", () => ({ requireAuthenticatedWallet: async () => wallet }));
vi.mock("@/src/integrations/jupiter/client", async (importOriginal) => ({
  ...(await importOriginal<typeof jupiterClientModule>()),
  getJupiterClient: () => client,
}));

beforeAll(async () => {
  vi.stubEnv("CIRCUIT_JUPITER_MODE", "mock");
  testDb = await createTestDb();
  wallet = await upsertWalletSeen(testDb.db, createTestWallet().address);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

const post = (path: string, body: unknown = {}) =>
  new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("Jupiter routes in mock mode", () => {
  it("refuse live Jupiter actions and report mock status without calling Jupiter", async () => {
    const challenge = (await import("@/app/api/jupiter/auth/challenge/route")).POST;
    const register = (await import("@/app/api/jupiter/vault/register/route")).POST;
    const status = (await import("@/app/api/jupiter/status/route")).GET;
    const c = await challenge(post("/api/jupiter/auth/challenge"));
    expect(c.status).toBe(503);
    expect((await c.json()).error.code).toBe("PROVIDER_UNAVAILABLE");
    expect((await register(post("/api/jupiter/vault/register"))).status).toBe(503);
    const s = await (await status(new Request("http://localhost:3000/api/jupiter/status"))).json();
    expect(s.data).toEqual({ mode: "mock", authenticated: false, expired: false, vault: null });
    expect(calls).toEqual([]);
  });
});
