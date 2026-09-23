import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "danger";
type Size = "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-[7px] border font-medium transition-[filter,border-color,background-color] duration-150 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const VARIANTS: Record<Variant, string> = {
  primary:
    "border-accent bg-accent text-on-accent hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100",
  secondary:
    "border-line-strong text-text hover:border-muted disabled:text-muted disabled:hover:border-line-strong",
  danger: "border-danger/35 text-danger hover:bg-danger/12",
};

const SIZES: Record<Size, string> = {
  md: "h-9 px-4 text-[13px]",
  lg: "h-11 px-5 text-sm",
};

interface StyleProps {
  variant?: Variant;
  size?: Size;
}

export function buttonClasses({ variant = "secondary", size = "md" }: StyleProps = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size]);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: StyleProps & ComponentProps<"button">) {
  return <button type={type} className={cn(buttonClasses({ variant, size }), className)} {...props} />;
}

export function ButtonLink({ variant, size, className, ...props }: StyleProps & ComponentProps<typeof Link>) {
  return <Link className={cn(buttonClasses({ variant, size }), className)} {...props} />;
}
