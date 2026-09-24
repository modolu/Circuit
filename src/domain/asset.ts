import { z } from "zod";
import { PYTH_CHANNELS } from "../config/reference.ts";

/*
 * Asset catalog vocabulary (CIRCUIT_ARCHITECTURE.md §5.2, §27). Shared by the
 * curated config (src/config/assets.ts) and by code reading `assets.metadata`
 * back from the database, which is parsed rather than trusted.
 */

export const EXECUTION_STATUSES = ["PENDING_JUPITER_VERIFICATION", "VERIFIED"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/**
 * Reference providers (Task 10). The curated asset config decides which one an asset
 * uses; a request can never choose, and there is no fallback between providers.
 * - PYTH: the independent underlying public-equity feed (e.g. Equity.US.AAPL/USD).
 * - PRESTOCKS: PreStocks' first-party mark price for a private-company token.
 */
export const REFERENCE_PROVIDERS = ["PYTH", "PRESTOCKS"] as const;
export type ReferenceProvider = (typeof REFERENCE_PROVIDERS)[number];

/** Circuit's Pyth reference: the independent underlying-equity feed, never the token's own market. */
export const primaryReferenceSchema = z.object({
  provider: z.literal("pyth_pro"),
  role: z.literal("underlying_equity"),
  symbol: z.string().regex(/^Equity\.[A-Z]+\.[A-Z.]+\/USD$/, "must be a Pyth equity symbol"),
  feedId: z.number().int().positive(),
  channel: z.enum(PYTH_CHANNELS),
  assetType: z.literal("equity"),
  description: z.string().min(1),
});

/**
 * PreStocks mark reference. Identity and prices come only from first-party prestocks.com
 * sources; the contract address is the exact Solana mint (never derived from a ticker).
 */
export const prestocksReferenceSchema = z.object({
  provider: z.literal("prestocks"),
  role: z.literal("private_market_mark"),
  referenceType: z.literal("MARK_PRICE"),
  symbol: z.string().regex(/^[A-Z0-9]{1,20}$/),
  contractAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  apiUrl: z.url().refine((value) => value.startsWith("https://prestocks.com/"), "must be the first-party PreStocks API"),
  productUrl: z.url().refine((value) => /^https:\/\/(www\.)?prestocks\.com\//.test(value), "must be a prestocks.com product URL"),
  description: z.string().min(1),
});

export const assetReferenceConfigSchema = z.discriminatedUnion("provider", [primaryReferenceSchema, prestocksReferenceSchema]);
export type AssetReferenceConfig = z.infer<typeof assetReferenceConfigSchema>;

export function referenceProviderOf(config: AssetReferenceConfig): ReferenceProvider {
  return config.provider === "pyth_pro" ? "PYTH" : "PRESTOCKS";
}

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
 * Reference basis (Task 9): what Circuit's trigger number means on each side.
 *
 * - Circuit compiles the USD target from the INDEPENDENT Pyth underlying-equity reference
 *   (e.g. `Equity.US.AAPL/USD`).
 * - Jupiter Trigger monitors the TRIGGER TOKEN's own secondary-market USD price
 *   (e.g. AAPLx/USD) against that same number. The target is sent UNCHANGED
 *   (`triggerMapping: "IDENTITY"`): no ScaledUiAmount multiplier and no invented
 *   basis adjustment is applied. ScaledUiAmount changes displayed token quantities
 *   only; raw amounts are used for transactions, and the token's quoted USD price is
 *   already per displayed (share-equivalent) token.
 * - The token can trade at a premium or discount to the underlying, and Circuit must say
 *   so. Pyth never controls Jupiter's trigger engine.
 *
 * `RESOLVED` records that this decision (and its disclosure) is deliberate for the asset.
 * Missing or `UNRESOLVED` evidence blocks live deposits.
 */
export const referenceBasisSchema = z.object({
  status: z.enum(["RESOLVED", "UNRESOLVED"]),
  policyReference: z.string().min(1),
  executionMonitor: z.string().min(1),
  triggerMapping: z.literal("IDENTITY"),
  disclosure: z.string().min(1),
  detail: z.string().min(1),
});
export type ReferenceBasis = z.infer<typeof referenceBasisSchema>;

export const assetMetadataSchema = z.object({
  reference: assetReferenceConfigSchema,
  comparisonFeeds: z.array(comparisonFeedSchema).default([]),
  execution: z.object({ status: z.enum(EXECUTION_STATUSES) }),
  // Live-execution evidence. Missing or malformed evidence reads as "not verified" (the
  // live gate fails closed) and never breaks reference reads that don't need it.
  jupiter: jupiterVerificationSchema.optional().catch(undefined),
  referenceBasis: referenceBasisSchema.optional().catch(undefined),
  verification: z
    .object({
      pythLiveCheck: z.object({ status: z.string() }).optional().catch(undefined),
      prestocksLiveCheck: z.object({ status: z.string() }).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

export type LiveBuyGateFailure =
  | "PYTH_LIVE_CHECK_REQUIRED"
  | "PRESTOCKS_REFERENCE_CHECK_REQUIRED"
  | "BUY_DEPOSIT_NOT_COMPATIBLE"
  | "REFERENCE_BASIS_UNRESOLVED";

/** Whether an asset may have a live Jupiter BUY deposit prepared or armed. Missing evidence means no. */
export function liveBuyDepositGate(metadata: AssetMetadata): { ok: true } | { ok: false; reason: LiveBuyGateFailure } {
  // Each provider's own live reference check; a PreStocks asset never needs Pyth entitlement.
  if (metadata.reference.provider === "pyth_pro" && metadata.verification?.pythLiveCheck?.status !== "PASSED") {
    return { ok: false, reason: "PYTH_LIVE_CHECK_REQUIRED" };
  }
  if (metadata.reference.provider === "prestocks" && metadata.verification?.prestocksLiveCheck?.status !== "PASSED") {
    return { ok: false, reason: "PRESTOCKS_REFERENCE_CHECK_REQUIRED" };
  }
  if (!metadata.jupiter || metadata.jupiter.sides.BUY.result === "RESTRICTED" || metadata.jupiter.sides.BUY.result === "FAILED") {
    return { ok: false, reason: "BUY_DEPOSIT_NOT_COMPATIBLE" };
  }
  if (metadata.referenceBasis?.status !== "RESOLVED") {
    return { ok: false, reason: "REFERENCE_BASIS_UNRESOLVED" };
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
  /** The curated reference provider. `label` is presentation copy ("Pyth AAPL/USD", "PreStocks mark"). */
  reference: { provider: ReferenceProvider; symbol: string; label: string; configured: boolean };
  execution: { enabled: boolean; status: ExecutionStatus };
}
