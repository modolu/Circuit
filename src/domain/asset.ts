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

export const assetMetadataSchema = z.object({
  reference: primaryReferenceSchema,
  comparisonFeeds: z.array(comparisonFeedSchema).default([]),
  execution: z.object({ status: z.enum(EXECUTION_STATUSES) }),
});

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
