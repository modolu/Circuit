/**
 * Policy vocabulary from CIRCUIT_ARCHITECTURE.md §5.3–5.4 and §17.
 * The database enums are generated from these lists, so they cannot drift.
 * State-transition rules land here in Milestone 3.
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

export const DEFAULT_EXECUTION_PROVIDER = "jupiter_trigger_v2";

/** Structural bound only (0–100%). The product's allowed slippage range is decided in Milestone 3. */
export const MAX_SLIPPAGE_BPS_CEILING = 10_000;
