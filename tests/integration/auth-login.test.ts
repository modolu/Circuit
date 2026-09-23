import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeLogin, hashNonce, issueLoginChallenge, type LoginConfig } from "@/src/auth/login";
import { consumeAuthNonce, findAuthNonceByHash } from "@/src/db/repositories/auth-nonces";
import { wallets } from "@/src/db/schema";
import { AppError } from "@/src/domain/errors";
import { createTestWallet } from "../fixtures/wallet";
import { createTestDb } from "./test-db";

const config: LoginConfig = { appOrigin: "http://localhost:3000", cluster: "mainnet-beta" };
let testDb: Awaited<ReturnType<typeof createTestDb>>;
const db = () => testDb.db;

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.close();
});

async function failureReason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("UNAUTHENTICATED");
    return String((error as AppError).cause);
  }
  throw new Error("expected login to fail");
}

async function signedChallenge(wallet = createTestWallet(), now = new Date()) {
  const challenge = await issueLoginChallenge(db(), { walletAddress: wallet.address, config, now });
  return { wallet, challenge, signatureBase64: wallet.sign(challenge.message) };
}

describe("login challenges", () => {
  it("stores only a hash of the nonce, bound to the wallet", async () => {
    const { wallet, challenge } = await signedChallenge();
    const row = await findAuthNonceByHash(db(), hashNonce(challenge.nonce));
    expect(row?.walletAddress).toBe(wallet.address);
    expect(row?.nonceHash).not.toBe(challenge.nonce);
    expect(JSON.stringify(row)).not.toContain(challenge.nonce);
    expect(row!.expiresAt.getTime() - row!.issuedAt.getTime()).toBe(5 * 60 * 1000);
  });

  it("creates the wallet on first login, then updates last_seen_at without duplicating it", async () => {
    const wallet = createTestWallet();
    const first = await signedChallenge(wallet, new Date("2026-09-23T10:00:00Z"));
    const created = await completeLogin(db(), {
      walletAddress: wallet.address,
      nonce: first.challenge.nonce,
      signatureBase64: first.signatureBase64,
      now: new Date("2026-09-23T10:01:00Z"),
    });

    const second = await signedChallenge(wallet, new Date("2026-09-23T11:00:00Z"));
    const updated = await completeLogin(db(), {
      walletAddress: wallet.address,
      nonce: second.challenge.nonce,
      signatureBase64: second.signatureBase64,
      now: new Date("2026-09-23T11:01:00Z"),
    });

    expect(updated.id).toBe(created.id);
    expect(updated.lastSeenAt.toISOString()).toBe("2026-09-23T11:01:00.000Z");
    const rows = (await db().select().from(wallets)).filter((row) => row.address === wallet.address);
    expect(rows).toHaveLength(1);
  });

  it("consumes a nonce exactly once: replay fails", async () => {
    const { wallet, challenge, signatureBase64 } = await signedChallenge();
    const attempt = () => completeLogin(db(), { walletAddress: wallet.address, nonce: challenge.nonce, signatureBase64 });
    await attempt();
    expect(await failureReason(attempt())).toBe("challenge_consumed");
  });

  it("lets only one of two simultaneous verifications succeed", async () => {
    const { wallet, challenge, signatureBase64 } = await signedChallenge();
    const attempt = () => completeLogin(db(), { walletAddress: wallet.address, nonce: challenge.nonce, signatureBase64 });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("makes the consume step itself atomic (second conditional update finds nothing)", async () => {
    const { wallet, challenge } = await signedChallenge();
    const args = { nonceHash: hashNonce(challenge.nonce), walletAddress: wallet.address, now: new Date() };
    expect(await consumeAuthNonce(db(), args)).toBeDefined();
    expect(await consumeAuthNonce(db(), args)).toBeUndefined();
  });

  it("rejects an expired challenge", async () => {
    const issued = new Date("2026-09-23T09:00:00Z");
    const { wallet, challenge, signatureBase64 } = await signedChallenge(createTestWallet(), issued);
    const reason = await failureReason(
      completeLogin(db(), {
        walletAddress: wallet.address,
        nonce: challenge.nonce,
        signatureBase64,
        now: new Date(issued.getTime() + 5 * 60 * 1000),
      }),
    );
    expect(reason).toBe("challenge_expired");
  });

  it("never lets a challenge for wallet A authenticate wallet B", async () => {
    const { challenge } = await signedChallenge();
    const walletB = createTestWallet();
    const reason = await failureReason(
      completeLogin(db(), {
        walletAddress: walletB.address,
        nonce: challenge.nonce,
        signatureBase64: walletB.sign(challenge.message),
      }),
    );
    expect(reason).toBe("wallet_mismatch");
  });

  it("does not consume the nonce when the signature is bad", async () => {
    const { wallet, challenge, signatureBase64 } = await signedChallenge();
    const reason = await failureReason(
      completeLogin(db(), {
        walletAddress: wallet.address,
        nonce: challenge.nonce,
        signatureBase64: wallet.sign(`${challenge.message}\ntampered`),
      }),
    );
    expect(reason).toBe("bad_signature");
    const wallet2 = await completeLogin(db(), { walletAddress: wallet.address, nonce: challenge.nonce, signatureBase64 });
    expect(wallet2.address).toBe(wallet.address);
  });

  it("rejects an unknown nonce", async () => {
    const wallet = createTestWallet();
    const reason = await failureReason(
      completeLogin(db(), { walletAddress: wallet.address, nonce: "f".repeat(64), signatureBase64: wallet.sign("x") }),
    );
    expect(reason).toBe("challenge_not_found");
  });
});
