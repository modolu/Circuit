import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const WALLET = "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV";
const OTHER = "11111111111111111111111111111112";
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ publicKey: null, connected: false, connecting: false, signMessage: undefined }),
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({ useWalletModal: () => ({ setVisible: () => undefined }) }));
const { JupiterConnection, JupiterConnectionView, walletStateFor } = await import("@/components/jupiter/jupiter-connection");
type ViewProps = Parameters<typeof JupiterConnectionView>[0];

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const noop = () => undefined;
function render(overrides: Partial<ViewProps>) {
  const html = renderToStaticMarkup(
    <JupiterConnectionView
      sessionWallet={WALLET}
      view={{ kind: "not_connected" }}
      wallet={{ kind: "disconnected" }}
      busy={null}
      error={null}
      onRequestChallenge={noop}
      onSignChallenge={noop}
      onCancelChallenge={noop}
      onRegisterVault={noop}
      onDisconnectJupiter={noop}
      onRetryStatus={noop}
      {...overrides}
    />,
  );
  return { html, t: text(html) };
}
const isDisabled = (tag: string | null) => tag !== null && /\sdisabled=""/.test(tag);
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? null;

describe("walletStateFor", () => {
  const base = { sessionWallet: WALLET, connectedAddress: null, connected: false, connecting: false, canSignMessage: true };
  it("separates the wallet adapter from the Circuit session", () => {
    expect(walletStateFor(base)).toEqual({ kind: "disconnected" });
    expect(walletStateFor({ ...base, connecting: true })).toEqual({ kind: "connecting" });
    expect(walletStateFor({ ...base, connected: true, connectedAddress: OTHER })).toEqual({ kind: "mismatch", connectedAddress: OTHER });
    expect(walletStateFor({ ...base, connected: true, connectedAddress: WALLET, canSignMessage: false })).toEqual({ kind: "unsupported" });
    expect(walletStateFor({ ...base, connected: true, connectedAddress: WALLET })).toEqual({ kind: "ready" });
  });
});

describe("JupiterConnection", () => {
  it("separates Circuit sign-in, wallet, Jupiter auth and Jupiter vault, and starts with a read-only check", () => {
    const t = text(renderToStaticMarkup(<JupiterConnection sessionWallet={WALLET} />));
    for (const label of ["Circuit sign-in", "Wallet in this browser", "Jupiter auth", "Jupiter vault", "CHECKING"]) expect(t).toContain(label);
    expect(t).not.toMatch(/Sign Jupiter login|Set up Jupiter vault|Connect Jupiter/);
  });

  it("Circuit session + disconnected wallet: offers Connect wallet, not a Circuit sign-in, and no Jupiter action", () => {
    const { html, t } = render({ wallet: { kind: "disconnected" } });
    expect(button(html, "Connect wallet")).not.toBeNull();
    expect(t).toContain("You are signed in to Circuit as");
    expect(t).toContain("Connect the same wallet to authenticate with Jupiter");
    expect(t).not.toMatch(/Sign in to Circuit|Sign in with your wallet/);
    expect(t).not.toContain("Connect Jupiter");
    expect(t).toContain("Not connected");
  });

  it("Circuit session + matching wallet: offers Connect Jupiter", () => {
    const { html, t } = render({ wallet: { kind: "ready" } });
    const connect = button(html, "Connect Jupiter");
    expect(connect).not.toBeNull();
    expect(isDisabled(connect)).toBe(false);
    expect(t).not.toContain("Connect wallet");
    expect(t).toContain("does not transfer tokens or submit a transaction");
  });

  it("Circuit session + different wallet: shows the mismatch and blocks the challenge", () => {
    const { html, t } = render({ wallet: { kind: "mismatch", connectedAddress: OTHER } });
    expect(t).toContain("Jupiter authentication is only available for the wallet signed in to Circuit");
    expect(button(html, "Connect Jupiter")).toBeNull();
    expect(button(html, "Sign Jupiter login")).toBeNull();
  });

  it("blocks signing a pending challenge when the wallet disconnects or changes", () => {
    const challengeView = { kind: "challenge_ready" as const, challenge: "Sign this" };
    const disconnected = render({ view: challengeView, wallet: { kind: "disconnected" } });
    expect(isDisabled(button(disconnected.html, "Sign Jupiter login"))).toBe(true);
    expect(button(disconnected.html, "Connect wallet")).not.toBeNull();
    const mismatch = render({ view: challengeView, wallet: { kind: "mismatch", connectedAddress: OTHER } });
    expect(isDisabled(button(mismatch.html, "Sign Jupiter login"))).toBe(true);
    expect(isDisabled(button(render({ view: challengeView, wallet: { kind: "ready" } }).html, "Sign Jupiter login"))).toBe(false);
  });

  it("Jupiter authenticated: the existing authenticated states are unchanged", () => {
    const noVault = render({ view: { kind: "no_vault" }, wallet: { kind: "disconnected" } });
    expect(noVault.t).toContain("AUTHENTICATED · NO VAULT");
    expect(noVault.t).toContain("Authenticated (session lasts up to 24 hours)");
    expect(isDisabled(button(noVault.html, "Set up Jupiter vault"))).toBe(false);
    expect(noVault.t).not.toContain("Connect Jupiter");
    const ready = render({ view: { kind: "vault_ready", vaultPubkey: OTHER }, wallet: { kind: "ready" } });
    expect(ready.t).toContain("VAULT READY");
    expect(ready.t).toContain("Live deposits are authorized per policy on its page");
    expect(button(ready.html, "Disconnect Jupiter")).not.toBeNull();
  });

  it("a failed status check offers a retry instead of a dead end, and still gates on the wallet", () => {
    const { html, t } = render({ view: { kind: "unavailable", message: "Jupiter status is unavailable." }, wallet: { kind: "disconnected" } });
    expect(t).toContain("STATUS UNAVAILABLE");
    expect(button(html, "Check again")).not.toBeNull();
    expect(button(html, "Connect wallet")).not.toBeNull();
  });
});

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const read = (paths: string[]) => paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));

