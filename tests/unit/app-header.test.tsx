import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/components/wallet/wallet-auth-control", () => ({
  WalletAuthControl: ({ sessionWallet }: { sessionWallet: string | null }) => <span>{sessionWallet ? "signed-in-control" : "sign-in-control"}</span>,
}));
const { AppHeader, isNavItemActive, NAV_ITEMS } = await import("@/components/ui/app-header");

const render = (path: string, sessionWallet: string | null = "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV") => {
  pathname = path;
  return renderToStaticMarkup(<AppHeader cluster="mainnet-beta" sessionWallet={sessionWallet} />);
};
const link = (html: string, label: string) => html.match(new RegExp(`<a[^>]*>${label}</a>`))?.[0] ?? null;

describe("app header navigation", () => {
  beforeEach(() => {
    pathname = "/dashboard";
  });

  it("links the Circuit wordmark home on every page, with an accessible name", () => {
    for (const path of ["/", "/markets", "/dashboard", "/policies/new", "/policies/47d96f92-27fd-42b9-8cc5-9042fa35c82c"]) {
      const wordmark = render(path).match(/<a[^>]*aria-label="Circuit home"[^>]*>/)?.[0];
      expect(wordmark).toContain('href="/"');
    }
  });

  it("offers Dashboard, Markets and New policy as real links", () => {
    const html = render("/markets");
    expect(link(html, "Dashboard")).toContain('href="/dashboard"');
    expect(link(html, "Markets")).toContain('href="/markets"');
    expect(link(html, "New policy")).toContain('href="/policies/new"');
    expect(NAV_ITEMS.map((item) => item.label)).toEqual(["Dashboard", "Markets", "New policy"]);
    expect(html).not.toMatch(/>Policies</);
    expect(html).not.toMatch(/soon/);
  });

  it("marks exactly the current section with aria-current", () => {
    const current = (html: string) => [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(current(render("/dashboard"))).toEqual(["Dashboard"]);
    expect(current(render("/markets"))).toEqual(["Markets"]);
    expect(current(render("/policies/new"))).toEqual(["New policy"]);
    expect(current(render("/policies/47d96f92-27fd-42b9-8cc5-9042fa35c82c"))).toEqual(["Dashboard"]);
    expect(current(render("/"))).toEqual([]);
    expect(isNavItemActive(NAV_ITEMS[0]!, "/policies/new")).toBe(false);
  });

  it("renders the navigation when signed out, including on the landing page, without a wallet prompt there", () => {
    const signedOut = render("/dashboard", null);
    expect(link(signedOut, "Dashboard")).not.toBeNull();
    expect(signedOut).toContain("sign-in-control");
    const landing = render("/", null);
    expect(link(landing, "Dashboard")).not.toBeNull();
    expect(link(landing, "Markets")).not.toBeNull();
    expect(landing).not.toContain("sign-in-control");
    expect(landing).toMatch(/aria-expanded="false"[^>]*>Menu</);
  });
});
