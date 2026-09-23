import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

/**
 * Throwaway Ed25519 keypairs generated per test run, used only to sign test
 * login messages. Circuit application code never handles private keys.
 */
export function createTestWallet() {
  const keyPair = nacl.sign.keyPair();
  const address = new PublicKey(keyPair.publicKey).toBase58();
  const sign = (message: string) =>
    Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), keyPair.secretKey)).toString("base64");
  return { address, sign };
}
