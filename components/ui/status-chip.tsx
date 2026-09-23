import type { ReactNode } from "react";
import { cn } from "./cn";

export type ChipTone = "accent" | "success" | "warning" | "danger" | "info" | "muted";

const TONES: Record<ChipTone, string> = {
  accent: "text-accent bg-accent/12",
  success: "text-success bg-success/12",
  warning: "text-warning bg-warning/12",
  danger: "text-danger bg-danger/12",
  info: "text-info bg-info/12",
  muted: "text-muted bg-raised",
};

/** Policy lifecycle states (CIRCUIT_ARCHITECTURE.md §5.3) and their display tone. */
export const POLICY_STATUS_TONE = {
  DRAFT: "muted",
  ARMING: "accent",
  ARMED: "accent",
  EXECUTED: "success",
  CANCELLED: "muted",
  EXPIRED: "muted",
  FAILED: "danger",
} as const satisfies Record<string, ChipTone>;

export type PolicyStatus = keyof typeof POLICY_STATUS_TONE;

/** A compact state label. The text always carries the meaning; color only reinforces it. */
export function StatusChip({
  tone = "muted",
  className,
  children,
}: {
  tone?: ChipTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[5px] px-2 py-[3px] font-mono text-[11px] font-medium tracking-[0.04em] whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="size-[5px] shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
