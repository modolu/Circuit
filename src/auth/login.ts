import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SolanaCluster } from "../config/env.ts";
import type { Database } from "../db/client.ts";
import {
  consumeAuthNonce,
  deleteAuthNoncesExpiredBefore,
  findAuthNonceByHash,
  insertAuthNonce,
} from "../db/repositories/auth-nonces.ts";
import { upsertWalletSeen } from "../db/repositories/wallets.ts";
import type { Wallet } from "../db/schema.ts";
import { AppError } from "../domain/errors.ts";
import { verifyWalletSignature } from "./verify-wallet.ts";
import { buildLoginMessage } from "./wallet-message.ts";

export const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const EXPIRED_CHALLENGE_RETENTION_MS = 60 * 60 * 1000;

/** One client-facing message for every verification failure, so responses reveal nothing about challenge state. */
export const LOGIN_FAILED_MESSAGE = "Sign-in could not be verified. Request a new sign-in message and try again.";

export type LoginFailureReason =
  | "challenge_not_found"
  | "wallet_mismatch"
  | "challenge_consumed"
  | "challenge_expired"
  | "bad_signature"
  | "consume_race_lost";

/** Internal reason travels on `cause` for logs and tests; the client only sees LOGIN_FAILED_MESSAGE. */
function loginFailed(reason: LoginFailureReason): AppError {
  return new AppError("UNAUTHENTICATED", LOGIN_FAILED_MESSAGE, { cause: reason });
}

export function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

export interface LoginConfig {
  appOrigin: string;
  cluster: SolanaCluster;
}

export interface LoginChallenge {
  nonce: string;
  message: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Creates a single-use challenge bound to one wallet. Only the nonce's hash is stored. */
export async function issueLoginChallenge(
  db: Database,
  { walletAddress, config, now = new Date() }: { walletAddress: string; config: LoginConfig; now?: Date },
): Promise<LoginChallenge> {
  // Whole seconds keep the rebuilt message byte-identical after a database round trip.
  const issuedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const expiresAt = new Date(issuedAt.getTime() + LOGIN_CHALLENGE_TTL_MS);
  const nonce = randomBytes(32).toString("hex");
  const appOrigin = new URL(config.appOrigin).origin;

  await deleteAuthNoncesExpiredBefore(db, new Date(issuedAt.getTime() - EXPIRED_CHALLENGE_RETENTION_MS));
  await insertAuthNonce(db, {
    nonceHash: hashNonce(nonce),
    walletAddress,
    appOrigin,
    cluster: config.cluster,
    issuedAt,
    expiresAt,
  });

  return {
    nonce,
    message: buildLoginMessage({ appOrigin, walletAddress, nonce, issuedAt, expiresAt, cluster: config.cluster }),
    issuedAt,
    expiresAt,
  };
}

/**
 * Verifies a signed challenge and records the login. The nonce is consumed
 * only after the signature verifies, atomically with the wallet upsert.
 */
export async function completeLogin(
  db: Database,
  {
    walletAddress,
    nonce,
    signatureBase64,
    now = new Date(),
  }: { walletAddress: string; nonce: string; signatureBase64: string; now?: Date },
): Promise<Wallet> {
  const nonceHash = hashNonce(nonce);
  const challenge = await findAuthNonceByHash(db, nonceHash);

  if (!challenge) throw loginFailed("challenge_not_found");
  if (challenge.walletAddress !== walletAddress) throw loginFailed("wallet_mismatch");
  if (challenge.consumedAt) throw loginFailed("challenge_consumed");
  if (challenge.expiresAt.getTime() <= now.getTime()) throw loginFailed("challenge_expired");

  const message = buildLoginMessage({
    appOrigin: challenge.appOrigin,
    walletAddress: challenge.walletAddress,
    nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    cluster: challenge.cluster as SolanaCluster,
  });
  if (!verifyWalletSignature({ walletAddress, message, signatureBase64 })) throw loginFailed("bad_signature");

  return db.transaction(async (tx) => {
    const consumed = await consumeAuthNonce(tx, { nonceHash, walletAddress, now });
    if (!consumed) throw loginFailed("consume_race_lost");
    return upsertWalletSeen(tx, walletAddress, now);
  });
}
