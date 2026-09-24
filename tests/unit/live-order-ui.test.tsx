import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const WALLET = "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ publicKey: null, connected: false, signTransaction: undefined }),
}));
const { LiveOrderPanel, LiveOrderReview, depositAuthorizationText, REAL_TRANSACTION_WARNING } = await import("@/components/policy/live-order-panel");
const { SolscanLink, isRealSignature } = await import("@/components/policy/solscan-link");
type Props = Parameters<typeof LiveOrderPanel>[0];

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const SIG = "5".repeat(87);

const review: Props["review"] = {
  assetSymbol: "AAPLx",
  referenceProvider: "PYTH",
  amountDisplay: "25",
  amountSymbol: "USDC",
  referenceSymbol: "Equity.US.AAPL/USD",
  referenceUsd: "200.00",
  compiledTriggerUsd: "194.00",
  direction: "BELOW",
  slippageBps: 50,
  expiresAt: "2026-09-25T12:00:00.000Z",
  policyReference: "Pyth Equity.US.AAPL/USD",
  executionMonitor: "Jupiter AAPLx/USD",
  disclosure: "AAPLx is a secondary-market token and may trade at a premium or discount to underlying AAPL.",
};

function render(overrides: Partial<Props>) {
  const html = renderToStaticMarkup(
    <LiveOrderPanel
      policyId="00000000-0000-4000-8000-000000000001"
      sessionWallet={WALLET}
      status="DRAFT"
      providerOrderId={null}
      providerState={null}
      providerProgress={null}
      readiness={{ ready: true, message: null }}
      jupiterConnected
      review={review}
      live={null}
      {...overrides}
    />,
  );
  return { html, t: text(html) };
}

describe("live order review", () => {
  it("shows the exact authorization with Pyth, Circuit, Jupiter and vault clearly separated", () => {
    const t = text(renderToStaticMarkup(<LiveOrderReview review={review} vaultAddress={WALLET} />));
    for (const expected of [
      "LIVE ORDER",
      "Asset AAPLx",
      "Side BUY",
      "Input 25 USDC",
      "Trigger reference",
      "Equity.US.AAPL/USD",
      "Captured Pyth reference $200.00",
      "Compiled target",
      "$194.00",
      "sent to Jupiter unchanged",
      "Execution monitor",
      "Jupiter AAPLx/USD",
      "BELOW",
      "50 bps",
      "2026-09-25 12:00:00 UTC",
      "Jupiter vault 7nE9…UJHV",
      "may trade at a premium or discount to underlying AAPL",
      "Jupiter's trigger engine monitors AAPLx/USD, not Pyth",
    ]) {
      expect(t).toContain(expected);
    }
  });

  it("uses the required authorization wording", () => {
    expect(depositAuthorizationText("AAPLx")).toBe(
      "Signing this transaction authorizes the displayed USDC amount to be deposited into your Jupiter Trigger vault. If the subsequent order creation succeeds, Jupiter will monitor AAPLx/USD and execute under the policy shown above.",
    );
    expect(REAL_TRANSACTION_WARNING).toBe("This is a real Solana transaction and can move funds.");
  });
});

describe("live order review (PreStocks)", () => {
  it("says PreStocks provides the mark and Jupiter monitors the token's own price, with the fee caveat", () => {
    const prestocksReview: Props["review"] = {
      ...review,
      assetSymbol: "ANTHROPIC",
      referenceProvider: "PRESTOCKS",
      referenceSymbol: "ANTHROPIC",
      referenceUsd: "1000.00",
      compiledTriggerUsd: "970.00",
      disclosure: "The ANTHROPIC token may trade at a premium or discount to the PreStocks mark.",
      tokenNote: "Token-2022 transfer fee: 100 bps (1.00%).",
    };
    const t = text(renderToStaticMarkup(<LiveOrderReview review={prestocksReview} vaultAddress={WALLET} />));
    for (const expected of ["PreStocks mark (ANTHROPIC)", "Captured PreStocks mark $1,000.00", "$970.00", "Jupiter ANTHROPIC/USD", "premium or discount to the PreStocks mark", "PreStocks provides the reference mark", "transfer fee"]) {
      expect(t).toContain(expected);
    }
    expect(t).not.toMatch(/Pyth/);
    expect(depositAuthorizationText("ANTHROPIC")).toContain("Jupiter will monitor ANTHROPIC/USD");
  });
});

