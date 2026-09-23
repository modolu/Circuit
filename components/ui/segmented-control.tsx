"use client";

import { cn } from "./cn";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** An accessible radio group styled as the mockup's segmented buttons. */
export function SegmentedControl<T extends string | number>({
  name,
  legend,
  options,
  value,
  onChange,
  columns = options.length,
  describedBy,
}: {
  name: string;
  legend: string;
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  columns?: number;
  describedBy?: string;
}) {
  return (
    <fieldset aria-describedby={describedBy}>
      <legend className="mb-2 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">{legend}</legend>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          const checked = option.value === value;
          return (
            <label
              key={String(option.value)}
              htmlFor={id}
              className={cn(
                "relative flex cursor-pointer flex-col justify-center rounded-[7px] border px-3 py-2.5 text-xs transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                checked ? "border-accent bg-accent/12 text-text" : "border-line-strong bg-panel-2 text-muted hover:border-muted",
                option.disabled && "cursor-not-allowed opacity-40 hover:border-line-strong",
                option.hint ? "text-left" : "text-center",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={String(option.value)}
                checked={checked}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className={cn("text-[13px] font-medium", checked ? "text-text" : "text-text/90")}>{option.label}</span>
              {option.hint && <span className="mt-0.5">{option.hint}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
