import "server-only";
import type { DbExecutor } from "../db/client.ts";
import { findWalletByAddress } from "../db/repositories/wallets.ts";
import type { Wallet } from "../db/schema.ts";
import { AppError } from "../domain/errors.ts";
import { getSession } from "./session.ts";

/**
 * Resolves the signed-in wallet record for later policy routes. Ownership
 * checks must compare resource.wallet_id to this wallet's id: knowing a UUID is
 * never authorization, and a foreign resource should read as NOT_FOUND.
 */
export async function getAuthenticatedWallet(db: DbExecutor): Promise<Wallet | null> {
  const session = await getSession();
  if (!session) return null;
  return (await findWalletByAddress(db, session.walletAddress)) ?? null;
}

export async function requireAuthenticatedWallet(db: DbExecutor): Promise<Wallet> {
  const wallet = await getAuthenticatedWallet(db);
  if (!wallet) throw new AppError("UNAUTHENTICATED", "Sign in with your wallet to continue.");
  return wallet;
}
