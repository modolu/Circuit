import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EquityReference } from "@/src/integrations/pyth/mapper";

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
};
const reference = {
  feedId: 922,
  symbol: "Equity.US.TEST/USD",
  priceUsd: "227.35",
  confidenceUsd: null,
  bestBidUsd: null,
  bestAskUsd: null,
  exponent: -5,
  publisherCount: 7,
  marketSession: "regular",
  feedUpdateTimestamp: "2026-09-23T15:00:00.000Z",
  feedUpdateTimestampUs: "1790175600000000",
  providerTimestamp: "2026-09-23T15:00:00.000Z",
  receivedTimestamp: "2026-09-23T15:00:00.400Z",
  ageMs: 400,
  isCarriedForward: false,
  freshness: "FRESH",
} satisfies EquityReference;

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
    expect(t).toMatch(/Executes after arming/);
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
        configured={[{ symbol: "AAPLx", displayName: "Apple xStock", mintAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", referenceSymbol: "Equity.US.AAPL/USD", referenceFeedId: 922, liveReferenceAccess: "NOT_ENTITLED", jupiterRoutingVerified: true, executionVerified: false }]}
      />,
    );
    const t = text(html);
    expect(t).toContain("No reference-enabled stock is available yet.");
    expect(t).toContain("does not currently have US-equity entitlement");
    expect(t).toMatch(/Solana mint verified XsbE…JzJp VERIFIED/);
    expect(t).toMatch(/Pyth mapping verified Equity\.US\.AAPL\/USD · feed 922 VERIFIED/);
    expect(t).toMatch(/Live reference access PENDING/);
    expect(t).toMatch(/Jupiter token &amp; routing verified .*VERIFIED/);
    expect(t).toMatch(/Live Jupiter Trigger order PENDING/);
    expect(html).not.toMatch(/<button/);
  });
});
