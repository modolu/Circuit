import { Dec, fromAtomicUnits } from "../../domain/money.ts";
import type { PolicySide, ProviderOrderState, TriggerDirection } from "../../domain/policy.ts";
import type { CreateSinglePriceOrderRequest, DepositCraftRequest } from "./schemas.ts";

/*
 * Pure mapping from a compiled Circuit policy to Jupiter Trigger V2 single price
 * orders (docs verified 2026-09-23). No network, no signing.
 *
 * Semantics (Trigger V2 create-order docs):
 * - `triggerMint` is the token whose USD price is monitored. For Circuit it is always
 *   the stock token: the output on BUY, the input on SELL. This matches the documented
 *   examples (buy below: input USDC, triggerMint = output; sell above: triggerMint = input)
 *   and the trailing rules (below → triggerMint = inputMint, above → outputMint).
 * - Jupiter evaluates the trigger on the TOKEN's USD price from its own sources, not on
 *   Circuit's Pyth reference. Pyth informs the policy; it does not control execution.
 */

export const JUPITER_API_BASE_URL = "https://api.jup.ag";
export const JUPITER_TRIGGER_PATH = "/trigger/v2";

/** Provider constraint: every price order (deposit value) must be worth at least 10 USD. Drafts may be smaller. */
export const JUPITER_TRIGGER_MIN_ORDER_USD = "10";
/** Documented challenge and JWT lifetimes. There is no refresh endpoint. */
export const JUPITER_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const JUPITER_JWT_TTL_MS = 24 * 60 * 60 * 1000;
/** Documented slippage range. Circuit always sends its value explicitly, so the RTSE/2000 bps defaults never apply. */
export const JUPITER_SLIPPAGE_BPS_RANGE = { min: 0, max: 10_000 } as const;

export class JupiterMappingError extends Error {
  override readonly name = "JupiterMappingError";
}

/** Everything known when a Circuit policy compiles. Auth, deposit and signature values are added later. */
export interface JupiterSinglePriceOrderIntent {
  orderType: "single";
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  triggerMint: string;
  triggerCondition: "above" | "below";
  triggerPriceUsd: number;
  slippageBps: number;
  expiresAt: number;
}

export interface CompiledPolicyForJupiter {
  side: PolicySide;
  triggerDirection: TriggerDirection;
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: bigint;
  compiledTriggerUsd: string;
  slippageBps: number;
  expiresAt: Date;
}

const MAX_SAFE_TRIGGER_DIGITS = 15;

/**
 * Provider boundary: Trigger V2 types `triggerPriceUsd` as a JSON number. Circuit
 * keeps exact decimal strings everywhere else and converts only here. Refuses any
 * value whose number form would not round-trip exactly to the same decimal.
 */
export function toProviderPriceNumber(decimal: string): number {
  if (!/^\d+(\.\d+)?$/.test(decimal)) throw new JupiterMappingError("Trigger price must be a plain positive decimal.");
  const significant = decimal.replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
  if (significant.length > MAX_SAFE_TRIGGER_DIGITS) {
    throw new JupiterMappingError("Trigger price has more precision than a JSON number can carry exactly.");
  }
  const value = Number(decimal);
  if (!Number.isFinite(value) || value <= 0) throw new JupiterMappingError("Trigger price must be finite and positive.");
  if (!new Dec(String(value)).equals(new Dec(decimal))) {
    throw new JupiterMappingError("Trigger price does not round-trip exactly as a JSON number.");
  }
  return value;
}

/** Trigger V2 `expiresAt` is a Unix timestamp in milliseconds and must be in the future. */
export function toProviderExpiry(expiresAt: Date, now: Date): number {
  const ms = expiresAt.getTime();
  if (!Number.isSafeInteger(ms) || ms <= now.getTime()) throw new JupiterMappingError("expiresAt must be in the future.");
  return ms;
}

