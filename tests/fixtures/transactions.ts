import { Keypair, MessageV0, PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

/*
 * Deterministic TEST-ONLY Solana transactions. Keys come from fixed test seeds (or are
 * generated per run) and never belong to a real wallet. Nothing here is ever sent to a
 * network, and no real signed transaction or private key is committed.
 */

/** A fictional keypair from a fixed test seed. */
export function testKeypair(seedByte: number): Keypair {
  return Keypair.fromSeed(new Uint8Array(32).fill(seedByte));
}

/** A fixed fictional "recent blockhash" (a valid base58 32-byte value, not a real blockhash). */
const TEST_BLOCKHASH = new PublicKey(new Uint8Array(32).fill(250)).toBase58();
const TEST_RECEIVER = new PublicKey(new Uint8Array(32).fill(251));

/** An UNSIGNED v0 transaction paid for by `payer`, optionally requiring a second signer. */
export function buildUnsignedTransaction({
  payer,
  extraSigner,
  lamports = 1_000,
}: {
  payer: PublicKey;
  extraSigner?: PublicKey;
  lamports?: number;
}): string {
  const instructions = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: TEST_RECEIVER, lamports })];
  if (extraSigner) instructions.push(SystemProgram.transfer({ fromPubkey: extraSigner, toPubkey: TEST_RECEIVER, lamports: 1 }));
  const message = MessageV0.compile({ payerKey: payer, instructions, recentBlockhash: TEST_BLOCKHASH });
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

/** Signs a prepared transaction the way a wallet would (test keys only). */
export function signTransaction(unsignedBase64: string, ...signers: Keypair[]): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(unsignedBase64, "base64"));
  tx.sign(signers);
  return Buffer.from(tx.serialize()).toString("base64");
}

/** A transaction whose wallet slot carries a signature made by the WRONG key. */
export function signWithWrongKey(unsignedBase64: string, walletIndex: number, wrongKey: Keypair): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(unsignedBase64, "base64"));
  tx.signatures[walletIndex] = nacl.sign.detached(tx.message.serialize(), wrongKey.secretKey);
  return Buffer.from(tx.serialize()).toString("base64");
}

/** The base58 transaction id (first signature) of a signed test transaction. */
export function transactionId(signedBase64: string): string {
  const first = VersionedTransaction.deserialize(Buffer.from(signedBase64, "base64")).signatures[0];
  if (!first) throw new Error("no signature");
  return bs58.encode(first);
}

/** A syntactically real base58 64-byte signature for provider fixtures (test bytes, never on chain). */
export function fakeSignature(seed: number): string {
  return bs58.encode(new Uint8Array(64).fill(seed));
}
