import { AppError } from "./errors.ts";
import {
  applyPercentChange,
  bpsToPercent,
  compareDecimals,
  formatTokenAmount,
  formatUsd,
  parsePositiveDecimal,
  roundToScale,
} from "./money.ts";

/**
 * Policy vocabulary and pure rules (CIRCUIT_ARCHITECTURE.md §5.3–5.4, §9, §17).
 * The database enums are generated from these lists, so they cannot drift.
 * No database, Pyth or Jupiter imports.
 */

export const POLICY_SIDES = ["BUY", "SELL"] as const;
export type PolicySide = (typeof POLICY_SIDES)[number];

export const TRIGGER_DIRECTIONS = ["ABOVE", "BELOW"] as const;
export type TriggerDirection = (typeof TRIGGER_DIRECTIONS)[number];

export const SOURCE_EXPRESSION_TYPES = ["ABSOLUTE_PRICE", "RELATIVE_PERCENT"] as const;
export type SourceExpressionType = (typeof SOURCE_EXPRESSION_TYPES)[number];

export const POLICY_STATUSES = [
  "DRAFT",
  "ARMING",
  "ARMED",
  "EXECUTED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** Statuses that exist only after the provider confirmed an order, so they require `provider_order_id`. */
export const PROVIDER_BACKED_STATUSES = ["ARMED", "EXECUTED", "EXPIRED"] as const satisfies readonly PolicyStatus[];

export const POLICY_EVENT_SOURCES = ["USER", "CIRCUIT", "JUPITER", "SOLANA", "SYSTEM"] as const;
export type PolicyEventSource = (typeof POLICY_EVENT_SOURCES)[number];

export const POLICY_EVENT_TYPES = {
  CREATED: "POLICY_CREATED",
  REFERENCE_CAPTURED: "REFERENCE_CAPTURED",
  COMPILED: "POLICY_COMPILED",
} as const;

export const DEFAULT_EXECUTION_PROVIDER = "jupiter_trigger_v2";

/** Structural bound only (0–100%). The product's form options are SLIPPAGE_BPS_OPTIONS. */
export const MAX_SLIPPAGE_BPS_CEILING = 10_000;

// ---------------------------------------------------------------------------
// State machine (§17)
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Readonly<Record<PolicyStatus, readonly PolicyStatus[]>> = {
  DRAFT: ["ARMING", "CANCELLED"],
  ARMING: ["ARMED", "FAILED"],
  ARMED: ["EXECUTED", "CANCELLED", "EXPIRED", "FAILED"],
  EXECUTED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: [],
};

export function canTransition(from: PolicyStatus, to: PolicyStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PolicyStatus, to: PolicyStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError("POLICY_STATE_CONFLICT", `A ${from} policy cannot become ${to}.`);
  }
}