describe("live order panel states", () => {
  it("a blocked draft (e.g. Pyth not entitled) offers no live action at all", () => {
    const { html, t } = render({ readiness: { ready: false, message: "Live execution for this asset needs a verified live Pyth reference first." } });
    expect(t).toContain("needs a verified live Pyth reference");
    expect(html).not.toMatch(/<button/);
  });

  it("a ready draft starts with Prepare only; authorization is a separate later step", () => {
    const { html, t } = render({});
    expect(t).toContain("Step 1 · Prepare Jupiter deposit");
    expect(html).toMatch(/data-testid="prepare-deposit"/);
    expect(html).not.toMatch(/data-testid="authorize-deposit"/);
    expect(t).not.toContain("SIMULATED");
  });

  it("ARMING is a recoverable pending state with a real deposit link and no new authorization", () => {
    const { html, t } = render({ status: "ARMING", live: { depositPreparationId: "p", depositTxSignature: SIG, pendingWithdrawal: null } });
    expect(t).toContain("Jupiter order confirmation pending");
    expect(html).toContain(`https://solscan.io/tx/${SIG}`);
    expect(html).toMatch(/data-testid="reconcile"/);
    expect(html).not.toMatch(/data-testid="authorize-deposit"|Authorize deposit/);
    expect(t).toContain("Resubmit signed deposit (no new signature)");
  });

  it("ARMED shows LIVE / JUPITER TRIGGER with cancel & withdraw, never SIMULATED", () => {
    const { html, t } = render({ status: "ARMED", providerState: "OPEN", providerOrderId: "order-1" });
    expect(t).toContain("LIVE");
    expect(t).toContain("JUPITER TRIGGER");
    expect(t).toContain("Cancel & withdraw");
    expect(t).not.toContain("SIMULATED");
    expect(html).toMatch(/data-testid="reconcile"/);
  });

  it("EXECUTING shows provider-reported progress and is not called EXECUTED", () => {
    const { t } = render({ status: "ARMED", providerState: "EXECUTING", providerProgress: { inputUsed: "10000000", outputAmount: "2960000", fillPercent: "0.4" } });
    expect(t).toContain("EXECUTING");
    expect(t).toContain("0.4");
    expect(t).toContain("Provider-reported progress");
    expect(t).not.toContain("Cancel & withdraw"); // Jupiter only cancels open orders
  });

  it("a pending cancellation says funds need a withdrawal signature", () => {
    const { t } = render({
      status: "ARMED",
      providerState: "PENDING_WITHDRAW",
      live: { depositPreparationId: null, depositTxSignature: null, pendingWithdrawal: { id: "c", purpose: "CANCEL", status: "PREPARED", submitted: false } },
    });
    expect(t).toContain("Cancellation pending — withdrawal signature required.");
    expect(t).toContain("Order can no longer fill. Sign withdrawal to return unfilled funds.");
  });

  it("EXPIRED keeps funds visible in the vault until withdrawn; CANCELLED says they were returned", () => {
    const expired = render({ status: "EXPIRED", providerState: "EXPIRED" }).t;
    expect(expired).toContain("Order expired. Withdraw deposited funds.");
    expect(expired).toContain("Funds remain in your Jupiter vault until withdrawn.");
    expect(render({ status: "CANCELLED", providerState: "CANCELLED" }).t).toContain("Unfilled funds returned");
  });
});

describe("explorer links", () => {
  it("link only genuine signatures", () => {
    expect(isRealSignature(SIG)).toBe(true);
    for (const fake of ["mock_0123456789abcdef0123456789abcdef", "a1b2c3d4-e5f6-7890-abcd-ef1234567890", null, "", WALLET]) {
      expect(isRealSignature(fake)).toBe(false);
      expect(renderToStaticMarkup(<SolscanLink signature={fake} />)).toBe("");
    }
  });
});
