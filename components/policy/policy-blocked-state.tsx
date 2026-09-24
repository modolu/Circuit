import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { StatusChip } from "@/components/ui/status-chip";
import { shortAddress } from "@/components/wallet/short-address";

export interface ConfiguredAssetStatus {
  symbol: string;
  displayName: string;
  mintAddress: string;
  /** "Pyth mapping" or "PreStocks mark mapping". */
  referenceLabel: string;
  /** e.g. "Equity.US.AAPL/USD · feed 922" or "ANTHROPIC · prestocks.com API". */
  referenceDetail: string;
  liveReferenceAccess: string;
  /** Jupiter Tokens V2 recognition plus a quote-only spot route. Not proof of Trigger execution. */
  jupiterRoutingVerified: boolean;
  executionVerified: boolean;
}

function Check({ label, detail, state }: { label: string; detail?: string; state: "verified" | "pending" }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-dashed border-line py-3 last:border-b-0">
      <span>
        <span className="block text-[13px]">{label}</span>
        {detail && <span className="mt-0.5 block font-mono text-[11px] text-muted">{detail}</span>}
      </span>
      {state === "verified" ? (
        <StatusChip tone="success">VERIFIED</StatusChip>
      ) : (
        <StatusChip tone="warning">PENDING</StatusChip>
      )}
    </li>
  );
}

/** Shown when no asset has a live, usable reference. Honest product state, not an error page. */
export function PolicyBlockedState({ configured }: { configured: ConfiguredAssetStatus[] }) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_400px]">
      <Card as="section" aria-labelledby="blocked-heading" className="p-5 sm:p-8">
        <SectionLabel>Policy creation</SectionLabel>
        <h2 id="blocked-heading" className="mt-3 text-lg font-semibold sm:text-xl">
          No reference-enabled stock is available yet.
        </h2>
        <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-muted">
          No curated asset currently has a live, usable reference in this environment (for example, AAPLx needs a
          Pyth key with US-equity entitlement). Circuit will not compile or arm a policy without its reference.
        </p>

        {configured.map((asset) => (
          <div key={asset.mintAddress} className="mt-6 rounded-lg border border-line bg-panel-2 px-4 py-1">
            <div className="flex items-baseline justify-between gap-3 border-b border-line py-3">
              <span className="font-semibold">{asset.symbol}</span>
              <span className="text-xs text-muted">{asset.displayName}</span>
            </div>
            <ul>
              <Check label="Solana mint verified" detail={shortAddress(asset.mintAddress)} state="verified" />
              <Check label={`${asset.referenceLabel} verified`} detail={asset.referenceDetail} state="verified" />
              <Check label="Live reference access" state={asset.liveReferenceAccess === "PASSED" ? "verified" : "pending"} />
              <Check
                label="Jupiter token & routing verified"
                detail="Tokens API recognized · spot route found"
                state={asset.jupiterRoutingVerified ? "verified" : "pending"}
              />
              <Check label="Live Jupiter Trigger order" state={asset.executionVerified ? "verified" : "pending"} />
            </ul>
          </div>
        ))}
      </Card>

      <Card as="section" aria-label="Policy review" className="lg:sticky lg:top-[76px]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <SectionLabel>Policy review</SectionLabel>
          <StatusChip tone="muted">UNAVAILABLE</StatusChip>
        </div>
        <div className="px-5 py-4">
          <SectionLabel tone="accent">Reference</SectionLabel>
          <p className="mt-2 font-mono text-[28px] leading-none text-dim" aria-label="No reference">
            <span aria-hidden="true">—</span>
          </p>
          <p className="mt-2 text-xs text-muted">Waiting for live reference access.</p>
        </div>
        <div className="border-t border-line px-5 py-4 text-xs leading-relaxed text-muted">
          Policies compile only from a verified asset with a live reference (Pyth for public equities, the PreStocks
          mark for private-company tokens). Once one is available, this page becomes the policy form.
        </div>
      </Card>
    </div>
  );
}
