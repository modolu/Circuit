import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  ALL_VERIFIED_ASSETS,
  PRESTOCKS_ASSETS,
  seedableAssets,
  seedBlocker,
  VERIFIED_ASSETS,
  verifiedAssetSchema,
  type PrestocksAssetConfig,
  type PythAssetConfig,
  type VerifiedAssetConfig,
} from "@/src/config/assets";
import { PRESTOCKS_DISCOVERY } from "@/src/config/prestocks";

function pythAsset(symbol: string): PythAssetConfig {
  const asset = VERIFIED_ASSETS.find((entry) => entry.symbol === symbol);
  if (asset?.referenceProvider !== "PYTH") throw new Error(`${symbol} is not a Pyth asset`);
  return asset;
}
function prestocksAsset(symbol: string): PrestocksAssetConfig {
  const asset = PRESTOCKS_ASSETS.find((entry) => entry.symbol === symbol);
  if (asset?.referenceProvider !== "PRESTOCKS") throw new Error(`${symbol} is not a PreStocks asset`);
  return asset;
}

const aaplx = pythAsset("AAPLx");
const anthropic = prestocksAsset("ANTHROPIC");

describe("verified asset catalog (Pyth)", () => {
  it("contains AAPLx and every entry satisfies the verified schema", () => {
    for (const asset of ALL_VERIFIED_ASSETS) expect(verifiedAssetSchema.safeParse(asset).success).toBe(true);
  });

  it("uses a canonical Solana public key as the AAPLx mint", () => {
    expect(new PublicKey(aaplx.mintAddress).toBase58()).toBe(aaplx.mintAddress);
    expect(aaplx.decimals).toBe(8);
    expect(aaplx.tokenProgram).toBe("spl-token-2022");
  });

  it("maps AAPLx explicitly to the underlying Apple equity feed, not the token's market", () => {
    expect(aaplx.underlyingSymbol).toBe("AAPL");
    expect(aaplx.reference).toMatchObject({ role: "underlying_equity", symbol: "Equity.US.AAPL/USD", feedId: 922, assetType: "equity" });
    for (const feed of aaplx.comparisonFeeds) {
      expect(feed.role).toBe("token_market_comparison");
      expect(feed.feedId).not.toBe(aaplx.reference.feedId);
    }
  });

  it("keeps execution pending Jupiter verification for every asset", () => {
    for (const asset of ALL_VERIFIED_ASSETS) expect(asset.execution.status).toBe("PENDING_JUPITER_VERIFICATION");
  });

  it("records verification provenance", () => {
    expect(aaplx.verification.issuerSources.every((url) => url.startsWith("https://api.backed.fi/"))).toBe(true);
    expect(aaplx.verification.pythSymbolSource).toBe("https://pyth.dourolabs.app/v1/symbols");
  });

  it("seeds a Pyth asset only when its current Pyth reference check passes", () => {
    expect(aaplx.verification.pythLiveCheck.status).toBe("NOT_ENTITLED"); // pnpm test:live, 2026-10-05
    expect(seedableAssets([aaplx])).toEqual([]);
    expect(seedBlocker(aaplx)).toMatch(/NOT_ENTITLED/);
    const passed: VerifiedAssetConfig = { ...aaplx, verification: { ...aaplx.verification, pythLiveCheck: { ...aaplx.verification.pythLiveCheck, status: "PASSED" } } };
    expect(seedableAssets([passed])).toEqual([passed]);
  });

  it("rejects fictional mints and non-equity primary references", () => {
    expect(verifiedAssetSchema.safeParse({ ...aaplx, mintAddress: "TEST_MINT_NOT_REAL" }).success).toBe(false);
    expect(verifiedAssetSchema.safeParse({ ...aaplx, reference: { ...aaplx.reference, symbol: "Crypto.AAPLX/USD" } }).success).toBe(false);
  });
});