export function isTerminalStatus(status: PolicyStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

// ---------------------------------------------------------------------------
// Product options for this milestone
// ---------------------------------------------------------------------------

/** Form choices. Jupiter's own bounds are verified in the Jupiter milestone. */
export const SLIPPAGE_BPS_OPTIONS = [25, 50, 100] as const;
export type SlippageBps = (typeof SLIPPAGE_BPS_OPTIONS)[number];

export const EXPIRY_HOURS_OPTIONS = [24, 72, 168] as const;
export type ExpiryHours = (typeof EXPIRY_HOURS_OPTIONS)[number];

export const POLICY_TYPES = [
  { key: "BUY_BELOW", side: "BUY", direction: "BELOW", label: "Buy below", hint: "Price falls to" },
  { key: "BUY_ABOVE", side: "BUY", direction: "ABOVE", label: "Buy above", hint: "Price rises to" },
  { key: "SELL_ABOVE", side: "SELL", direction: "ABOVE", label: "Sell above", hint: "Price rises to" },
  { key: "SELL_BELOW", side: "SELL", direction: "BELOW", label: "Sell below", hint: "Price falls to" },
] as const satisfies ReadonlyArray<{ key: string; side: PolicySide; direction: TriggerDirection; label: string; hint: string }>;

// ---------------------------------------------------------------------------
// Trigger compilation (§9)
// ---------------------------------------------------------------------------

/** Compiled triggers are whole cents. Jupiter's accepted precision is confirmed in the Jupiter milestone. */
export const TRIGGER_USD_SCALE = 2;
export const ABSOLUTE_PRICE_MAX_DECIMALS = 2;
export const RELATIVE_PERCENT_MAX_DECIMALS = 2;

export type ReferenceFreshnessLabel = "FRESH" | "CARRIED" | "STALE";

/** The minimum a compile needs from a reference: the price and how trustworthy it is. */
export interface CompileReference {
  priceUsd: string;
  freshness: ReferenceFreshnessLabel;
}

export type TriggerCondition = "AT_OR_BELOW" | "AT_OR_ABOVE";

export function triggerCondition(direction: TriggerDirection): TriggerCondition {
  return direction === "BELOW" ? "AT_OR_BELOW" : "AT_OR_ABOVE";
}

/**
 * Whether a reference may back a new draft.
 * - STALE: never. The context is unreliable, so no draft is created.
 * - CARRIED: absolute triggers only. Relative triggers never compile from a price carried forward from an earlier session.
 * - FRESH: always.
 */
export function assertReferenceUsable(freshness: ReferenceFreshnessLabel, expressionType: SourceExpressionType): void {
  if (freshness === "STALE") {
    throw new AppError(
      "REFERENCE_STALE",
      "The Pyth reference is older than Circuit's freshness limit, so no policy can be created right now. Refresh and try again.",
      { retryable: true },
    );
  }
  if (freshness === "CARRIED" && expressionType === "RELATIVE_PERCENT") {
    throw new AppError(
      "REFERENCE_STALE",
      "The Pyth reference is carried forward from an earlier session, so a % trigger can't be compiled from it. Use a fixed USD price, or wait for a fresh reference.",
      { retryable: true },
    );
  }
}

/**
 * Compiles the source expression into a fixed USD trigger.
 * - ABSOLUTE_PRICE: the entered price (at most 2 decimals), unchanged.
 * - RELATIVE_PERCENT: reference × (1 ∓ pct/100), rounded to cents in the
 *   stricter direction (BELOW → down, ABOVE → up), so rounding never makes
 *   the condition fire earlier than the user's expression.
 */
export function compileTriggerUsd({
  direction,
  expressionType,
  expressionValue,
  reference,
}: {
  direction: TriggerDirection;
  expressionType: SourceExpressionType;
  expressionValue: string;
  reference: CompileReference | null;
}): { sourceExpressionValue: string; compiledTriggerUsd: string } {
  if (expressionType === "ABSOLUTE_PRICE") {
    const price = parsePositiveDecimal(expressionValue, {
      label: "Trigger price",
      maxFractionDigits: ABSOLUTE_PRICE_MAX_DECIMALS,
    });
    return { sourceExpressionValue: price, compiledTriggerUsd: roundToScale(price, TRIGGER_USD_SCALE, "HALF_EVEN") };
  }

  const percent = parsePositiveDecimal(expressionValue, {
    label: "Trigger percentage",
    maxFractionDigits: RELATIVE_PERCENT_MAX_DECIMALS,
  });
  if (compareDecimals(percent, "100") >= 0) {
    throw new AppError("VALIDATION_ERROR", "Trigger percentage must be less than 100%.");
  }
  if (!reference) {
    throw new AppError("REFERENCE_UNAVAILABLE", "A % trigger needs a current Pyth reference.", { retryable: true });
  }
  assertReferenceUsable(reference.freshness, "RELATIVE_PERCENT");

  const raw = applyPercentChange(reference.priceUsd, percent, direction === "BELOW" ? "DECREASE" : "INCREASE");
  const compiled = roundToScale(raw, TRIGGER_USD_SCALE, direction === "BELOW" ? "DOWN" : "UP");
  if (compareDecimals(compiled, "0") <= 0) {
    throw new AppError("VALIDATION_ERROR", "That percentage compiles to a trigger of $0.00 or less.");
  }
  return { sourceExpressionValue: percent, compiledTriggerUsd: compiled };
}

/** True when the trigger condition already holds at the reference price, so the order could fill right away. */
export function isTriggerAlreadyMet(direction: TriggerDirection, triggerUsd: string, referenceUsd: string): boolean {
  const cmp = compareDecimals(referenceUsd, triggerUsd);
  return direction === "BELOW" ? cmp <= 0 : cmp >= 0;
}

// ---------------------------------------------------------------------------
// Plain-English review sentence (structured fields only, no free text)
// ---------------------------------------------------------------------------

export interface PolicySentenceInput {
  side: PolicySide;
  direction: TriggerDirection;
  assetSymbol: string;
  underlyingSymbol: string;
  quoteSymbol: string;
  amountDisplay: string;
  compiledTriggerUsd: string;
  expressionType: SourceExpressionType;
  expressionValue: string;
  referenceUsd: string | null;
}

export function describePolicy(input: PolicySentenceInput): string {
  const amount = formatTokenAmount(input.amountDisplay);
  const action =
    input.side === "BUY"
      ? `Buy up to ${amount} ${input.quoteSymbol} of ${input.assetSymbol}`
      : `Sell ${amount} ${input.assetSymbol} for ${input.quoteSymbol}`;
  const condition = input.direction === "BELOW" ? "falls to or below" : "rises to or above";
  const sentence = `${action} if the USD price ${condition} ${formatUsd(input.compiledTriggerUsd)} before expiry.`;
  if (input.expressionType !== "RELATIVE_PERCENT" || !input.referenceUsd) return sentence;
  const relation = input.direction === "BELOW" ? "below" : "above";
  return `${sentence} Compiled from ${input.expressionValue}% ${relation} the captured Pyth ${input.underlyingSymbol} reference of ${formatUsd(input.referenceUsd)}.`;
}

export function describeSlippage(bps: number): string {
  return `${bpsToPercent(bps)}%`;
}
