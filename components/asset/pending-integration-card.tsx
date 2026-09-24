import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { StatusChip } from "@/components/ui/status-chip";
import { shortAddress } from "@/components/wallet/short-address";
import type { PendingIntegration } from "@/src/config/assets";

export const pendingReferenceExplanation = (symbol: string) =>
  `This deployment's Pyth access does not currently include the US-equity reference required for ${symbol}, so Circuit keeps the asset disabled rather than using substitute or stale data.`;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line py-2 last:border-b-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-right text-[13px]">{children}</dd>
    </div>
  );
}

function Check({ label, state }: { label: string; state: "VERIFIED" | "PENDING" | "DISABLED" }) {
  return (
    <li className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-[13px]">{label}</span>
      <StatusChip tone={state === "VERIFIED" ? "success" : state === "PENDING" ? "warning" : "muted"}>{state}</StatusChip>
    </li>
  );
}

const verified = (ok: boolean) => (ok ? "VERIFIED" : "PENDING");

/**
 * A verified-but-disabled integration (e.g. AAPLx while this deployment lacks Pyth US-equity
 * access). Discovery only: no price, no policy action. The reference value slot is explicitly
 * empty rather than filled with a token price, the Pyth crypto comparison feed or an old value.
 */
export function PendingIntegrationCard({ integration: a, className }: { integration: PendingIntegration; className?: string }) {
  return (
    <Card as="article" aria-labelledby={`pending-${a.symbol}`} className={className} data-testid={`pending-integration-${a.symbol}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <SectionLabel>{a.displayName}</SectionLabel>
          <h2 id={`pending-${a.symbol}`} className="mt-1 text-lg font-semibold">
            {a.symbol}
          </h2>
        </div>
        <StatusChip tone="warning">REFERENCE ACCESS PENDING</StatusChip>
      </div>
      <dl className="mt-3 px-5">
        <Row label="Underlying">{a.underlyingSymbol}</Row>
        <Row label="Reference provider">Pyth</Row>
        <Row label="Reference">
          <span className="font-mono">{a.referencePair}</span>
        </Row>
        <Row label="Reference value">
          <span className="text-muted">Unavailable in this environment</span>
        </Row>
        <Row label="Solana mint">
          <span className="font-mono" title={a.mintAddress}>
            {shortAddress(a.mintAddress)}
          </span>
        </Row>
      </dl>
      <ul className="mx-5 mt-3 rounded-lg border border-line bg-panel-2 px-3 py-1.5" aria-label={`${a.symbol} integration status`}>
        <Check label="Identity" state={verified(a.checks.identity)} />
        <Check label="Solana mint" state={verified(a.checks.mint)} />
        <Check label="Pyth mapping" state={verified(a.checks.referenceMapping)} />
        <Check label="Jupiter token" state={verified(a.checks.jupiterToken)} />
        <Check label="Jupiter routing" state={verified(a.checks.jupiterRouting)} />
        <Check label="Live Pyth equity reference" state={a.referenceAccess} />
        <Check label="Circuit execution" state={a.execution} />
      </ul>
      <p className="px-5 pt-3 pb-5 text-[11px] leading-relaxed text-muted">
        {pendingReferenceExplanation(a.symbol)}
      </p>
    </Card>
  );
}

/** Compact, non-interactive line for /policies/new: visible, never selectable into the form. */
export function PendingIntegrationNotice({ integrations }: { integrations: PendingIntegration[] }) {
  if (integrations.length === 0) return null;
  return (
    <section aria-labelledby="other-integrations" className="mt-5" data-testid="pending-integrations">
      <SectionLabel id="other-integrations">Other verified integrations</SectionLabel>
      <ul className="mt-2 grid gap-2">
        {integrations.map((a) => (
          <li key={a.mintAddress} className="rounded-lg border border-line bg-panel-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                <span className="font-semibold">{a.symbol}</span> <span className="text-muted">· {a.displayName}</span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                <StatusChip tone="warning">REFERENCE ACCESS PENDING</StatusChip>
                <StatusChip tone="muted">UNAVAILABLE</StatusChip>
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Verified on Solana and Jupiter. The required Pyth {a.underlyingSymbol} reference is not available in this deployment.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