/** Server-side Jupiter surface (Tasks 8–9). The server verifies and forwards; it never signs. */
function serverSources() {
  return read([
    ...walk("src/services/jupiter"),
    ...walk("app/api/jupiter"),
    ...walk("app/api/policies/[policyId]/jupiter"),
    "src/auth/jupiter-session.ts",
    "app/api/_lib/jupiter-route.ts",
    "src/integrations/jupiter/client.ts",
    "src/integrations/jupiter/signed-transaction.ts",
  ]);
}

/** Browser-side Jupiter surface. */
function clientSources() {
  return read([...walk("components/jupiter"), "components/policy/live-order-panel.tsx", "components/policy/wallet-transaction.ts", "components/policy/policy-actions.tsx"]);
}

describe("live money boundary (Tasks 8–9)", () => {
  it("the server never signs, sends or holds keys, and never uses browser storage", () => {
    for (const { path, source } of serverSources()) {
      for (const forbidden of [/\.signTransaction\(/, /signAllTransactions/, /sendTransaction/, /sendRawTransaction/, /Keypair/, /secretKey/, /\.sign\(\[/, /localStorage/, /sessionStorage/]) {
        expect(`${path}: ${forbidden.test(source)}`).toBe(`${path}: false`);
      }
    }
  });

  it("the browser signs only on the two explicit actions and never auto-sends", () => {
    for (const { path, source } of clientSources()) {
      for (const forbidden of [/sendTransaction/, /sendRawTransaction/, /signAllTransactions/, /localStorage/, /sessionStorage/, /JUPITER_API_KEY|x-api-key/]) {
        expect(`${path}: ${forbidden.test(source)}`).toBe(`${path}: false`);
      }
    }
    const panel = readFileSync("components/policy/live-order-panel.tsx", "utf8");
    // No effects that could fire a signature on load, refresh or reconcile.
    expect(/useEffect/.test(panel)).toBe(false);
    const calls = [...panel.matchAll(/signPreparedTransaction\(/g)].length;
    expect(calls).toBe(2);
    const authorize = panel.slice(panel.indexOf("const authorize = "), panel.indexOf("const resubmit = "));
    const withdraw = panel.slice(panel.indexOf("const confirmWithdrawal = "), panel.indexOf("const retryWithdrawal = "));
    expect(authorize).toContain("signPreparedTransaction(");
    expect(withdraw).toContain("signPreparedTransaction(");
    expect(panel).toMatch(/onClick=\{authorize\}/);
    expect(panel).toMatch(/onClick=\{confirmWithdrawal\}/);
    expect(readFileSync("components/jupiter/jupiter-connection.tsx", "utf8")).not.toMatch(/signTransaction/);
  });

  it("the safe live probe never crafts, creates, cancels or signs", () => {
    const probe = readFileSync("tests/live/jupiter.live.test.ts", "utf8");
    for (const forbidden of [/craftDeposit/, /createPriceOrder/, /initiatePriceOrderCancel/, /confirmPriceOrderCancel/, /registerVault/, /signTransaction/, /\.sign\(/]) {
      expect(forbidden.test(probe)).toBe(false);
    }
  });
});
