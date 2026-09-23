import type { ComponentProps } from "react";
import { cn } from "./cn";

/**
 * Small uppercase label for technical sections. Uses `muted` rather than the
 * mockup's `dim` so 11px text keeps an accessible contrast ratio.
 */
export function SectionLabel({
  tone = "muted",
  className,
  ...props
}: { tone?: "muted" | "accent" } & ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-[11px] font-medium tracking-[0.1em] uppercase",
        tone === "accent" ? "text-accent" : "text-muted",
        className,
      )}
      {...props}
    />
  );
}
