import Link from "next/link";
import { formatUtc } from "@/components/asset/format";
import { Card } from "@/components/ui/card";
import { POLICY_STATUS_TONE, StatusChip } from "@/components/ui/status-chip";
import { formatUsd } from "@/src/domain/money";
import type { PolicyView } from "@/src/services/policy-view";

/** The signed-in wallet's own policies (already scoped by the caller's query). */
export function PolicyList({ policies }: { policies: PolicyView[] }) {
  return (
    <Card as="section" aria-label="Your policies" className="overflow-hidden">
      <ul>
        {policies.map((policy) => (
          <li key={policy.id} className="border-b border-line last:border-b-0">
            <Link
              href={`/policies/${policy.id}`}
              className="grid gap-2 px-5 py-4 transition-colors hover:bg-panel-2 sm:grid-cols-[140px_1fr_auto] sm:items-center sm:gap-5"
            >
              <span>
                <span className="block font-semibold">{policy.asset.symbol}</span>
                <span className="font-mono text-[11px] text-muted">{policy.id.slice(0, 8)}</span>
              </span>
              <span className="font-mono text-[13px]">
                {policy.side === "BUY" ? "Buy" : "Sell"} {policy.triggerDirection === "BELOW" ? "≤" : "≥"}{" "}
                {formatUsd(policy.compiledTriggerUsd)}
                <span className="mt-0.5 block text-[11px] text-muted">
                  {policy.amount.display} {policy.amount.symbol} · expires {formatUtc(policy.expiresAt)}
                </span>
              </span>
              <StatusChip tone={POLICY_STATUS_TONE[policy.status]} className="justify-self-start sm:justify-self-end">
                {policy.status}
              </StatusChip>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