export function toJupiterSinglePriceOrderIntent(
  policy: CompiledPolicyForJupiter,
  { stockMint, quoteMint, now }: { stockMint: string; quoteMint: string; now: Date },
): JupiterSinglePriceOrderIntent {
  const expectedInput = policy.side === "BUY" ? quoteMint : stockMint;
  const expectedOutput = policy.side === "BUY" ? stockMint : quoteMint;
  if (policy.inputMint !== expectedInput || policy.outputMint !== expectedOutput) {
    throw new JupiterMappingError("Policy mints do not match its side.");
  }
  if (policy.inputMint === policy.outputMint) throw new JupiterMappingError("Input and output mints must differ.");
  if (policy.inputAmountAtomic <= 0n) throw new JupiterMappingError("Input amount must be positive.");
  if (!Number.isInteger(policy.slippageBps) || policy.slippageBps < JUPITER_SLIPPAGE_BPS_RANGE.min || policy.slippageBps > JUPITER_SLIPPAGE_BPS_RANGE.max) {
    throw new JupiterMappingError("Slippage must be 0–10000 bps.");
  }
  return {
    orderType: "single",
    inputMint: policy.inputMint,
    outputMint: policy.outputMint,
    inputAmount: policy.inputAmountAtomic.toString(),
    triggerMint: stockMint,
    triggerCondition: policy.triggerDirection === "ABOVE" ? "above" : "below",
    triggerPriceUsd: toProviderPriceNumber(policy.compiledTriggerUsd),
    slippageBps: policy.slippageBps,
    expiresAt: toProviderExpiry(policy.expiresAt, now),
  };
}

/** POST /deposit/craft body. The response is an UNSIGNED transaction the user's wallet signs later. */
export function toDepositCraftRequest(intent: JupiterSinglePriceOrderIntent, userAddress: string): DepositCraftRequest {
  return {
    inputMint: intent.inputMint,
    outputMint: intent.outputMint,
    userAddress,
    amount: intent.inputAmount,
    orderType: "price",
    orderSubType: "single",
  };
}

/** POST /orders/price body, completed with values that exist only after auth + deposit signing. */
export function toCreatePriceOrderRequest(
  intent: JupiterSinglePriceOrderIntent,
  later: { depositRequestId: string; depositSignedTx: string; userPubkey: string },
): CreateSinglePriceOrderRequest {
  return { ...intent, ...later };
}

/** USD value of an input amount at a given unit price; compared against the 10 USD provider minimum. */
export function meetsProviderMinimum({
  inputAmountAtomic,
  inputDecimals,
  inputUsdPrice,
}: {
  inputAmountAtomic: bigint;
  inputDecimals: number;
  inputUsdPrice: string;
}): { ok: boolean; usdValue: string } {
  const usdValue = new Dec(fromAtomicUnits(inputAmountAtomic, inputDecimals)).times(inputUsdPrice);
  return { ok: usdValue.greaterThanOrEqualTo(JUPITER_TRIGGER_MIN_ORDER_USD), usdValue: usdValue.toString() };
}

/**
 * Maps Jupiter `orderState` into Circuit's provider states.
 * - pending / executing / pending_withdraw are IN_PROGRESS: not terminal, so Circuit makes no change.
 * - expired leaves funds in the vault; they are recovered with the two-step cancel/withdraw flow.
 * - cancelled only appears after confirm-cancel has landed the withdrawal.
 */
export function normalizeJupiterOrderState(orderState: string): ProviderOrderState | "IN_PROGRESS" | "UNKNOWN" {
  switch (orderState) {
    case "open":
      return "OPEN";
    case "filled":
      return "FILLED";
    case "cancelled":
      return "CANCELLED";
    case "expired":
      return "EXPIRED";
    case "failed":
      return "FAILED";
    case "pending":
    case "executing":
    case "pending_withdraw":
      return "IN_PROGRESS";
    default:
      return "UNKNOWN";
  }
}
