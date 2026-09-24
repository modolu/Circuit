import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicAsset } from "@/src/domain/asset";
import { ANTHROPIC_MINT, prestocksSnapshot } from "../fixtures/references";

/*
 * AAPLx is a verified integration that stays NON-EXECUTABLE while this deployment's Pyth key
 * lacks US-equity access. It is shown from curated config (never seeded), never selectable
 * into the policy form, and never shown with a price.
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

let session: { walletAddress: string } | null = null;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/src/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/src/auth/session", () => ({ getSession: async () => session }));
vi.mock("@/src/services/list-assets", () => ({ listPublicAssets: async () => [anthropicAsset] }));
// Any Pyth call fails: PreStocks-referenced pages must not depend on Pyth.
vi.mock("@/src/integrations/pyth/client", () => ({
  getPythClient: () => {
    throw new Error("Pyth unavailable in this test");
  },
}));
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
vi.mock("@/src/services/get-reference", () => ({
  defaultReferenceClients: () => ({}),
  getAssetReference: async () => ({ asset: anthropicAsset, reference: prestocksSnapshot() }),
}));

const { pendingIntegrations, seedableAssets, seedBlocker, VERIFIED_ASSETS } = await import("@/src/config/assets");
const { default: MarketsPage } = await import("@/app/markets/page");
const { default: NewPolicyPage } = await import("@/app/policies/new/page");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const aaplx = VERIFIED_ASSETS.find((asset) => asset.symbol === "AAPLx")!;
const section = (html: string, testId: string) => {
  const start = html.indexOf(`data-testid="${testId}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start) + 10);
};
const newPolicyProps = (asset?: string) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(asset ? { asset } : {}) });

describe("pending integrations (curated config, never seeded)", () => {
  beforeEach(() => {
    session = null;
  });

  it("lists AAPLx as verified but reference-pending and disabled, without check details", () => {
    const [pending, ...rest] = pendingIntegrations(new Set([ANTHROPIC_MINT]));
    expect(rest).toEqual([]);
    expect(pending).toMatchObject({
      symbol: "AAPLx",
      underlyingSymbol: "AAPL",
      mintAddress: aaplx.mintAddress,
      referenceProvider: "PYTH",
      referencePair: "AAPL/USD",
      checks: { identity: true, mint: true, referenceMapping: true, jupiterToken: true, jupiterRouting: true },
      referenceAccess: "PENDING",
      execution: "DISABLED",
    });
    // No asset id to submit, and nothing internal (HTTP status, entitlement code) leaks into the view.
    expect(pending).not.toHaveProperty("id");
    expect(JSON.stringify(pending)).not.toMatch(/403|NOT_ENTITLED|entitle|key/i);
  });

  it("drops AAPLx once it is executable or its Pyth check passes", () => {
    expect(pendingIntegrations(new Set([aaplx.mintAddress]))).toEqual([]);
    if (aaplx.referenceProvider !== "PYTH") throw new Error("AAPLx must be Pyth-referenced");
    const passed = { ...aaplx, verification: { ...aaplx.verification, pythLiveCheck: { ...aaplx.verification.pythLiveCheck, status: "PASSED" as const } } };
    expect(pendingIntegrations(new Set(), [passed])).toEqual([]);
  });

  it("does not seed AAPLx or change its Pyth gate", () => {
    pendingIntegrations(new Set());
    if (aaplx.referenceProvider !== "PYTH") throw new Error("AAPLx must be Pyth-referenced");
    expect(aaplx.verification.pythLiveCheck.status).toBe("NOT_ENTITLED");
    expect(seedBlocker(aaplx)).not.toBeNull();
    expect(seedableAssets().map((asset) => asset.symbol)).toEqual(["ANTHROPIC"]);
  });
});

describe("/markets", () => {
  it("keeps ANTHROPIC supported and shows AAPLx as a non-executable public-market integration, with Pyth unavailable", async () => {
    const html = renderToStaticMarkup(await MarketsPage());
    const t = text(html);
    const supported = text(html.slice(html.indexOf('data-testid="supported-markets"'), html.indexOf('data-testid="public-market-integrations"')));
    expect(supported).toContain("ANTHROPIC");
    expect(supported).toContain("SUPPORTED");
    expect(html).toContain(`href="/policies/new?asset=${anthropicAsset.id}"`);

    expect(t).toContain("Public-market integrations");
    const card = section(html, "pending-integration-AAPLx");
    const c = text(card);
    for (const expected of ["AAPLx", "Apple xStock", "REFERENCE ACCESS PENDING", "Underlying AAPL", "Reference provider Pyth", "AAPL/USD", "Unavailable in this environment", "Circuit execution DISABLED", "Live Pyth equity reference PENDING", "Jupiter routing VERIFIED"]) {
      expect(c).toContain(expected);
    }
    expect(c).toContain("This deployment's Pyth access does not currently include the US-equity reference required for AAPLx, so Circuit keeps the asset disabled rather than using substitute or stale data.");
    // Non-executable, no substitute price, no internal language.
    expect(card).not.toMatch(/<a |<button|<form/);
    expect(c).not.toMatch(/\$\s?\d/);
    expect(c).not.toMatch(/UNSUPPORTED|READY|403|NOT_ENTITLED|Crypto\.AAPLX|API key/i);
  });
});

describe("/policies/new", () => {
  it("shows AAPLx as visible but unavailable, outside the form, with ANTHROPIC the only selectable asset", async () => {
    session = { walletAddress: "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV" };
    // Even an explicit request cannot select AAPLx: the form only offers executable database assets.
    const html = renderToStaticMarkup(await NewPolicyPage(newPolicyProps(aaplx.mintAddress)));
    const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
    expect(options).toEqual(["ANTHROPIC · Anthropic PreStocks"]);
    expect(html).toMatch(new RegExp(`<option[^>]*value="${anthropicAsset.id}"[^>]*selected`));

    const notice = html.slice(html.indexOf('data-testid="pending-integrations"'));
    const n = text(notice);
    expect(n).toContain("Other verified integrations");
    expect(n).toContain("AAPLx");
    expect(n).toContain("REFERENCE ACCESS PENDING");
    expect(n).toContain("Verified on Solana and Jupiter. The required Pyth AAPL reference is not available in this deployment.");
    expect(notice).not.toMatch(/<a |<button|<form|<input|<select/);
    expect(n).not.toMatch(/\$\s?\d|Create draft|Prepare Jupiter deposit|Arm/);
  });

  it("shows the same notice when signed out, with no form", async () => {
    session = null;
    const html = renderToStaticMarkup(await NewPolicyPage(newPolicyProps()));
    expect(html).not.toContain("<select");
    expect(text(html)).toContain("The required Pyth AAPL reference is not available in this deployment.");
  });
});
