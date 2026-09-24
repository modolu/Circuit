import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/src/domain/errors";
import type { PublicAsset } from "@/src/domain/asset";
import { ANTHROPIC_MINT, prestocksSnapshot, pythSnapshot } from "../fixtures/references";

/*
 * AAPLx's Pyth US-equity check PASSED (2026-09-24), so it is an executable, seeded asset:
 * a normal supported card on /markets and a selectable asset on /policies/new. The pending
 * presentation remains for an environment whose key lacks equity access (NOT_ENTITLED).
 */

const anthropicAsset: PublicAsset = {
  id: "00000000-0000-4000-8000-0000000000a1",
  symbol: "ANTHROPIC",
  displayName: "Anthropic PreStocks",
  issuer: "PreStocks",
  underlyingSymbol: "Anthropic",
  mintAddress: ANTHROPIC_MINT,
  decimals: 9,
  reference: { provider: "PRESTOCKS", symbol: "ANTHROPIC", label: "PreStocks mark", configured: true },
  execution: { enabled: false, status: "PENDING_JUPITER_VERIFICATION" },
};
const aaplxAsset: PublicAsset = {
  id: "00000000-0000-4000-8000-0000000000b2",
  symbol: "AAPLx",
  displayName: "Apple xStock",
  issuer: "xStocks by Backed",
  underlyingSymbol: "AAPL",
  mintAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  decimals: 8,
  reference: { provider: "PYTH", symbol: "Equity.US.AAPL/USD", label: "Pyth AAPL/USD", configured: true },
  execution: { enabled: false, status: "PENDING_JUPITER_VERIFICATION" },
};

let session: { walletAddress: string } | null = null;
let pythAvailable = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/src/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/src/auth/session", () => ({ getSession: async () => session }));
vi.mock("@/src/services/list-assets", () => ({ listPublicAssets: async () => [anthropicAsset, aaplxAsset] }));
vi.mock("@/src/integrations/prestocks/client", () => ({ getPrestocksClient: () => ({}) }));
vi.mock("@/src/services/prestocks-markets", () => ({
  listPrestocksMarkets: async () => ({
    status: "available",
    receivedAt: "2026-09-24T06:40:00.000Z",
    rejectedCount: 0,
    rows: [
      {
        name: "Anthropic",
        symbol: "ANTHROPIC",
        contractAddress: ANTHROPIC_MINT,
        productUrl: "https://www.prestocks.com/anthropic",
        markPriceUsd: "1000",
        tokenPriceUsd: "1020",
        premiumPercent: "2.00",
        support: { state: "SUPPORTED", detail: "Supported by Circuit." },
        assetId: anthropicAsset.id,
      },
    ],
  }),
}));
// Each asset's own provider; Pyth can be switched off to prove PreStocks does not depend on it.
vi.mock("@/src/services/get-reference", () => ({
  defaultReferenceClients: () => ({}),
  getAssetReference: async (_db: unknown, assetId: string) => {
    if (assetId === anthropicAsset.id) return { asset: anthropicAsset, reference: prestocksSnapshot() };
    if (!pythAvailable) throw new AppError("REFERENCE_UNAVAILABLE", "The Pyth reference for this asset is unavailable right now.");
    return { asset: aaplxAsset, reference: pythSnapshot({ priceUsd: "338.23" }, { symbol: "Equity.US.AAPL/USD", marketSession: "regular" }) };
  },
}));

