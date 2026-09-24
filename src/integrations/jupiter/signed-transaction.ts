import "server-only";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

/*
 * Integrity checks for wallet-signed Jupiter transactions (deposit and withdrawal).
 *
 * Circuit persists the UNSIGNED transaction exactly as Jupiter crafted it. Before a
 * signed transaction is forwarded to Jupiter, the server proves it is that same
 * transaction, signed by the authenticated wallet:
 *   1. both decode (strict base64) and deserialize as VersionedTransaction;
 *   2. the serialized MESSAGE bytes are byte-for-byte identical;
 *   3. the wallet is a required signer, and its signature slot is filled;
 *   4. that Ed25519 signature verifies over exactly those message bytes;
 *   5. no other signature slot changed, and the bytes re-serialize identically.
 * Circuit never signs anything and never logs transaction bodies.
 */

export type SignedTransactionFailure =
  | "malformed"
  | "message_mismatch"
  | "signer_missing"
  | "fee_payer_mismatch"
  | "signature_missing"
  | "signature_invalid"
  | "other_signatures_changed";

export class SignedTransactionError extends Error {
  override readonly name = "SignedTransactionError";
  readonly reason: SignedTransactionFailure;

  constructor(reason: SignedTransactionFailure) {
    super(`Signed transaction rejected: ${reason}`);
    this.reason = reason;
  }
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Solana transactions are at most 1232 bytes; allow headroom for the base64 expansion only. */
const MAX_BASE64_LENGTH = 4096;

function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length > MAX_BASE64_LENGTH || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new SignedTransactionError("malformed");
  }
  const bytes = Buffer.from(value, "base64");
  // Reject non-canonical encodings (Node's decoder silently skips bad characters).
  if (bytes.toString("base64") !== value) throw new SignedTransactionError("malformed");
  return new Uint8Array(bytes);
}

function deserialize(value: string): { tx: VersionedTransaction; bytes: Uint8Array } {
  const bytes = decodeBase64(value);
  try {
    return { tx: VersionedTransaction.deserialize(bytes), bytes };
  } catch {
    throw new SignedTransactionError("malformed");
  }
}

const isZero = (signature: Uint8Array) => signature.every((byte) => byte === 0);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

function signerIndex(tx: VersionedTransaction, walletAddress: string): number {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletAddress);
  } catch {
    throw new SignedTransactionError("signer_missing");
  }
  const required = tx.message.header.numRequiredSignatures;
  const index = tx.message.staticAccountKeys.slice(0, required).findIndex((key) => key.equals(wallet));
  if (index < 0) throw new SignedTransactionError("signer_missing");
  return index;
}

export interface UnsignedTransactionShape {
  /** The fee payer; Circuit requires it to be the user's wallet, so the tx id is the wallet's signature. */
  feePayer: string;
  requiredSigners: number;
}

/**
 * Checks a freshly crafted UNSIGNED transaction before it is shown for signing: it must
 * deserialize, and the authenticated wallet must be its fee payer (signature slot 0), so
 * the transaction id is known the moment the wallet signs. Fails closed otherwise.
 */
export function inspectUnsignedTransaction(unsignedBase64: string, walletAddress: string): UnsignedTransactionShape {
  const { tx } = deserialize(unsignedBase64);
  if (signerIndex(tx, walletAddress) !== 0) throw new SignedTransactionError("fee_payer_mismatch");
  const feePayer = tx.message.staticAccountKeys[0];
  if (!feePayer) throw new SignedTransactionError("malformed");
  return { feePayer: feePayer.toBase58(), requiredSigners: tx.message.header.numRequiredSignatures };
}

export interface VerifiedSignedTransaction {
  /**
   * The transaction id (first signature, base58): public evidence, not a secret. Null when
   * another party (e.g. a provider fee payer) still has to sign slot 0, so the id is not
   * known yet. Deposits require it (the wallet must be the fee payer).
   */
  transactionSignature: string | null;
  /** The exact bytes the wallet returned, re-encoded canonically. Forward only to Jupiter; never log. */
  signedTransactionBase64: string;
}

export function verifySignedTransaction({
  preparedUnsignedBase64,
  signedBase64,
  walletAddress,
}: {
  preparedUnsignedBase64: string;
  signedBase64: string;
  walletAddress: string;
}): VerifiedSignedTransaction {
  const prepared = deserialize(preparedUnsignedBase64).tx;
  const signed = deserialize(signedBase64);

  const preparedMessage = prepared.message.serialize();
  const signedMessage = signed.tx.message.serialize();
  if (!sameBytes(preparedMessage, signedMessage)) throw new SignedTransactionError("message_mismatch");

  const index = signerIndex(signed.tx, walletAddress);
  const required = signed.tx.message.header.numRequiredSignatures;
  if (signed.tx.signatures.length !== required || prepared.signatures.length !== required) {
    throw new SignedTransactionError("malformed");
  }

  const walletSignature = signed.tx.signatures[index];
  if (!walletSignature || isZero(walletSignature)) throw new SignedTransactionError("signature_missing");
  const walletKey = new PublicKey(walletAddress).toBytes();
  if (!nacl.sign.detached.verify(signedMessage, walletSignature, walletKey)) {
    throw new SignedTransactionError("signature_invalid");
  }

  for (let i = 0; i < required; i += 1) {
    if (i === index) continue;
    const before = prepared.signatures[i];
    const after = signed.tx.signatures[i];
    if (!before || !after || !sameBytes(before, after)) throw new SignedTransactionError("other_signatures_changed");
  }

  // No trailing bytes or alternative encodings: what we forward is exactly what was verified.
  const canonical = signed.tx.serialize();
  if (!sameBytes(canonical, signed.bytes)) throw new SignedTransactionError("malformed");

  const first = signed.tx.signatures[0];
  return {
    transactionSignature: first && !isZero(first) ? bs58.encode(first) : null,
    signedTransactionBase64: Buffer.from(canonical).toString("base64"),
  };
}

/** A base58 Solana transaction signature: exactly 64 bytes when decoded. */
export function isSolanaSignature(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(value)) return false;
  try {
    return bs58.decode(value).length === 64;
  } catch {
    return false;
  }
}
