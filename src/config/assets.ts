import { z } from "zod";
import {
  comparisonFeedSchema,
  EXECUTION_STATUSES,
  referenceBasisSchema,
  jupiterVerificationSchema,
  primaryReferenceSchema,
} from "../domain/asset.ts";

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
  jupiter: jupiterVerificationSchema,
  referenceBasis: referenceBasisSchema,
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
    jupiter: {
      checkedAt: "2026-09-23T17:00:00Z",
      docsVersion: "Trigger V2 OpenAPI 2.0.0 (beta), developers.jup.ag docs as of 2026-09-23",
      levels: {
        IDENTITY_VERIFIED: { result: "PASSED", detail: "Issuer API (api.backed.fi v1+v2) and Solana mainnet mint account (Task 4)." },
        JUPITER_TOKEN_RECOGNIZED: {
          result: "PASSED",
          detail: "GET /tokens/v2/search exact-mint match: 'Apple xStock' AAPLx, decimals 8 (matches issuer/onchain), Token-2022, isVerified true, tags verified/xstocks/stocks.",
        },
        SPOT_ROUTE_VERIFIED: {
          result: "PASSED",
          detail: "GET /swap/v2/order quote-only (no taker): 10.5 USDC → AAPLx routed (metis/Whirlpool); AAPLx → USDC routed (jupiterz). Swap routability is not Trigger proof.",
        },
        TOKEN_EXTENSIONS_COMPATIBLE: {
          result: "RESTRICTED",
          detail: "No transferFeeConfig. transferHook extension present (programId null): Trigger rejects transfer-hook DEPOSIT mints unless whitelisted, so SELL is restricted; BUY deposits USDC and is unaffected per docs.",
        },
        TRIGGER_API_ACCESS_VERIFIED: {
          result: "PASSED",
          detail: "2026-09-23 (pnpm test:jupiter-live, Task 8): with the deployment's JUPITER_API_KEY, POST /trigger/v2/auth/challenge returned 200 (type message) with no gateway 403. JWT-authenticated calls (vault, deposit craft) still need the user's wallet signature.",
        },
        TRIGGER_DEPOSIT_CRAFT_VERIFIED: {
          result: "NOT_TESTED",
          detail: "Needs a wallet-signed JWT and a vault. The Task 8/9 prepare path exists but stays blocked by the Pyth live check.",
        },
        LIVE_TRIGGER_ORDER_VERIFIED: { result: "NOT_TESTED", detail: "No funded order has been placed (Task 9)." },
      },
      sides: {
        BUY: {
          result: "NOT_TESTED",
          detail: "USDC → AAPLx: deposit mint USDC (classic SPL, no extensions) is outside the documented restriction; route exists. Unproven until deposit craft and a live order succeed.",
        },
        SELL: {
          result: "RESTRICTED",
          detail: "AAPLx → USDC: deposit mint AAPLx carries transferHook, which is rejected at deposit unless Jupiter whitelists it. Keep SELL disabled until a live deposit craft proves otherwise.",
        },
      },
    },
    referenceBasis: {
      status: "RESOLVED",
      policyReference: "Pyth Equity.US.AAPL/USD (independent underlying Apple equity reference)",
      executionMonitor: "Jupiter Trigger monitors AAPLx/USD (the token's secondary-market price)",
      triggerMapping: "IDENTITY",
      disclosure: "AAPLx is a secondary-market token and may trade at a premium or discount to underlying AAPL.",
      detail:
        "Task 9 decision (2026-09-24). The compiled USD target is sent to Jupiter unchanged. ScaledUiAmount changes displayed token quantities only (raw amounts are unchanged and used for transactions; Solana Scaled UI Amount docs, xStocks multiplier guide), so no multiplier is applied to the trigger. Evidence: Jupiter Price V3 for AAPLx reported usdPrice 336.44 (scaled, per displayed token) alongside a separate usdPricePrescaled 337.54 = usdPrice × multiplier 1.00327, and stockData (underlying AAPL) 337.10; xStocks price-data quote 336.915. xStocks secondary-market prices are set by supply and demand (xStocks FAQ).",
    },
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
      "scaledUiAmountConfig: displayed (UI) amount = raw amount × multiplier; raw balances never change. Transactions and money math use raw atomic units. The multiplier is never applied to USD trigger prices.",
      "Issuer controls (permanent delegate, pausable, freeze authority) exist on this mint.",
      "ScaledUiAmount multiplier observed 2026-09-23: 1.0026642075893797 → newMultiplier 1.0032690125398187 (effective 1786149000, already active). Display-only: it scales token quantities, not the USD trigger. Jupiter monitors AAPLx's own secondary-market USD price (see referenceBasis).",
    ],
  },
];

/** Entries whose reference feed was confirmed readable with the deployment's Pyth key. */
export function seedableAssets(assets: readonly VerifiedAssetConfig[] = VERIFIED_ASSETS): VerifiedAssetConfig[] {
  return assets.filter((asset) => asset.verification.pythLiveCheck.status === "PASSED");
}
