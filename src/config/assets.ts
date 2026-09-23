import { z } from "zod";
import { comparisonFeedSchema, EXECUTION_STATUSES, primaryReferenceSchema } from "../domain/asset.ts";

/**
 * The curated tokenized-stock catalog (CIRCUIT_ARCHITECTURE.md §27).
 *
 * Every value here was verified against primary sources, which are recorded in
 * `verification`. Never infer a mint from a ticker, never resolve a Pyth feed by
 * ticker at runtime, and never copy values from design/ mockups.
 *
 * `pnpm db:seed` upserts an entry only when `verification.pythLiveCheck.status`
 * is "PASSED", i.e. the configured Pyth key could actually read the reference feed.
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
  tokenProgram: z.enum(["spl-token", "spl-token-2022"]),
  issuerIds: z.object({ backedAssetId: z.uuid(), isin: z.string().min(12), underlyingIsin: z.string().min(12) }),
  reference: primaryReferenceSchema,
  comparisonFeeds: z.array(comparisonFeedSchema),
  // Execution stays disabled until Jupiter Trigger compatibility is verified (§27 step 4–5).
  execution: z.object({ status: z.enum(EXECUTION_STATUSES) }),
  verification: z.object({
    issuerSources: z.array(z.url()).min(1),
    mintSources: z.array(z.string().min(1)).min(1),
    decimalsSource: z.string().min(1),
    pythSymbolSource: z.url(),
    verifiedAt: z.iso.date(),
    pythLiveCheck: z.object({
      status: z.enum(["PASSED", "NOT_ENTITLED"]),
      checkedAt: z.iso.datetime(),
      detail: z.string().min(1),
    }),
  }),
  notes: z.array(z.string()),
});

export type VerifiedAssetConfig = z.infer<typeof verifiedAssetSchema>;

export const VERIFIED_ASSETS: readonly VerifiedAssetConfig[] = [
  {
    symbol: "AAPLx",
    displayName: "Apple xStock",
    issuer: "xStocks by Backed",
    underlyingSymbol: "AAPL",
    mintAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    decimals: 8,
    tokenProgram: "spl-token-2022",
    issuerIds: {
      backedAssetId: "9e43a778-fdc8-44f1-87de-f2e7420bb7f7",
      isin: "CH1436219187",
      underlyingIsin: "US0378331005",
    },
    reference: {
      provider: "pyth_pro",
      role: "underlying_equity",
      symbol: "Equity.US.AAPL/USD",
      feedId: 922,
      // Feed min_channel is fixed_rate@50ms; see src/config/reference.ts.
      channel: "fixed_rate@200ms",
      assetType: "equity",
      description: "APPLE INC / US DOLLAR",
    },
    comparisonFeeds: [
      {
        provider: "pyth_pro",
        role: "token_market_comparison",
        symbol: "Crypto.AAPLX/USD",
        feedId: 1792,
        note: "APPLE XSTOCK / US DOLLAR: the token's own market price. Comparison only, never Circuit's reference.",
      },
    ],
    execution: { status: "PENDING_JUPITER_VERIFICATION" },
    verification: {
      issuerSources: ["https://api.backed.fi/api/v2/public/assets", "https://api.backed.fi/api/v1/token"],
      mintSources: [
        "https://api.backed.fi/api/v2/public/assets (AAPLx deployments[network=Solana].address)",
        "https://api.backed.fi/api/v1/token (AAPLx deployments: svm:XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp)",
        "Solana mainnet Token-2022 metadata: name 'Apple xStock', symbol 'AAPLx', uri https://xstocks-metadata.backed.fi/tokens/Solana/AAPLx/metadata.json",
      ],
      decimalsSource: "Solana mainnet getParsedAccountInfo(XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp): spl-token-2022 mint, decimals 8",
      pythSymbolSource: "https://pyth.dourolabs.app/v1/symbols",
      verifiedAt: "2026-09-23",
      pythLiveCheck: {
        status: "NOT_ENTITLED",
        checkedAt: "2026-09-23T16:18:10Z",
        detail:
          "POST /v1/latest_price for feed 922 returned HTTP 403 'Not entitled' (no grant for asset type 'equity'). The key reads crypto feeds (Crypto.BTC/USD returned 200). Needs a Pyth Pro key with US equity entitlement.",
      },
    },
    notes: [
      "Token-2022 extensions: metadataPointer, permanentDelegate, defaultAccountState, scaledUiAmountConfig, pausableConfig, confidentialTransferMint, transferHook, tokenMetadata.",
      "scaledUiAmountConfig: wallet UI amounts may differ from raw amount ÷ 10^decimals. Money math must use raw atomic units.",
      "Issuer controls (permanent delegate, pausable, freeze authority) exist on this mint.",
    ],
  },
];

/** Entries whose reference feed was confirmed readable with the deployment's Pyth key. */
export function seedableAssets(assets: readonly VerifiedAssetConfig[] = VERIFIED_ASSETS): VerifiedAssetConfig[] {
  return assets.filter((asset) => asset.verification.pythLiveCheck.status === "PASSED");
}
