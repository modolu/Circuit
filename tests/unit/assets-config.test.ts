import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { seedableAssets, VERIFIED_ASSETS, verifiedAssetSchema, type VerifiedAssetConfig } from "@/src/config/assets";

const aaplx = VERIFIED_ASSETS.find((asset) => asset.symbol === "AAPLx");

describe("verified asset catalog", () => {
  it("contains AAPLx and every entry satisfies the verified schema", () => {
    expect(aaplx).toBeDefined();
    for (const asset of VERIFIED_ASSETS) expect(verifiedAssetSchema.safeParse(asset).success).toBe(true);
  });

  it("uses a canonical Solana public key as the AAPLx mint", () => {
    expect(new PublicKey(aaplx!.mintAddress).toBase58()).toBe(aaplx!.mintAddress);
    expect(aaplx!.decimals).toBe(8);
    expect(aaplx!.tokenProgram).toBe("spl-token-2022");
  });

  it("maps AAPLx explicitly to the underlying Apple equity feed, not the token's market", () => {
    expect(aaplx!.underlyingSymbol).toBe("AAPL");
    expect(aaplx!.reference).toMatchObject({
      role: "underlying_equity",
      symbol: "Equity.US.AAPL/USD",
      feedId: 922,
      assetType: "equity",
    });
    for (const feed of aaplx!.comparisonFeeds) {
      expect(feed.role).toBe("token_market_comparison");
      expect(feed.feedId).not.toBe(aaplx!.reference.feedId);
    }
  });

  it("keeps execution disabled pending Jupiter verification", () => {
    for (const asset of VERIFIED_ASSETS) expect(asset.execution.status).toBe("PENDING_JUPITER_VERIFICATION");
  });

  it("records verification provenance", () => {
    expect(aaplx!.verification.issuerSources.every((url) => url.startsWith("https://api.backed.fi/"))).toBe(true);
    expect(aaplx!.verification.pythSymbolSource).toBe("https://pyth.dourolabs.app/v1/symbols");
  });

  it("seeds only assets whose Pyth reference passed a live check", () => {
    expect(seedableAssets([aaplx!])).toEqual(aaplx!.verification.pythLiveCheck.status === "PASSED" ? [aaplx] : []);
    const passed: VerifiedAssetConfig = {
      ...aaplx!,
      verification: { ...aaplx!.verification, pythLiveCheck: { ...aaplx!.verification.pythLiveCheck, status: "PASSED" } },
    };
    expect(seedableAssets([passed])).toEqual([passed]);
  });

  it("rejects fictional mints and non-equity primary references", () => {
    expect(verifiedAssetSchema.safeParse({ ...aaplx!, mintAddress: "TEST_MINT_NOT_REAL" }).success).toBe(false);
    expect(
      verifiedAssetSchema.safeParse({ ...aaplx!, reference: { ...aaplx!.reference, symbol: "Crypto.AAPLX/USD" } })
        .success,
    ).toBe(false);
  });
});
