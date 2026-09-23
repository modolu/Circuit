import "server-only";
import type { Wallet } from "../../db/schema.ts";
import type { JupiterClient } from "../../integrations/jupiter/client.ts";
import { requireJupiterJwt, requireLiveMode, toJupiterAppError } from "./errors.ts";

/*
 * Jupiter vault status and explicit registration. The vault is a Privy-managed,
 * per-wallet custodial account on Jupiter's side. Registering it moves no funds and
 * needs no wallet transaction; funds enter only through a separately signed deposit.
 */

export type VaultStatus = { status: "READY"; vaultPubkey: string } | { status: "NOT_REGISTERED" };

export interface JupiterStatus {
  authenticated: boolean;
  /** True when a cookie existed but Jupiter rejected it (401): the caller clears the cookie. */
  expired: boolean;
  vault: VaultStatus | null;
}

/** Safe status for the signed-in wallet. Never returns or decodes the JWT. */
export async function getJupiterStatus(
  { wallet, jwt, mode }: { wallet: Wallet; jwt: string | null; mode: "mock" | "live" },
  { client }: { client: JupiterClient },
): Promise<JupiterStatus> {
  requireLiveMode(mode);
  if (!jwt) return { authenticated: false, expired: false, vault: null };
  try {
    const vault = await client.getVault(jwt);
    if (vault && vault.userPubkey !== wallet.address) {
      // A JWT is tied to one wallet; a mismatch means the session is not this wallet's.
      return { authenticated: false, expired: true, vault: null };
    }
    return { authenticated: true, expired: false, vault: vault ? { status: "READY", vaultPubkey: vault.vaultPubkey } : { status: "NOT_REGISTERED" } };
  } catch (error) {
    const appError = toJupiterAppError(error, "vault");
    if (appError.code === "PROVIDER_AUTH_REQUIRED") return { authenticated: false, expired: true, vault: null };
    throw appError;
  }
}

/** Explicit user action only. A 409 (already registered) returns the existing vault. */
export async function registerJupiterVault(
  { wallet, jwt, mode }: { wallet: Wallet; jwt: string | null; mode: "mock" | "live" },
  { client }: { client: JupiterClient },
): Promise<{ vault: VaultStatus; created: boolean }> {
  requireLiveMode(mode);
  const token = requireJupiterJwt(jwt);
  try {
    const { vault, created } = await client.registerVault(token);
    if (vault.userPubkey !== wallet.address) {
      return { vault: { status: "NOT_REGISTERED" }, created: false };
    }
    return { vault: { status: "READY", vaultPubkey: vault.vaultPubkey }, created };
  } catch (error) {
    throw toJupiterAppError(error, "vault");
  }
}
