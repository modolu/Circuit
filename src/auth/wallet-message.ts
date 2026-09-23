import type { SolanaCluster } from "../config/env.ts";

/**
 * The canonical Circuit login message (CIRCUIT_ARCHITECTURE.md §8, §20).
 *
 * Follows the Sign-In With Solana text layout so wallets can check the domain
 * against the requesting origin. Only the server calls this: it builds the
 * message when issuing a challenge, and rebuilds it byte-for-byte from the
 * persisted challenge when verifying. Client-supplied message text is never
 * trusted.
 */

export const LOGIN_MESSAGE_VERSION = "1";

export const LOGIN_STATEMENT =
  "Sign in to Circuit. This is an authentication message, not a transaction. " +
  "Signing it does not authorize Circuit to move funds or submit any transaction on your behalf.";

export interface LoginMessageFields {
  /** Origin the message is bound to, e.g. `https://circuit.example`. */
  appOrigin: string;
  walletAddress: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  cluster: SolanaCluster;
}

// SIWS chain identifiers. Solana's `mainnet-beta` cluster is `mainnet` there.
const SIWS_CHAIN: Record<SolanaCluster, string> = {
  "mainnet-beta": "solana:mainnet",
  devnet: "solana:devnet",
  testnet: "solana:testnet",
};

export function buildLoginMessage(fields: LoginMessageFields): string {
  const origin = new URL(fields.appOrigin);
  return [
    `${origin.host} wants you to sign in with your Solana account:`,
    fields.walletAddress,
    "",
    LOGIN_STATEMENT,
    "",
    `URI: ${origin.origin}`,
    `Version: ${LOGIN_MESSAGE_VERSION}`,
    `Chain ID: ${SIWS_CHAIN[fields.cluster]}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt.toISOString()}`,
    `Expiration Time: ${fields.expiresAt.toISOString()}`,
  ].join("\n");
}
