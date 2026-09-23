import type { ReactNode } from "react";
import { cn } from "./cn";
import { SectionLabel } from "./section-label";

/**
 * A labelled headline figure: the Pyth reference, a compiled trigger, a fill.
 * Pass `value={null}` for an honest empty state; never pass placeholder numbers.
 */
export function ValueBlock({
  label,
  value,
  meta,
  emptyText = "Not available yet",
  emphasis = "default",
  className,
}: {
  label: string;
  value: ReactNode | null;
  meta?: ReactNode;
  emptyText?: string;
  emphasis?: "default" | "accent";
  className?: string;
}) {
  return (
    <div className={className}>
      <SectionLabel tone={emphasis === "accent" ? "accent" : "muted"}>{label}</SectionLabel>
      {value === null ? (
        <p className="mt-2 font-mono text-[28px] leading-none text-dim" aria-label={emptyText}>
          <span aria-hidden="true">—</span>
        </p>
      ) : (
        <p className={cn("mt-2 font-mono text-[28px] leading-none", emphasis === "accent" && "text-accent")}>
          {value}
        </p>
      )}
      <p className="mt-2 font-mono text-[11px] text-muted">{value === null ? emptyText : meta}</p>
    </div>
  );
}
