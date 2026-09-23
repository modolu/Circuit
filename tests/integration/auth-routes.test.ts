import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestWallet } from "../fixtures/wallet";
import { createTestDb } from "./test-db";

let testDb: Awaited<ReturnType<typeof createTestDb>>;

vi.mock("@/src/db/client", () => ({ getDb: () => testDb.db }));

const { POST: nonceRoute } = await import("@/app/api/auth/nonce/route");
const { POST: verifyRoute } = await import("@/app/api/auth/verify/route");
const { POST: logoutRoute } = await import("@/app/api/auth/logout/route");

const SECRET = "route-test-secret-".padEnd(48, "z");

beforeAll(async () => {
  vi.stubEnv("CIRCUIT_SESSION_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PUBLIC_SOLANA_CLUSTER", "mainnet-beta");
  testDb = await createTestDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

const post = (body: unknown) =>
  new Request("http://localhost:3000/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function requestChallenge(walletAddress: string) {
  const response = await nonceRoute(post({ walletAddress }));
  return { response, body: await response.json() };
}

describe("auth routes", () => {
  it("rejects an invalid Solana address with VALIDATION_ERROR", async () => {
    const { response, body } = await requestChallenge("TEST_WALLET_NOT_REAL");
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.requestId).toMatch(/^req_[0-9a-f]{32}$/);
  });

  it("rejects non-JSON bodies", async () => {
    const response = await nonceRoute(
      new Request("http://localhost:3000/api/auth/nonce", { method: "POST", body: "walletAddress=x" }),
    );
    expect(response.status).toBe(400);
  });

  it("does not authenticate a bad signature, and says nothing specific about why", async () => {
    const wallet = createTestWallet();
    const { body } = await requestChallenge(wallet.address);
    const response = await verifyRoute(
      post({ walletAddress: wallet.address, nonce: body.data.nonce, signature: wallet.sign("some other message") }),
    );
    const result = await response.json();
    expect(response.status).toBe(401);
    expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(result.error.message).toBe("Sign-in could not be verified. Request a new sign-in message and try again.");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("signs in with a valid signature and returns only safe data plus an HttpOnly session cookie", async () => {
    const wallet = createTestWallet();
    const { response: nonceResponse, body } = await requestChallenge(wallet.address);
    expect(nonceResponse.status).toBe(200);
    expect(body.data.message).toContain(wallet.address);
    expect(body.data.message).toContain(`Nonce: ${body.data.nonce}`);
    expect(Object.keys(body.data).sort()).toEqual(["expiresAt", "issuedAt", "message", "nonce"]);

    const response = await verifyRoute(
      post({ walletAddress: wallet.address, nonce: body.data.nonce, signature: wallet.sign(body.data.message) }),
    );
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(result.data).sort()).toEqual(["sessionExpiresAt", "walletAddress"]);
    expect(result.data.walletAddress).toBe(wallet.address);

    const [cookie] = response.headers.getSetCookie();
    expect(cookie).toMatch(/^circuit_session=v1\./);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=28800/);
    expect(cookie).not.toContain(SECRET);

    // Replaying the same signed challenge fails.
    const replay = await verifyRoute(
      post({ walletAddress: wallet.address, nonce: body.data.nonce, signature: wallet.sign(body.data.message) }),
    );
    expect(replay.status).toBe(401);
  });

  it("logout clears the session cookie", async () => {
    const response = await logoutRoute();
    expect(response.status).toBe(200);
    const [cookie] = response.headers.getSetCookie();
    expect(cookie).toMatch(/^circuit_session=;/);
    expect(cookie).toMatch(/Max-Age=0/);
  });
});
