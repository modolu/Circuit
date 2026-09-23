import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

/**
 * True for a canonical base58 Ed25519 public key that can sign, i.e. on the
 * curve. Program-derived addresses are off-curve and can never sign in.
 */
export function isValidWalletAddress(value: string): boolean {
  try {
    const key = new PublicKey(value);
    return key.toBase58() === value && PublicKey.isOnCurve(key.toBytes());
  } catch {
    return false;
  }
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decodes a base64 Ed25519 signature; `null` unless it is exactly 64 bytes. */
export function decodeSignature(signatureBase64: string): Uint8Array | null {
  if (!BASE64.test(signatureBase64) || signatureBase64.length % 4 !== 0) return null;
  const bytes = Buffer.from(signatureBase64, "base64");
  return bytes.length === nacl.sign.signatureLength ? new Uint8Array(bytes) : null;
}

/**
 * Verifies a detached Ed25519 signature over the exact UTF-8 bytes of
 * `message`. Returns false, never throws, for malformed input.
 */
export function verifyWalletSignature({
  walletAddress,
  message,
  signatureBase64,
}: {
  walletAddress: string;
  message: string;
  signatureBase64: string;
}): boolean {
  if (!isValidWalletAddress(walletAddress)) return false;
  const signature = decodeSignature(signatureBase64);
  if (!signature) return false;
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      signature,
      new PublicKey(walletAddress).toBytes(),
    );
  } catch {
    return false;
  }
}
