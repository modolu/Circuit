import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicAsset } from "@/src/domain/asset";
import { prestocksSnapshot, pythSnapshot } from "../fixtures/references";

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
  reference: { provider: "PYTH", symbol: "Equity.US.AAPL/USD", label: "Pyth AAPL/USD", configured: true },
  execution: { enabled: false, status: "PENDING_JUPITER_VERIFICATION" },
};

// Test values only.
const reference = pythSnapshot();

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
    expect(html).toMatch(/No live order has been verified for it yet/);
    expect(html).not.toMatch(/Jupiter ready|routable/i);
  });

  it("labels carried-forward prices as not new", () => {
    const html = text(
      renderToStaticMarkup(
        <AssetReferenceCard
          asset={asset}
          state={{ status: "available", reference: pythSnapshot({ freshness: "CARRIED" }, { isCarriedForward: true, marketSession: "closed" }) }}
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

describe("AssetReferenceCard (PreStocks)", () => {
  const prestocksAsset: PublicAsset = {
    ...asset,
    symbol: "ANTHROPIC",
    displayName: "Anthropic PreStocks",
    issuer: "PreStocks",
    underlyingSymbol: "Anthropic",
    mintAddress: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    decimals: 9,
    reference: { provider: "PRESTOCKS", symbol: "ANTHROPIC", label: "PreStocks mark", configured: true },
  };

  it("shows the PreStocks mark, token price and discount, never Pyth, with the honest timestamp and disclosure", () => {
    const html = text(renderToStaticMarkup(<AssetReferenceCard asset={prestocksAsset} state={{ status: "available", reference: prestocksSnapshot() }} />));
    expect(html).toContain("PreStocks mark");
    expect(html).toContain("$1,000.00");
    expect(html).toContain("Token market price $986.10");
    expect(html).toContain("Discount to mark 1.39%");
    expect(html).toContain("CURRENT RESPONSE");
    expect(html).toContain("PreStocks publishes no per-price timestamp");
    expect(html).toContain("not ownership, voting or other legal rights");
    expect(html).not.toMatch(/Pyth/);
    expect(html).not.toMatch(/undervalued|overvalued|opportunity|good entry/i);
  });

  it("shows an unavailable mark without inventing a price", () => {
    const html = text(renderToStaticMarkup(<AssetReferenceCard asset={prestocksAsset} state={{ status: "unavailable", message: "The PreStocks mark for this asset is unavailable right now." }} />));
    expect(html).toContain("UNAVAILABLE");
    expect(html).not.toContain("$");
  });
});
