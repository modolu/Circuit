import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import { shortAddress } from "@/components/wallet/short-address";
import type { PublicAsset } from "@/src/domain/asset";
import type { PythReferenceSnapshot } from "@/src/domain/reference";
import { formatAge, formatSession, formatUsd } from "./format";

const FRESHNESS_TONE: Record<PythReferenceSnapshot["freshness"], ChipTone> = { FRESH: "success", CARRIED: "warning", STALE: "danger" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line py-2 last:border-b-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-right text-[13px]">{children}</dd>
    </div>
  );
}

/**
 * A supported public-equity asset on /markets: the live Pyth reference for the underlying
 * (never the token's own price), its freshness, and the recorded Jupiter checks. When Pyth
 * is unavailable the value slot says so; no earlier value is shown as current.
 */
export function PythMarketCard({
  asset,
  reference,
  jupiter,
}: {
  asset: PublicAsset;
  reference: PythReferenceSnapshot | null;
  jupiter: { tokenRecognized: boolean; routingVerified: boolean };
}) {
  const pair = asset.reference.symbol.replace(/^Equity\.[A-Z]+\./, "");
  return (
    <Card as="article" aria-labelledby={`market-${asset.symbol}`} className="flex flex-col border-accent/60 p-5" data-testid={`pyth-market-${asset.symbol}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>{asset.displayName}</SectionLabel>
          <h2 id={`market-${asset.symbol}`} className="mt-1 text-lg font-semibold">
            {asset.symbol}
          </h2>
        </div>
        <StatusChip tone="success">SUPPORTED</StatusChip>
      </div>
      <dl className="mt-3">
        <Row label="Reference">
          Pyth <span className="font-mono">{pair}</span>
        </Row>
        <Row label="Live reference">
          {reference ? <span className="font-mono">{formatUsd(reference.priceUsd)}</span> : <span className="text-muted">Unavailable right now</span>}
        </Row>
        {reference && (
          <Row label="Freshness">
            <span className="inline-flex flex-wrap items-center justify-end gap-2 font-mono text-[11px] text-muted">
              <StatusChip tone={FRESHNESS_TONE[reference.freshness]}>{reference.freshness}</StatusChip>
              {formatAge(reference.pyth.ageMs)} · {formatSession(reference.pyth.marketSession)}
            </span>
          </Row>
        )}
        <Row label="Jupiter">
          {jupiter.tokenRecognized ? "Token recognized" : "Token not verified"} · {jupiter.routingVerified ? "routing verified" : "routing not verified"}
        </Row>
        <Row label="Solana mint">
          <span className="font-mono" title={asset.mintAddress}>
            {shortAddress(asset.mintAddress)}
          </span>
        </Row>
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Pyth references the underlying {asset.underlyingSymbol} equity. Jupiter monitors the token&apos;s own {asset.symbol}/USD
        price, which may trade at a premium or discount.
      </p>
      <div className="mt-auto pt-4">
        <ButtonLink href={`/policies/new?asset=${asset.id}`} variant="primary">
          Create policy
        </ButtonLink>
      </div>
    </Card>
  );
}
