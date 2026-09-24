import { describe, expect, it } from "vitest";
import {
  inspectUnsignedTransaction,
  isSolanaSignature,
  SignedTransactionError,
  verifySignedTransaction,
} from "@/src/integrations/jupiter/signed-transaction";
import { createLogger, REDACTED } from "@/src/observability/logger";
import { buildUnsignedTransaction, fakeSignature, signTransaction, signWithWrongKey, testKeypair, transactionId } from "../fixtures/transactions";

const wallet = testKeypair(1);
const other = testKeypair(2);
const WALLET = wallet.publicKey.toBase58();
const prepared = buildUnsignedTransaction({ payer: wallet.publicKey, lamports: 10_500_000 });

function rejection(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SignedTransactionError);
    return (error as SignedTransactionError).reason;
  }
  throw new Error("expected rejection");
}

describe("signed transaction integrity", () => {
  it("accepts exactly the prepared message signed by the wallet, and returns its public id", () => {
    const signed = signTransaction(prepared, wallet);
    const verified = verifySignedTransaction({ preparedUnsignedBase64: prepared, signedBase64: signed, walletAddress: WALLET });
    expect(verified.transactionSignature).toBe(transactionId(signed));
    expect(isSolanaSignature(verified.transactionSignature)).toBe(true);
    expect(verified.signedTransactionBase64).toBe(signed);
  });

  it("rejects a modified message even when validly signed", () => {
    const tampered = signTransaction(buildUnsignedTransaction({ payer: wallet.publicKey, lamports: 99_000_000 }), wallet);
    expect(rejection(() => verifySignedTransaction({ preparedUnsignedBase64: prepared, signedBase64: tampered, walletAddress: WALLET }))).toBe(
      "message_mismatch",
    );
  });

  it("rejects a signature from the wrong key", () => {
    const forged = signWithWrongKey(prepared, 0, other);
    expect(rejection(() => verifySignedTransaction({ preparedUnsignedBase64: prepared, signedBase64: forged, walletAddress: WALLET }))).toBe(
      "signature_invalid",
    );
  });

  it("rejects a missing signature and a wallet that is not a signer", () => {
    expect(rejection(() => verifySignedTransaction({ preparedUnsignedBase64: prepared, signedBase64: prepared, walletAddress: WALLET }))).toBe(
      "signature_missing",
    );
    const signed = signTransaction(prepared, wallet);
    expect(
      rejection(() => verifySignedTransaction({ preparedUnsignedBase64: prepared, signedBase64: signed, walletAddress: other.publicKey.toBase58() })),
    ).toBe("signer_missing");
  });

  it("rejects malformed, non-canonical and padded encodings", () => {
    const signed = signTransaction(prepared, wallet);
    for (const bad of ["", "not base64!", "AAAA", `${signed}AAAA`, signed.replace(/.$/, "*")]) {
      expect(rejection(() => verifySignedTransaction({ preparedUnsignedBase64: prepared, signedBase64: bad, walletAddress: WALLET }))).toBe("malformed");
    }
  });

  it("rejects a change to another signer's slot", () => {
    const cosigner = testKeypair(3);
    const twoSigner = buildUnsignedTransaction({ payer: cosigner.publicKey, extraSigner: wallet.publicKey });
    const signed = signTransaction(twoSigner, wallet);
    // The wallet (slot 1) signed; slot 0 still belongs to the co-signer and is empty, so the id is unknown.
    expect(verifySignedTransaction({ preparedUnsignedBase64: twoSigner, signedBase64: signed, walletAddress: WALLET }).transactionSignature).toBeNull();
    const meddled = signWithWrongKey(signed, 0, other);
    expect(rejection(() => verifySignedTransaction({ preparedUnsignedBase64: twoSigner, signedBase64: meddled, walletAddress: WALLET }))).toBe(
      "other_signatures_changed",
    );
  });

  it("only presents transactions whose fee payer is the wallet", () => {
    expect(inspectUnsignedTransaction(prepared, WALLET).feePayer).toBe(WALLET);
    const foreignPayer = buildUnsignedTransaction({ payer: other.publicKey, extraSigner: wallet.publicKey });
    expect(rejection(() => inspectUnsignedTransaction(foreignPayer, WALLET))).toBe("fee_payer_mismatch");
    expect(rejection(() => inspectUnsignedTransaction(prepared, other.publicKey.toBase58()))).toBe("signer_missing");
  });

  it("recognizes only 64-byte base58 signatures", () => {
    expect(isSolanaSignature(fakeSignature(9))).toBe(true);
    expect(isSolanaSignature("mock_0123456789abcdef0123456789abcdef")).toBe(false);
    expect(isSolanaSignature("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(false);
    expect(isSolanaSignature(WALLET)).toBe(false); // 32 bytes: an address, not a signature
  });

  it("never lets signed or unsigned transaction bodies reach logs", () => {
    const lines: string[] = [];
    const log = createLogger({}, (line) => lines.push(line));
    const signed = signTransaction(prepared, wallet);
    log.info("x", { signedTransaction: signed, depositSignedTx: signed, unsignedTransaction: prepared, transaction: prepared });
    const out = lines.join("\n");
    expect(out).not.toContain(signed.slice(0, 40));
    expect(out).not.toContain(prepared.slice(0, 40));
    expect(out).toContain(REDACTED);
  });
});
