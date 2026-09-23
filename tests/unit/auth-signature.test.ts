import { PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { decodeSignature, isValidWalletAddress, verifyWalletSignature } from "@/src/auth/verify-wallet";
import { createTestWallet } from "../fixtures/wallet";

describe("wallet signature verification", () => {
  const wallet = createTestWallet();
  const message = "Circuit test message";
  const signatureBase64 = wallet.sign(message);

  it("accepts a valid signature over the exact message", () => {
    expect(verifyWalletSignature({ walletAddress: wallet.address, message, signatureBase64 })).toBe(true);
  });

  it("rejects a modified message", () => {
    expect(verifyWalletSignature({ walletAddress: wallet.address, message: `${message} `, signatureBase64 })).toBe(
      false,
    );
  });

  it("rejects a signature presented for another wallet", () => {
    const other = createTestWallet();
    expect(verifyWalletSignature({ walletAddress: other.address, message, signatureBase64 })).toBe(false);
  });

  it("fails safely on malformed signatures and addresses", () => {
    for (const bad of ["", "not base64!", "AAAA", Buffer.alloc(63).toString("base64"), `${signatureBase64}AA==`]) {
      expect(verifyWalletSignature({ walletAddress: wallet.address, message, signatureBase64: bad })).toBe(false);
    }
    expect(decodeSignature(Buffer.alloc(64).toString("base64"))).toHaveLength(64);
    expect(verifyWalletSignature({ walletAddress: "not-a-wallet", message, signatureBase64 })).toBe(false);
  });

  it("accepts only canonical, on-curve wallet addresses", () => {
    expect(isValidWalletAddress(wallet.address)).toBe(true);
    expect(isValidWalletAddress("TEST_WALLET_NOT_REAL")).toBe(false);
    expect(isValidWalletAddress(`${wallet.address}x`)).toBe(false);
    // Program-derived addresses are off-curve by construction: they cannot sign, so they cannot log in.
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("circuit-test")], SystemProgram.programId);
    expect(isValidWalletAddress(pda.toBase58())).toBe(false);
  });
});
