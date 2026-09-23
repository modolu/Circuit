import type { QuoteToken } from "../config/tokens.ts";
import { AppError } from "../domain/errors.ts";
import { fromAtomicUnits, percentDifference, toAtomicUnits } from "../domain/money.ts";
import {
  assertReferenceUsable,
  compileTriggerUsd,
  EXPIRY_HOURS_OPTIONS,
  isTriggerAlreadyMet,
  SLIPPAGE_BPS_OPTIONS,
  triggerCondition,
  type CompileReference,
  type PolicySide,
  type SourceExpressionType,
  type TriggerCondition,
  type TriggerDirection,
} from "../domain/policy.ts";

/*
 * Deterministic policy compiler (CIRCUIT_ARCHITECTURE.md §9): same input, same
 * output, with no I/O and no clock reads. The output is Circuit-internal.
 * `orderFamily` and `triggerCondition` are NOT Jupiter wire fields; the Jupiter
 * integration maps them to the documented Trigger V2 request later.
 */

export interface CompileAsset {
  symbol: string;
  underlyingSymbol: string;
  mintAddress: string;
  decimals: number;
}

export interface CompilePolicyInput {
  asset: CompileAsset;
  quote: QuoteToken;
  side: PolicySide;
  triggerDirection: TriggerDirection;
  expressionType: SourceExpressionType;
  expressionValue: string;
  /** In the input token's display units: USDC for BUY, the stock token for SELL. */
  amount: string;
  maxSlippageBps: number;
  now: Date;
  expiresAt: Date;
  referenceSnapshot: CompileReference;
}

export type PolicyWarning = "TRIGGER_ALREADY_MET";

export interface CompiledPolicy {
  side: PolicySide;
  triggerDirection: TriggerDirection;
  expressionType: SourceExpressionType;
  sourceExpressionValue: string;
  compiledTriggerUsd: string;
  orderFamily: "SINGLE_PRICE_TRIGGER";
  triggerCondition: TriggerCondition;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  inputDecimals: number;
  inputAmountAtomic: bigint;
  inputAmountDisplay: string;
  slippageBps: number;
  expiresAt: Date;
  referenceUsd: string;
  distanceFromReferencePercent: string;
  warnings: PolicyWarning[];
}

const MAX_EXPIRY_MS = Math.max(...EXPIRY_HOURS_OPTIONS) * 60 * 60 * 1000;

export function compilePolicy(input: CompilePolicyInput): CompiledPolicy {
  if (!(SLIPPAGE_BPS_OPTIONS as readonly number[]).includes(input.maxSlippageBps)) {
    throw new AppError("VALIDATION_ERROR", `Max slippage must be one of ${SLIPPAGE_BPS_OPTIONS.join(", ")} bps.`);
  }
  const lifetimeMs = input.expiresAt.getTime() - input.now.getTime();
  if (lifetimeMs <= 0) throw new AppError("VALIDATION_ERROR", "Expiry must be in the future.");
  if (lifetimeMs > MAX_EXPIRY_MS) throw new AppError("VALIDATION_ERROR", "Expiry can be at most 7 days away.");

  assertReferenceUsable(input.referenceSnapshot.freshness, input.expressionType);
  const { sourceExpressionValue, compiledTriggerUsd } = compileTriggerUsd({
    direction: input.triggerDirection,
    expressionType: input.expressionType,
    expressionValue: input.expressionValue,
    reference: input.referenceSnapshot,
  });

  const buying = input.side === "BUY";
  const inputToken = buying
    ? { mint: input.quote.mintAddress, symbol: input.quote.symbol, decimals: input.quote.decimals }
    : { mint: input.asset.mintAddress, symbol: input.asset.symbol, decimals: input.asset.decimals };
  const outputToken = buying
    ? { mint: input.asset.mintAddress, symbol: input.asset.symbol }
    : { mint: input.quote.mintAddress, symbol: input.quote.symbol };
  if (inputToken.mint === outputToken.mint) throw new AppError("VALIDATION_ERROR", "Input and output tokens must differ.");

  const inputAmountAtomic = toAtomicUnits(input.amount, inputToken.decimals, buying ? "Budget" : "Amount to sell");
  const referenceUsd = input.referenceSnapshot.priceUsd;

  return {
    side: input.side,
    triggerDirection: input.triggerDirection,
    expressionType: input.expressionType,
    sourceExpressionValue,
    compiledTriggerUsd,
    orderFamily: "SINGLE_PRICE_TRIGGER",
    triggerCondition: triggerCondition(input.triggerDirection),
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    inputSymbol: inputToken.symbol,
    outputSymbol: outputToken.symbol,
    inputDecimals: inputToken.decimals,
    inputAmountAtomic,
    inputAmountDisplay: fromAtomicUnits(inputAmountAtomic, inputToken.decimals),
    slippageBps: input.maxSlippageBps,
    expiresAt: new Date(input.expiresAt.getTime()),
    referenceUsd,
    distanceFromReferencePercent: percentDifference(referenceUsd, compiledTriggerUsd),
    warnings: isTriggerAlreadyMet(input.triggerDirection, compiledTriggerUsd, referenceUsd) ? ["TRIGGER_ALREADY_MET"] : [],
  };
}
