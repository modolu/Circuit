import { cn } from "@/components/ui/cn";
import { formatUsdCents } from "@/src/domain/money";

/*
 * Neutral PreStocks price context: the PreStocks mark (reference), the token's market price,
 * and the premium or discount between them. Analysis/display only, never advice: no
 * "undervalued", "opportunity" or similar language anywhere.
 */

export const PRESTOCKS_DISCLOSURE =
  "PreStocks tokens provide economic exposure to private companies, not ownership, voting or other legal rights. Private-market exposure is risky and can result in total loss, the token market price may differ from the PreStocks mark, liquidity is not guaranteed, and availability is jurisdiction-restricted (not available to U.S. persons).";

/** "−1.39" → { label: "Discount to mark", value: "1.39%" }. Sign-aware, exact string handling. */
export function premiumLabel(premiumPercent: string | null): { label: string; value: string } | null {
  if (premiumPercent === null) return null;
  if (/^-?0(\.0+)?$/.test(premiumPercent)) return { label: "At mark", value: "0.00%" };
  return premiumPercent.startsWith("-")
    ? { label: "Discount to mark", value: `${premiumPercent.slice(1)}%` }
    : { label: "Premium to mark", value: `${premiumPercent}%` };
}

function Line({ term, children, className }: { term: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 border-b border-dashed border-line py-2.5 last:border-b-0", className)}>
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="text-right font-mono text-[13px]">{children}</dd>
    </div>
  );
}

export function PrestocksMarkSummary({
  markPriceUsd,
  tokenPriceUsd,
  premiumPercent,
}: {
  markPriceUsd: string;
  tokenPriceUsd: string | null;
  premiumPercent: string | null;
}) {
  const premium = premiumLabel(premiumPercent);
  return (
    <dl data-testid="prestocks-mark-summary">
      <Line term="PreStocks mark">{formatUsdCents(markPriceUsd)}</Line>
      <Line term="Token market price">{tokenPriceUsd ? formatUsdCents(tokenPriceUsd) : "Unavailable"}</Line>
      <Line term={premium?.label ?? "Premium / discount"}>{premium?.value ?? "Unavailable"}</Line>
    </dl>
  );
}
