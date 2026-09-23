import "server-only";
import bs58 from "bs58";
import type { Wallet } from "../../db/schema.ts";
import { AppError } from "../../domain/errors.ts";
import type { JupiterClient } from "../../integrations/jupiter/client.ts";
import { requireLiveMode, toJupiterAppError } from "./errors.ts";

/*
 * Jupiter Trigger authentication (docs: POST /auth/challenge → wallet signMessage →
 * POST /auth/verify with a base58 signature → 24h JWT). The wallet is always the
 * signed-in Circuit wallet; the browser never chooses it.
 */

/** Returns Jupiter's message challenge exactly as issued: no rewriting, prefixing or whitespace changes. */
export async function requestJupiterChallenge(
  { wallet, mode }: { wallet: Wallet; mode: "mock" | "live" },
  { client }: { client: JupiterClient },
): Promise<{ type: "message"; challenge: string }> {
  requireLiveMode(mode);
  try {
    const challenge = await client.requestAuthChallenge(wallet.address, "message");
    if (challenge.type !== "message") throw new AppError("PROVIDER_REJECTED", "Jupiter returned an unexpected challenge type.");
    return { type: "message", challenge: challenge.challenge };
  } catch (error) {
    throw toJupiterAppError(error, "auth");
  }
}

/** base64 (from the browser) → the base58 signature Jupiter documents. Rejects anything but 64 bytes. */
export function signatureBase64ToBase58(signatureBase64: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64) || signatureBase64.length % 4 !== 0) {
    throw new AppError("VALIDATION_ERROR", "Invalid request: check signature.");
  }
  const bytes = Buffer.from(signatureBase64, "base64");
  if (bytes.length !== 64) throw new AppError("VALIDATION_ERROR", "Invalid request: check signature.");
  return bs58.encode(bytes);
}

/** Exchanges the signed challenge for Jupiter's JWT. The caller stores it only in the HttpOnly cookie. */
export async function verifyJupiterChallenge(
  { wallet, signatureBase64, mode }: { wallet: Wallet; signatureBase64: string; mode: "mock" | "live" },
  { client }: { client: JupiterClient },
): Promise<{ jwt: string }> {
  requireLiveMode(mode);
  const signature = signatureBase64ToBase58(signatureBase64);
  try {
    return { jwt: await client.verifyAuth(wallet.address, signature) };
  } catch (error) {
    throw toJupiterAppError(error, "auth");
  }
}
