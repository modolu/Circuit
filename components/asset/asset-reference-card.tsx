import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import { shortAddress } from "@/components/wallet/short-address";
import type { PublicAsset } from "@/src/domain/asset";
import type { EquityReference, ReferenceFreshness } from "@/src/integrations/pyth/mapper";
import { formatAge, formatSession, formatUsd } from "./format";
import { RefreshReferenceButton } from "./refresh-reference-button";

export type ReferenceState =
  | { status: "available"; reference: EquityReference }
  | { status: "unavailable"; message: string };

const FRESHNESS_TONE: Record<ReferenceFreshness, ChipTone> = {
  FRESH: "success",
  CARRIED: "warning",
  STALE: "danger",
  UNAVAILABLE: "muted",
};

function freshnessNote(reference: EquityReference): string {
  switch (reference.freshness) {
    case "FRESH":
      return `Generated ${formatAge(reference.ageMs)}`;
    case "CARRIED":
      return `Carried forward from ${reference.feedUpdateTimestamp.replace("T", " ").slice(0, 19)} UTC. Not a new price.`;
    case "STALE":
      return `Last generated ${formatAge(reference.ageMs)}: older than Circuit's freshness limit.`;
  }
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line py-3 last:border-b-0">
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="text-right font-mono text-[13px]">{children}</dd>
    </div>
  );
}

/** One curated asset: the Pyth equity reference first, execution status clearly separate. */
export function AssetReferenceCard({ asset, state }: { asset: PublicAsset; state: ReferenceState }) {
  const reference = state.status === "available" ? state.reference : null;
  return (
    <Card as="article" aria-labelledby={`asset-${asset.id}`} className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <SectionLabel>{asset.displayName}</SectionLabel>
          <h3 id={`asset-${asset.id}`} className="mt-1 text-lg font-semibold">
            {asset.symbol}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip tone="info">REFERENCE VERIFIED</StatusChip>
          <StatusChip tone="muted">EXECUTION PENDING</StatusChip>
        </div>
      </header>

      <div className="grid gap-8 px-5 py-6 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
        <section aria-label="Pyth equity reference">
          <SectionLabel tone="accent">Pyth equity reference</SectionLabel>
          {reference ? (
            <>
              <p className="mt-3 font-mono text-[40px] leading-none font-medium tracking-[-0.02em]">
                {formatUsd(reference.priceUsd)}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                <StatusChip tone={FRESHNESS_TONE[reference.freshness]}>{reference.freshness}</StatusChip>
                <span className="font-mono text-xs text-muted">{freshnessNote(reference)}</span>
              </div>
              <dl className="mt-5">
                <Row term="Session">{formatSession(reference.marketSession)}</Row>
                <Row term="Reference feed">{reference.symbol}</Row>
                {reference.confidenceUsd && <Row term="Confidence">±{formatUsd(reference.confidenceUsd)}</Row>}
                {reference.publisherCount !== null && <Row term="Publishers">{reference.publisherCount}</Row>}
                <Row term="Feed updated">{reference.feedUpdateTimestamp.replace("T", " ").slice(0, 23)} UTC</Row>
              </dl>
            </>
          ) : (
            <>
              <p className="mt-3 font-mono text-[40px] leading-none text-dim" aria-label="No reference price">
                <span aria-hidden="true">—</span>
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                <StatusChip tone="muted">UNAVAILABLE</StatusChip>
                <span className="text-xs text-muted">{state.status === "unavailable" ? state.message : null}</span>
              </div>
              <dl className="mt-5">
                <Row term="Reference feed">{asset.reference.symbol}</Row>
              </dl>
            </>
          )}
        </section>

        <section aria-label="Asset and execution">
          <SectionLabel>Asset</SectionLabel>
          <dl className="mt-2">
            <Row term="Underlying">{asset.underlyingSymbol}</Row>
            <Row term="Issuer">{asset.issuer}</Row>
            <Row term="Verified mint">
              <span title={asset.mintAddress}>{shortAddress(asset.mintAddress)}</span>
            </Row>
            <Row term="Decimals">{asset.decimals}</Row>
          </dl>
          <SectionLabel className="mt-6">Execution</SectionLabel>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Jupiter Trigger compatibility is not verified yet, so policies cannot execute on this asset.
          </p>
        </section>
      </div>

      <footer className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="max-w-[560px] text-xs leading-relaxed text-muted">
          Pyth is Circuit&apos;s independent reference for the underlying equity. It informs policy checks; it does not
          control how Jupiter executes.
        </p>
        <RefreshReferenceButton />
      </footer>
    </Card>
  );
}