describe("curated PreStocks asset", () => {
  it("is ANTHROPIC with its exact first-party mint as both mint and contract address", () => {
    expect(anthropic.mintAddress).toBe("Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw");
    expect(anthropic.reference.contractAddress).toBe(anthropic.mintAddress);
    expect(new PublicKey(anthropic.mintAddress).toBase58()).toBe(anthropic.mintAddress);
    expect(anthropic).toMatchObject({ decimals: 9, tokenProgram: "spl-token-2022", issuer: "PreStocks" });
    expect(anthropic.reference).toMatchObject({ provider: "prestocks", referenceType: "MARK_PRICE", apiUrl: "https://prestocks.com/api/prestocks", productUrl: "https://www.prestocks.com/anthropic" });
  });

  it("has no Pyth mapping and does not depend on Pyth entitlement", () => {
    expect("feedId" in anthropic.reference).toBe(false);
    expect("pythLiveCheck" in anthropic.verification).toBe(false);
    expect(seedBlocker(anthropic)).toBeNull();
    expect(seedableAssets(ALL_VERIFIED_ASSETS).map((a) => a.symbol)).toEqual(["ANTHROPIC"]);
    // Isolated from Pyth: still seedable next to a Pyth asset whose key lacks equity access.
    const pythBlocked: VerifiedAssetConfig = { ...aaplx, verification: { ...aaplx.verification, pythLiveCheck: { ...aaplx.verification.pythLiveCheck, status: "NOT_ENTITLED" } } };
    expect(seedableAssets([pythBlocked, anthropic]).map((a) => a.symbol)).toEqual(["ANTHROPIC"]);
  });

  it("records BUY as the only live side, SELL restricted, and the identity reference basis", () => {
    expect(anthropic.jupiter.levels.JUPITER_TOKEN_RECOGNIZED?.result).toBe("PASSED");
    expect(anthropic.jupiter.levels.SPOT_ROUTE_VERIFIED?.result).toBe("PASSED");
    expect(anthropic.jupiter.sides.BUY.result).not.toMatch(/RESTRICTED|FAILED/);
    expect(anthropic.jupiter.sides.SELL.result).toBe("RESTRICTED");
    expect(anthropic.referenceBasis).toMatchObject({ status: "RESOLVED", triggerMapping: "IDENTITY" });
    expect(anthropic.referenceBasis.disclosure).toMatch(/premium or discount to the PreStocks mark/);
    expect(anthropic.tokenRestrictions.transferFeeBps).toBe(100);
  });

  it("refuses a non-PreStocks pre-IPO token, a mismatched contract and ticker-derived identity", () => {
    const tessera = { ...anthropic, reference: { ...anthropic.reference, apiUrl: "https://tessera.example/api", productUrl: "https://tessera.example/anthropic" } };
    expect(verifiedAssetSchema.safeParse(tessera).success).toBe(false);
    expect(verifiedAssetSchema.safeParse({ ...anthropic, issuer: "Tessera" }).success).toBe(false);
    const otherMint = { ...anthropic, mintAddress: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB" };
    expect(verifiedAssetSchema.safeParse(otherMint).success).toBe(false);
    expect(verifiedAssetSchema.safeParse({ ...anthropic, verification: { ...anthropic.verification, identitySources: ["https://coingecko.com/x"] } }).success).toBe(false);
  });

  it("does not seed a PreStocks asset whose own checks did not pass", () => {
    const failed: VerifiedAssetConfig = {
      ...anthropic,
      verification: { ...anthropic.verification, prestocksLiveCheck: { ...anthropic.verification.prestocksLiveCheck, status: "FAILED" } },
    };
    expect(seedBlocker(failed)).toMatch(/PreStocks check/);
    const unrecognized: VerifiedAssetConfig = {
      ...anthropic,
      jupiter: { ...anthropic.jupiter, levels: { ...anthropic.jupiter.levels, JUPITER_TOKEN_RECOGNIZED: { result: "FAILED", detail: "x" } } },
    };
    expect(seedBlocker(unrecognized)).toMatch(/recognition/);
  });
});

describe("PreStocks discovery records (display only)", () => {
  it("are keyed by exact mint, mark SpaceX as not eligible, and never make catalog items executable", () => {
    for (const mint of Object.keys(PRESTOCKS_DISCOVERY)) expect(new PublicKey(mint).toBase58()).toBe(mint);
    expect(PRESTOCKS_DISCOVERY.PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh).toMatchObject({ symbol: "SPACEX", status: "NOT_ELIGIBLE" });
    const curatedMints = new Set(PRESTOCKS_ASSETS.map((a) => a.mintAddress));
    expect([...curatedMints]).toEqual(["Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw"]);
    expect(Object.keys(PRESTOCKS_DISCOVERY).length).toBeGreaterThan(curatedMints.size);
  });
});