const { pendingIntegrations, seedableAssets, VERIFIED_ASSETS } = await import("@/src/config/assets");
const { PendingIntegrationCard } = await import("@/components/asset/pending-integration-card");
const { default: MarketsPage } = await import("@/app/markets/page");
const { default: NewPolicyPage } = await import("@/app/policies/new/page");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const aaplx = VERIFIED_ASSETS.find((asset) => asset.symbol === "AAPLx")!;
const card = (html: string, testId: string) => {
  const start = html.indexOf(`data-testid="${testId}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start) + 10);
};
const newPolicyProps = (asset?: string) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(asset ? { asset } : {}) });
const notEntitled = () => {
  if (aaplx.referenceProvider !== "PYTH") throw new Error("AAPLx must be Pyth-referenced");
  return { ...aaplx, verification: { ...aaplx.verification, pythLiveCheck: { ...aaplx.verification.pythLiveCheck, status: "NOT_ENTITLED" as const } } };
};

beforeEach(() => {
  session = null;
  pythAvailable = true;
});

describe("AAPLx production config", () => {
  it("is seedable and no longer a pending integration", () => {
    expect(seedableAssets().map((asset) => asset.symbol)).toEqual(["AAPLx", "ANTHROPIC"]);
    expect(pendingIntegrations(new Set())).toEqual([]);
    expect(pendingIntegrations(new Set([ANTHROPIC_MINT]))).toEqual([]);
  });
});

describe("pending integration (environment without Pyth equity access)", () => {
  it("lists a NOT_ENTITLED AAPLx as verified but reference-pending and disabled, without check details", () => {
    const [pending, ...rest] = pendingIntegrations(new Set([ANTHROPIC_MINT]), [notEntitled()]);
    expect(rest).toEqual([]);
    expect(pending).toMatchObject({
      symbol: "AAPLx",
      referencePair: "AAPL/USD",
      checks: { identity: true, mint: true, referenceMapping: true, jupiterToken: true, jupiterRouting: true },
      referenceAccess: "PENDING",
      execution: "DISABLED",
    });
    expect(pending).not.toHaveProperty("id");
    expect(JSON.stringify(pending)).not.toMatch(/403|NOT_ENTITLED|entitle|key/i);
    // Not pending once executable.
    expect(pendingIntegrations(new Set([aaplx.mintAddress]), [notEntitled()])).toEqual([]);
  });

  it("renders no price and no action", () => {
    const [pending] = pendingIntegrations(new Set(), [notEntitled()]);
    const html = renderToStaticMarkup(<PendingIntegrationCard integration={pending!} />);
    const c = text(html);
    expect(c).toContain("REFERENCE ACCESS PENDING");
    expect(c).toContain("Unavailable in this environment");
    expect(c).toContain("Circuit execution DISABLED");
    expect(html).not.toMatch(/<a |<button|<form/);
    expect(c).not.toMatch(/\$\s?\d|403|NOT_ENTITLED|Crypto\.AAPLX|API key/i);
  });
});

describe("/markets", () => {
  it("shows ANTHROPIC and AAPLx as supported, AAPLx with its live Pyth AAPL reference and no pending card", async () => {
    const html = renderToStaticMarkup(await MarketsPage());
    const t = text(html);
    expect(html).not.toContain("pending-integration-");
    expect(t).not.toContain("REFERENCE ACCESS PENDING");
    expect(html).toContain(`href="/policies/new?asset=${anthropicAsset.id}"`);

    const c = text(card(html, "pyth-market-AAPLx"));
    for (const expected of ["AAPLx", "SUPPORTED", "Reference Pyth AAPL/USD", "$338.23", "FRESH", "Regular", "Token recognized · routing verified"]) {
      expect(c).toContain(expected);
    }
    expect(c).not.toMatch(/PreStocks|Crypto\.AAPLX/);
    expect(html).toContain(`href="/policies/new?asset=${aaplxAsset.id}"`);
  });

  it("keeps ANTHROPIC supported when Pyth is unavailable, and shows no AAPL value rather than an old one", async () => {
    pythAvailable = false;
    const html = renderToStaticMarkup(await MarketsPage());
    expect(text(card(html, "supported-markets"))).toMatch(/ANTHROPIC[\s\S]*SUPPORTED/);
    const c = text(card(html, "pyth-market-AAPLx"));
    expect(c).toContain("Unavailable right now");
    expect(c).not.toMatch(/\$\s?\d/);
  });
});

describe("/policies/new", () => {
  it("offers ANTHROPIC and AAPLx; AAPLx shows the Pyth reference and the Jupiter execution monitor, with no PreStocks wording", async () => {
    session = { walletAddress: "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV" };
    const html = renderToStaticMarkup(await NewPolicyPage(newPolicyProps(aaplxAsset.id)));
    const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
    expect(options).toEqual(["ANTHROPIC · Anthropic PreStocks", "AAPLx · Apple xStock"]);
    expect(html).toMatch(new RegExp(`<option[^>]*value="${aaplxAsset.id}"[^>]*selected`));

    const t = text(html.replace(/<select[\s\S]*?<\/select>/, ""));
    for (const expected of ["Pyth equity reference", "$338.23", "FRESH", "Regular", "Reference Pyth AAPL/USD", "Execution monitor Jupiter AAPLx/USD", "% from current reference"]) {
      expect(t).toContain(expected);
    }
    expect(t).not.toContain("PreStocks");
    // A FRESH reference leaves relative triggers enabled; no pending notice remains.
    expect(html).not.toMatch(/<input[^>]*value="RELATIVE_PERCENT"[^>]*disabled/);
    expect(html).not.toContain("pending-integrations");
  });

  it("signed out: no form and no stale pending notice", async () => {
    const html = renderToStaticMarkup(await NewPolicyPage(newPolicyProps()));
    expect(html).not.toContain("<select");
    expect(html).not.toContain("pending-integrations");
  });
});
