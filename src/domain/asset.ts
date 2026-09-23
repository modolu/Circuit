import { z } from "zod";
import { PYTH_CHANNELS } from "../config/reference.ts";

/*
 * Asset catalog vocabulary (CIRCUIT_ARCHITECTURE.md §5.2, §27). Shared by the
 * curated config (src/config/assets.ts) and by code reading `assets.metadata`
 * back from the database, which is parsed rather than trusted.
 */

export const EXECUTION_STATUSES = ["PENDING_JUPITER_VERIFICATION", "VERIFIED"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** Circuit's primary reference: the independent underlying-equity feed, never the token's own market. */
export const primaryReferenceSchema = z.object({
  provider: z.literal("pyth_pro"),
  role: z.literal("underlying_equity"),
  symbol: z.string().regex(/^Equity\.[A-Z]+\.[A-Z.]+\/USD$/, "must be a Pyth equity symbol"),
  feedId: z.number().int().positive(),
  channel: z.enum(PYTH_CHANNELS),
  assetType: z.literal("equity"),
  description: z.string().min(1),
});

/** Optional feeds for comparison only (e.g. the tokenized stock's own market). Never used as the reference. */
export const comparisonFeedSchema = z.object({
  provider: z.literal("pyth_pro"),
  role: z.literal("token_market_comparison"),
  symbol: z.string().min(1),
  feedId: z.number().int().positive(),
  note: z.string().min(1),
});

/**
 * Execution-verification ladder for Jupiter Trigger V2 (Task 7). Each level is
 * recorded separately, so "Jupiter can swap it" is never mistaken for "Trigger V2
 * is proven end to end". Execution stays disabled until LIVE_TRIGGER_ORDER_VERIFIED.
 */
export const JUPITER_VERIFICATION_LEVELS = [
  "IDENTITY_VERIFIED",
  "JUPITER_TOKEN_RECOGNIZED",
  "SPOT_ROUTE_VERIFIED",
  "TOKEN_EXTENSIONS_COMPATIBLE",
  "TRIGGER_API_ACCESS_VERIFIED",
  "TRIGGER_DEPOSIT_CRAFT_VERIFIED",
  "LIVE_TRIGGER_ORDER_VERIFIED",
] as const;
export type JupiterVerificationLevel = (typeof JUPITER_VERIFICATION_LEVELS)[number];

export const VERIFICATION_RESULTS = ["PASSED", "FAILED", "RESTRICTED", "NOT_TESTED"] as const;

export const jupiterVerificationSchema = z.object({
  checkedAt: z.iso.datetime(),
  docsVersion: z.string().min(1),
  levels: z.record(
    z.enum(JUPITER_VERIFICATION_LEVELS),
    z.object({ result: z.enum(VERIFICATION_RESULTS), detail: z.string().min(1) }),
  ),
  sides: z.object({
    BUY: z.object({ result: z.enum(VERIFICATION_RESULTS), detail: z.string().min(1) }),
    SELL: z.object({ result: z.enum(VERIFICATION_RESULTS), detail: z.string().min(1) }),
  }),
});
export type JupiterVerification = z.infer<typeof jupiterVerificationSchema>;

/**
 * Circuit compiles triggers from the Pyth UNDERLYING price (e.g. AAPL), but Jupiter
 * evaluates them on the TOKEN's USD price (e.g. AAPLx, which has a ScaledUiAmount
 * multiplier). Live orders stay blocked until this relationship is deliberately
 * calibrated: no guessed conversion.
 */
export const executionPriceCalibrationSchema = z.object({
  status: z.enum(["REQUIRED", "CALIBRATED"]),
  detail: z.string().min(1),
});

export const assetMetadataSchema = z.object({
  reference: primaryReferenceSchema,
  comparisonFeeds: z.array(comparisonFeedSchema).default([]),
  execution: z.object({ status: z.enum(EXECUTION_STATUSES) }),
  // Live-execution evidence. Missing or malformed evidence reads as "not verified" (the
  // live gate fails closed) and never breaks reference reads that don't need it.
  jupiter: jupiterVerificationSchema.optional().catch(undefined),
  executionPriceCalibration: executionPriceCalibrationSchema.optional().catch(undefined),
  verification: z
    .object({ pythLiveCheck: z.object({ status: z.string() }).optional().catch(undefined) })
    .optional()
    .catch(undefined),
});

export type LiveBuyGateFailure =
  | "PYTH_LIVE_CHECK_REQUIRED"
  | "BUY_DEPOSIT_NOT_COMPATIBLE"
  | "EXECUTION_PRICE_CALIBRATION_REQUIRED";

/** Whether an asset may have a live Jupiter BUY deposit prepared. Missing evidence means no. */
export function liveBuyDepositGate(metadata: AssetMetadata): { ok: true } | { ok: false; reason: LiveBuyGateFailure } {
  if (metadata.verification?.pythLiveCheck?.status !== "PASSED") return { ok: false, reason: "PYTH_LIVE_CHECK_REQUIRED" };
  if (!metadata.jupiter || metadata.jupiter.sides.BUY.result === "RESTRICTED" || metadata.jupiter.sides.BUY.result === "FAILED") {
    return { ok: false, reason: "BUY_DEPOSIT_NOT_COMPATIBLE" };
  }
  if (metadata.executionPriceCalibration?.status !== "CALIBRATED") {
    return { ok: false, reason: "EXECUTION_PRICE_CALIBRATION_REQUIRED" };
  }
  return { ok: true };
}

export type PrimaryReference = z.infer<typeof primaryReferenceSchema>;
export type AssetMetadata = z.infer<typeof assetMetadataSchema>;

/** Public, client-safe view of a catalog asset. */
export interface PublicAsset {
  id: string;
  symbol: string;
  displayName: string;
  issuer: string;
  underlyingSymbol: string;
  mintAddress: string;
  decimals: number;
  reference: { provider: "pyth_pro"; symbol: string; configured: boolean };
  execution: { enabled: boolean; status: ExecutionStatus };
}
