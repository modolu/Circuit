import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertWalletSeen } from "@/src/db/repositories/wallets";
import type { Wallet } from "@/src/db/schema";
import { AppError } from "@/src/domain/errors";
import { fakeWalletAddress } from "../fixtures/db";
import { lifecycleWorld } from "../fixtures/lifecycle";
import { createTestDb } from "./test-db";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let wallet: Wallet | null = null;

vi.mock("@/src/db/client", () => ({ getDb: () => testDb.db }));
vi.mock("@/src/auth/current-wallet", () => ({
  requireAuthenticatedWallet: async () => {
    if (!wallet) throw new AppError("UNAUTHENTICATED", "Sign in with your wallet to continue.");
    return wallet;
  },
}));

const arm = (await import("@/app/api/policies/[policyId]/arm/route")).POST;
const reconcile = (await import("@/app/api/policies/[policyId]/reconcile/route")).POST;
const simulateFill = (await import("@/app/api/policies/[policyId]/mock/simulate-fill/route")).POST;
type PolicyRoute = (request: Request, context: { params: Promise<{ policyId: string }> }) => Promise<Response>;
const call = (route: PolicyRoute, policyId: string) =>
  route(new Request(`http://localhost:3000/api/policies/${policyId}`, { method: "POST" }), { params: Promise.resolve({ policyId }) });

let world: Awaited<ReturnType<typeof lifecycleWorld>>;
beforeAll(async () => {
  testDb = await createTestDb();
  world = await lifecycleWorld(testDb.db);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

describe("policy lifecycle routes", () => {
  it("require a session and hide other wallets' policies", async () => {
    const id = await world.draft();
    wallet = null;
    expect((await call(arm, id)).status).toBe(401);
    wallet = await upsertWalletSeen(testDb.db, fakeWalletAddress());
    expect((await call(arm, id)).status).toBe(404);
    expect((await call(arm, "not-a-uuid")).status).toBe(400);
  });

  it("run the simulated lifecycle end to end in mock mode", async () => {
    vi.stubEnv("CIRCUIT_JUPITER_MODE", "mock");
    wallet = world.wallet;
    const id = await world.draft();
    const armed = await (await call(arm, id)).json();
    expect(armed.data.policy).toMatchObject({ status: "ARMED", simulated: true, provider: "jupiter_trigger_v2_mock" });
    expect(armed.data.policy.providerOrderId).toMatch(/^mock_/);

    const filled = await (await call(simulateFill, id)).json();
    expect(filled.data).toMatchObject({ simulated: true, providerState: "FILLED" });
    const reconciled = await (await call(reconcile, id)).json();
    expect(reconciled.data).toMatchObject({ changed: true, policy: { status: "EXECUTED" } });
    expect(JSON.stringify(reconciled)).not.toMatch(/solscan/i);
  });
});
