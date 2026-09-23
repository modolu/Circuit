import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicAsset } from "@/src/domain/asset";
import type { EquityReference } from "@/src/integrations/pyth/mapper";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
const { AssetReferenceCard } = await import("@/components/asset/asset-reference-card");

const asset: PublicAsset = {
  id: "00000000-0000-4000-8000-000000000001",
  symbol: "AAPLx",
  displayName: "Apple xStock",
  issuer: "xStocks by Backed",
  underlyingSymbol: "AAPL",
  mintAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  decimals: 8,
  reference: { provider: "pyth_pro", symbol: "Equity.US.AAPL/USD", configured: true },
  execution: { enabled: false, status: "PENDING_JUPITER_VERIFICATION" },
};

// Test values only.
const reference: EquityReference = {
  feedId: 922,
  symbol: "Equity.US.AAPL/USD",
  priceUsd: "1234.5",
  confidenceUsd: "0.0125",
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
};

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("AssetReferenceCard", () => {
  it("leads with the Pyth equity reference and keeps execution clearly pending", () => {
    const html = text(renderToStaticMarkup(<AssetReferenceCard asset={asset} state={{ status: "available", reference }} />));
    expect(html).toContain("Pyth equity reference");
    expect(html).toContain("$1,234.50");
    expect(html).toContain("FRESH");
    expect(html).toContain("Regular session");
    expect(html).toContain("Equity.US.AAPL/USD");
    expect(html).toContain("XsbE…JzJp");
    expect(html).toContain("EXECUTION PENDING");
    expect(html).toMatch(/Jupiter Trigger compatibility is not verified yet/);
    expect(html).not.toMatch(/Jupiter ready|routable/i);
  });

  it("labels carried-forward prices as not new", () => {
    const html = text(
      renderToStaticMarkup(
        <AssetReferenceCard
          asset={asset}
          state={{ status: "available", reference: { ...reference, freshness: "CARRIED", isCarriedForward: true, marketSession: "closed" } }}
        />,
      ),
    );
    expect(html).toContain("CARRIED");
    expect(html).toContain("Not a new price");
    expect(html).toContain("Market closed");
  });

  it("shows no price at all when the reference is unavailable", () => {
    const html = text(
      renderToStaticMarkup(
        <AssetReferenceCard asset={asset} state={{ status: "unavailable", message: "The Pyth reference for this asset is unavailable right now." }} />,
      ),
    );
    expect(html).toContain("UNAVAILABLE");
    expect(html).not.toMatch(/\$\d/);
  });
});
