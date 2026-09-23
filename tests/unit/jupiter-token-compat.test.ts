import { describe, expect, it } from "vitest";
import { assessDepositMint, assessPolicySide, type MintProfile } from "@/src/integrations/jupiter/token-compat";
import { AAPLX_MINT, USDC_MINT } from "../fixtures/jupiter";

// AAPLx extension set as read from Solana mainnet on 2026-09-23.
const aaplx: MintProfile = {
  mint: AAPLX_MINT,
  program: "spl-token-2022",
  extensions: ["metadataPointer", "permanentDelegate", "defaultAccountState", "scaledUiAmountConfig", "pausableConfig", "confidentialTransferMint", "transferHook", "tokenMetadata"],
  transferHookProgramId: null,
};
const usdc: MintProfile = { mint: USDC_MINT, program: "spl-token", extensions: [] };

describe("Trigger V2 deposit compatibility", () => {
  it("accepts Token-2022 mints without restricted extensions", () => {
    expect(assessDepositMint({ mint: "x", program: "spl-token-2022", extensions: ["metadataPointer", "scaledUiAmountConfig", "pausableConfig"] }).status).toBe("COMPATIBLE");
    expect(assessDepositMint(usdc).status).toBe("COMPATIBLE");
  });

  it("rejects transfer-fee and transfer-hook deposit mints unless whitelisted", () => {
    const fee = assessDepositMint({ mint: "x", program: "spl-token-2022", extensions: ["transferFeeConfig"] });
    expect(fee).toMatchObject({ status: "RESTRICTED_UNLESS_WHITELISTED", restrictedExtensions: ["transferFeeConfig"] });
    const hook = assessDepositMint(aaplx);
    expect(hook).toMatchObject({ status: "RESTRICTED_UNLESS_WHITELISTED", restrictedExtensions: ["transferHook"] });
    expect(hook.notes.join(" ")).toMatch(/no hook program set/);
    expect(assessDepositMint(aaplx, { whitelisted: true }).status).toBe("COMPATIBLE");
  });

  it("assesses BUY and SELL independently", () => {
    expect(assessPolicySide("BUY", { stock: aaplx, quote: usdc }).status).toBe("COMPATIBLE");
    expect(assessPolicySide("SELL", { stock: aaplx, quote: usdc }).status).toBe("RESTRICTED_UNLESS_WHITELISTED");
  });
});
