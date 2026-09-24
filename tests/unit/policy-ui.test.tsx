import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { prestocksSnapshot, pythSnapshot } from "../fixtures/references";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
const { NewPolicyForm } = await import("@/components/policy/new-policy-form");
const { PolicyBlockedState } = await import("@/components/policy/policy-blocked-state");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// Fictional fixtures; never rendered in production.
const asset = {
  id: "00000000-0000-4000-8000-000000000001",
  symbol: "TEST_ASSET",
  displayName: "Test Asset",
  underlyingSymbol: "TEST",
  mintAddress: "TEST_MINT_NOT_REAL_ABCDEFGHJKLMNPQ",
  decimals: 8,
  referenceSymbol: "Equity.US.TEST/USD",
  referenceProvider: "PYTH" as const,
  referenceName: "Pyth TEST reference",
};
const reference = pythSnapshot({ priceUsd: "227.35" }, { symbol: "Equity.US.TEST/USD" });

describe("New policy UI", () => {
  it("renders every structured field and separates Pyth, Circuit and Jupiter", () => {
    const html = renderToStaticMarkup(
      <NewPolicyForm assets={[asset]} asset={asset} reference={reference} referenceError={null} quote={{ symbol: "USDC", decimals: 6 }} />,
    );
    const t = text(html);
    for (const label of ["Buy below", "Buy above", "Sell above", "Sell below", "Budget", "Fixed USD price", "% from current reference", "0.25%", "0.50%", "1.00%", "24h", "3d", "7d"]) {
      expect(t).toContain(label);
    }
    expect(t).toContain("Pyth equity reference");
    expect(t).toContain("$227.35");
    expect(t).toContain("Deterministic compiler");
    expect(t).toContain("Jupiter TEST_ASSET/USD");
    // With nothing entered, the create button is disabled.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create draft policy<\/button>/);
  });

  it("shows no price and no working create button without a reference", () => {
    const html = renderToStaticMarkup(
      <NewPolicyForm assets={[asset]} asset={asset} reference={null} referenceError="The Pyth reference for this asset is unavailable right now." quote={{ symbol: "USDC", decimals: 6 }} />,
    );
    expect(text(html)).toContain("unavailable right now");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create draft policy<\/button>/);
    expect(text(html)).not.toMatch(/\$\d/);
  });

  it("explains the entitlement blocker honestly without a create action", () => {
    const html = renderToStaticMarkup(
      <PolicyBlockedState
        configured={[{ symbol: "AAPLx", displayName: "Apple xStock", mintAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", referenceLabel: "Pyth mapping", referenceDetail: "Equity.US.AAPL/USD · feed 922", liveReferenceAccess: "NOT_ENTITLED", jupiterRoutingVerified: true, executionVerified: false }]}
      />,
    );
    const t = text(html);
    expect(t).toContain("No reference-enabled stock is available yet.");
    expect(t).toContain("needs a Pyth key with US-equity entitlement");
    expect(t).toMatch(/Solana mint verified XsbE…JzJp VERIFIED/);
    expect(t).toMatch(/Pyth mapping verified Equity\.US\.AAPL\/USD · feed 922 VERIFIED/);
    expect(t).toMatch(/Live reference access PENDING/);
    expect(t).toMatch(/Jupiter token &amp; routing verified .*VERIFIED/);
    expect(t).toMatch(/Live Jupiter Trigger order PENDING/);
    expect(html).not.toMatch(/<button/);
  });
});

describe("New policy UI (PreStocks)", () => {
  const prestocksAsset = {
    id: "00000000-0000-4000-8000-000000000002",
    symbol: "ANTHROPIC",
    displayName: "Anthropic PreStocks",
    underlyingSymbol: "Anthropic",
    mintAddress: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    decimals: 9,
    referenceSymbol: "ANTHROPIC",
    referenceProvider: "PRESTOCKS" as const,
    referenceName: "PreStocks mark",
  };

  it("shows the PreStocks mark, token market price and premium/discount, and no Pyth label", () => {
    const html = renderToStaticMarkup(
      <NewPolicyForm assets={[prestocksAsset]} asset={prestocksAsset} reference={prestocksSnapshot()} referenceError={null} quote={{ symbol: "USDC", decimals: 6 }} />,
    );
    const t = text(html);
    for (const expected of ["PreStocks mark", "$1,000.00", "Token market price $986.10", "Discount to mark 1.39%", "% from PreStocks mark", "CURRENT RESPONSE", "Jupiter ANTHROPIC/USD", "Mark reference"]) {
      expect(t).toContain(expected);
    }
    expect(t).not.toMatch(/Pyth/);
    // A current PreStocks response allows % triggers (unlike a non-FRESH Pyth reference).
    expect(html).not.toMatch(/<input[^>]*value="RELATIVE_PERCENT"[^>]*disabled/);
  });
});
