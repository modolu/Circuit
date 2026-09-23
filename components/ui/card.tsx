import type { ComponentProps } from "react";
import { cn } from "./cn";

type CardElement = "div" | "section" | "article" | "figure";

export function Card<T extends CardElement = "div">({
  as,
  className,
  ...props
}: { as?: T } & ComponentProps<T>) {
  const Element = (as ?? "div") as CardElement;
  return (
    <Element
      className={cn("rounded-[10px] border border-line bg-panel", className)}
      {...(props as ComponentProps<"div">)}
    />
  );
}
