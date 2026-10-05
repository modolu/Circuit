import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { SectionLabel } from "@/components/ui/section-label";
import { StatusChip } from "@/components/ui/status-chip";
import { WalletSignInPanel } from "@/components/wallet/wallet-sign-in-panel";
import { getSession } from "@/src/auth/session";

const STEPS = [
  { key: "01 DEFINE", body: "Asset, amount, trigger, slippage, expiry" },
  { key: "02 AUTHORIZE", body: "Your wallet approves bounded authority" },
  { key: "03 EXECUTE", body: "Autonomous execution while the browser is closed" },
  { key: "04 EVIDENCE", body: "Provider state + onchain receipt + audit trail" },
] as const;

const FLOW = [
  { layer: "User intent", detail: "you decide" },
  { layer: "Circuit policy", detail: "bounded · deterministic", highlight: true },
  { layer: "Reference + validation", detail: "Pyth equity reference · PreStocks mark" },
  { layer: "Trigger order", detail: "Jupiter Trigger V2" },
  { layer: "Onchain fill", detail: "Solana transaction" },
  { layer: "Audit trail", detail: "every transition logged", highlight: true },
] as const;

export default async function ConnectPage() {
  const session = await getSession();
  return (
    <main className="mx-auto grid w-full max-w-[1180px] items-center gap-12 px-4 py-14 sm:px-6 lg:min-h-[calc(100dvh-56px-60px)] lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:py-16">
      <div>
        <SectionLabel tone="accent" className="mb-[18px]">
          The policy layer for onchain capital markets
        </SectionLabel>
        <h1 className="text-[32px] leading-[1.08] font-semibold tracking-[-0.025em] sm:text-[44px]">
          Your investment decision.
          <br />
          <span className="text-accent">Bounded execution while you&apos;re away.</span>
        </h1>
        <p className="mt-5 mb-8 max-w-[460px] text-base leading-relaxed text-muted">
          Circuit turns a rule you choose into a deterministic execution policy with fixed capital, trigger, slippage,
          and expiry limits. The current wedge is tokenized stocks on Solana: Circuit captures external reference context,
          prepares execution through Jupiter Trigger, and keeps an auditable record of the lifecycle.
        </p>

        <WalletSignInPanel
          sessionWallet={session?.walletAddress ?? null}
          showDashboardLink
          extraAction={
            <ButtonLink href="/dashboard" size="lg">
              View dashboard
            </ButtonLink>
          }
        />

        <ol className="mt-10 grid grid-cols-2 gap-x-3 gap-y-5 border-t border-line pt-5 sm:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step.key} className="pr-3 text-xs leading-normal text-muted">
              <span className="mb-1 block font-mono font-medium tracking-[0.06em] text-text">
                {step.key}
              </span>
              {step.body}
            </li>
          ))}
        </ol>
      </div>

      <Card as="figure" className="relative overflow-hidden p-5 sm:p-6">
        <div aria-hidden="true" className="blueprint-grid pointer-events-none absolute inset-0" />
        <ol className="relative flex flex-col" aria-label="How a Circuit policy flows">
          {FLOW.map((node, index) => (
            <li key={node.layer}>
              {index > 0 && <div aria-hidden="true" className="flow-link" />}
              <div
                className={cn(
                  "flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3 text-[13px]",
                  "highlight" in node
                    ? "border-accent/50 bg-linear-to-r from-accent/12 to-panel-2"
                    : "border-line-strong bg-panel-2",
                )}
              >
                <span>{node.layer}</span>
                <span className="text-right font-mono text-[11px] text-muted">{node.detail}</span>
              </div>
            </li>
          ))}
        </ol>
        <figcaption className="relative mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4 text-xs text-muted">
          <StatusChip tone="muted">ARCHITECTURE</StatusChip>
          How a policy flows through Circuit. An illustration of the product flow, not a live transaction.
        </figcaption>
      </Card>
    </main>
  );
}
