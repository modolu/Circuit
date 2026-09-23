import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Wallet } from "@/src/db/schema";
import { lifecycleWorld } from "../fixtures/lifecycle";
import { createTestDb } from "./test-db";

// Separate file: the server env is parsed once per module graph, so live mode needs its own.
let testDb: Awaited<ReturnType<typeof createTestDb>>;
let wallet: Wallet;
vi.mock("@/src/db/client", () => ({ getDb: () => testDb.db }));
vi.mock("@/src/auth/current-wallet", () => ({ requireAuthenticatedWallet: async () => wallet }));

let world: Awaited<ReturnType<typeof lifecycleWorld>>;
beforeAll(async () => {
  vi.stubEnv("CIRCUIT_JUPITER_MODE", "live");
  vi.stubEnv("JUPITER_API_KEY", "test-key-not-real");
  testDb = await createTestDb();
  world = await lifecycleWorld(testDb.db);
  wallet = world.wallet;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

const arm = (await import("@/app/api/policies/[policyId]/arm/route")).POST;
const simulateFill = (await import("@/app/api/policies/[policyId]/mock/simulate-fill/route")).POST;
type PolicyRoute = (request: Request, context: { params: Promise<{ policyId: string }> }) => Promise<Response>;
const call = (route: PolicyRoute, policyId: string) =>
  route(new Request(`http://localhost:3000/api/policies/${policyId}`, { method: "POST" }), { params: Promise.resolve({ policyId }) });

describe("live mode before the Jupiter adapter exists", () => {
  it("refuses to arm, never falls back to the mock, and hides mock-only routes", async () => {
    const id = await world.draft();
    const response = await call(arm, id);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("PROVIDER_UNAVAILABLE");
    expect((await call(simulateFill, id)).status).toBe(404);
  });
});
