import { VersionedTransaction } from "@solana/web3.js";

/*
 * Browser helpers for signing a server-prepared transaction with the connected wallet.
 * Only ever called from an explicit user click. Circuit never sees a private key: the
 * wallet signs, and the server re-verifies the result against what it prepared.
 */

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export type SignTransaction = <T extends VersionedTransaction>(transaction: T) => Promise<T>;

/** Deserializes the exact prepared transaction, asks the wallet to sign it, and re-serializes it. */
export async function signPreparedTransaction(signTransaction: SignTransaction, unsignedBase64: string): Promise<string> {
  const transaction = VersionedTransaction.deserialize(base64ToBytes(unsignedBase64));
  const signed = await signTransaction(transaction);
  return bytesToBase64(signed.serialize());
}
