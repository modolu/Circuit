import { z } from "zod";

/**
 * The curated tokenized-stock catalog (CIRCUIT_ARCHITECTURE.md §27).
 *
 * An entry may only be added after its issuer, Solana mint, decimals, Pyth feed
 * and Jupiter Trigger compatibility have been verified against primary sources,
 * which are recorded in `verification`. Never infer a mint from a ticker and
 * never copy values from design/ mockups.
 *
 * Intentionally empty until Milestone 2/4 verification is done.
 */

// Solana addresses are base58 (no 0, O, I, l) and 32–44 characters.
const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 Solana address");

export const verifiedAssetSchema = z.object({
  symbol: z.string().min(1),
  displayName: z.string().min(1),
  issuer: z.string().min(1),
  underlyingSymbol: z.string().min(1),
  mintAddress: solanaAddress,
  decimals: z.number().int().min(0).max(255),
  pythFeedId: z.string().min(1),
  inputEnabled: z.boolean(),
  outputEnabled: z.boolean(),
  // Execution stays disabled until a tiny live order has been tested (§27 step 5).
  active: z.boolean(),
  verification: z.object({
    issuerSource: z.url(),
    mintSource: z.url(),
    pythFeedSource: z.url(),
    jupiterTriggerSource: z.url(),
    verifiedAt: z.iso.date(),
  }),
});

export type VerifiedAssetConfig = z.infer<typeof verifiedAssetSchema>;

export const VERIFIED_ASSETS: readonly VerifiedAssetConfig[] = [];
