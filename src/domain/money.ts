import Decimal from "decimal.js";
import { AppError } from "./errors.ts";

/*
 * Exact money handling (CIRCUIT_ARCHITECTURE.md §18). Pure; safe on server and client.
 * - Token amounts: bigint atomic units; decimal strings at JSON boundaries.
 * - USD values: decimal strings; arithmetic through a local decimal.js clone.
 * - Slippage: integer basis points.
 * JavaScript `number` is never used for monetary arithmetic.
 */

/** Local constructor. The global Decimal config is never mutated. */
export const Dec = Decimal.clone({
  precision: 64,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -64,
  toExpPos: 64,
});
export type DecimalValue = InstanceType<typeof Dec>;

export type RoundingMode = "DOWN" | "UP" | "HALF_EVEN";

const ROUNDING: Record<RoundingMode, Decimal.Rounding> = {
  // Toward zero / away from zero. All USD values here are positive, so DOWN = floor and UP = ceiling.
  DOWN: Decimal.ROUND_DOWN,
  UP: Decimal.ROUND_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
};

/** Plain non-negative decimal: digits with an optional fraction. No signs, exponents or separators. */
const DECIMAL_TEXT = /^(0|[1-9]\d*)(\.\d+)?$/;

function invalid(message: string): AppError {
  return new AppError("VALIDATION_ERROR", message);
}

/**
 * Validates a user-entered positive decimal and returns its canonical form
 * (no leading zeros, no trailing fractional zeros). Never rounds.
 */
export function parsePositiveDecimal(input: string, { label, maxFractionDigits }: { label: string; maxFractionDigits: number }): string {
  const text = input.trim();
  if (!DECIMAL_TEXT.test(text)) throw invalid(`${label} must be a plain positive number, like 100 or 12.5.`);
  const [whole = "0", fraction = ""] = text.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  if (trimmedFraction.length > maxFractionDigits) {
    throw invalid(`${label} can have at most ${maxFractionDigits} decimal place${maxFractionDigits === 1 ? "" : "s"}.`);
  }
  if (/^0+$/.test(whole) && trimmedFraction === "") throw invalid(`${label} must be greater than zero.`);
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

/** "100" at 6 decimals → 100000000n. Rejects zero, negatives and excess precision; never rounds. */
export function toAtomicUnits(display: string, decimals: number, label = "Amount"): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw invalid("Token decimals are invalid.");
  const canonical = parsePositiveDecimal(display, { label, maxFractionDigits: decimals });
  const [whole = "0", fraction = ""] = canonical.split(".");
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** 100000000n at 6 decimals → "100". Exact, with trailing fractional zeros trimmed. */
export function fromAtomicUnits(atomic: bigint, decimals: number): string {
  const negative = atomic < 0n;
  const digits = (negative ? -atomic : atomic).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Rounds to `scale` fraction digits with an explicit mode and returns a fixed-scale string. */
export function roundToScale(value: DecimalValue | string, scale: number, mode: RoundingMode): string {
  return new Dec(value).toDecimalPlaces(scale, ROUNDING[mode]).toFixed(scale);
}

/** reference × (1 ± percent/100), exact and unrounded. */
export function applyPercentChange(reference: string, percent: string, change: "INCREASE" | "DECREASE"): DecimalValue {
  const factor = change === "INCREASE" ? new Dec(100).plus(percent) : new Dec(100).minus(percent);
  return new Dec(reference).times(factor).dividedBy(100);
}

/** (to − from) / from × 100, rounded half-even to `scale` places. For display only. */
export function percentDifference(from: string, to: string, scale = 2): string {
  const base = new Dec(from);
  if (base.isZero()) throw invalid("Reference price must be non-zero.");
  return roundToScale(new Dec(to).minus(base).dividedBy(base).times(100), scale, "HALF_EVEN");
}

export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  return new Dec(a).comparedTo(b) as -1 | 0 | 1;
}

/** 50 → "0.50". Integer maths only. */
export function bpsToPercent(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw invalid("Basis points must be a non-negative integer.");
  const value = BigInt(bps);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

/** "227.3" → "$227.30", "1234567.891" → "$1,234,567.891". Exact: string formatting only. */
export function formatUsd(decimal: string): string {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? decimal.slice(1) : decimal).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${fraction.padEnd(2, "0")}`;
}

/** "1234.5" → "1,234.5" for token amounts (no currency symbol, no padding). */
export function formatTokenAmount(decimal: string): string {
  const [whole = "0", fraction] = decimal.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}
