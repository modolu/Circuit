import { z } from "zod";
import {
  comparisonFeedSchema,
  EXECUTION_STATUSES,
  referenceBasisSchema,
  jupiterVerificationSchema,
  prestocksReferenceSchema,
  primaryReferenceSchema,
} from "../domain/asset.ts";

/**
 * The curated tokenized-stock catalog (CIRCUIT_ARCHITECTURE.md §27).
 *
 * Every value here was verified against primary sources, which are recorded in
 * `verification`. Never infer a mint from a ticker, never resolve a Pyth feed by
 * ticker at runtime, and never copy values from design/ mockups.
 *
 * Each entry names its reference provider (Task 10):
 * - PYTH: public equities. `pnpm db:seed` upserts only when `verification.pythLiveCheck`
 *   is "PASSED", i.e. the configured Pyth key could actually read the reference feed.
 * - PRESTOCKS: private-company tokens. Identity, mint and prices come only from first-party
 *   prestocks.com sources; `pnpm db:seed` upserts only when the recorded PreStocks and
 *   Jupiter checks passed AND the live first-party catalog still lists the exact mint.
 * The PreStocks API is discovery/reference data: its products are NOT execution assets
 * unless curated here.
 */

// Solana addresses are base58 (no 0, O, I, l) and 32–44 characters.
const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 Solana address");

const pythAssetSchema = z.object({
  referenceProvider: z.literal("PYTH"),
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

const firstParty = z.url().refine((value) => /^https:\/\/(www\.)?prestocks\.com\//.test(value), "must be a first-party prestocks.com URL");

const prestocksAssetSchema = z.object({
  referenceProvider: z.literal("PRESTOCKS"),
  symbol: z.string().min(1),
  displayName: z.string().min(1),
  issuer: z.literal("PreStocks"),
  underlyingSymbol: z.string().min(1),
  mintAddress: solanaAddress,
  decimals: z.number().int().min(0).max(255),
  tokenProgram: z.enum(["spl-token", "spl-token-2022"]),
  reference: prestocksReferenceSchema,
  execution: z.object({ status: z.enum(EXECUTION_STATUSES) }),
  jupiter: jupiterVerificationSchema,
  referenceBasis: referenceBasisSchema,
  verification: z.object({
    identitySources: z.array(firstParty).min(1),
    mintSources: z.array(z.string().min(1)).min(1),
    verifiedAt: z.iso.date(),
    prestocksLiveCheck: z.object({
      status: z.enum(["PASSED", "FAILED", "NOT_TESTED"]),
      checkedAt: z.iso.datetime(),
      detail: z.string().min(1),
    }),
  }),
  tokenRestrictions: z.object({ transferFeeBps: z.number().int().min(0).max(10_000), detail: z.string().min(1) }),
  notes: z.array(z.string()),
});

export const verifiedAssetSchema = z
  .discriminatedUnion("referenceProvider", [pythAssetSchema, prestocksAssetSchema])
  .superRefine((asset, ctx) => {
    // A PreStocks asset's mint IS its first-party contract address: never a ticker lookup.
    if (asset.referenceProvider === "PRESTOCKS" && asset.reference.contractAddress !== asset.mintAddress) {
      ctx.addIssue({ code: "custom", path: ["reference", "contractAddress"], message: "must equal mintAddress" });
    }
  });

export type VerifiedAssetConfig = z.infer<typeof verifiedAssetSchema>;
export type PythAssetConfig = Extract<VerifiedAssetConfig, { referenceProvider: "PYTH" }>;
export type PrestocksAssetConfig = Extract<VerifiedAssetConfig, { referenceProvider: "PRESTOCKS" }>;

export const VERIFIED_ASSETS: readonly VerifiedAssetConfig[] = [
  {
    referenceProvider: "PYTH",
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
          detail: "Needs a wallet-signed JWT and a vault. The Task 8/9 prepare path exists; no deposit has been crafted for AAPLx yet.",
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
        status: "PASSED",
        checkedAt: "2026-09-24T17:05:38Z",
        detail:
          "pnpm test:live 3/3 PASS with the deployment's existing key (US-equity access now granted): feed 922 Equity.US.AAPL/USD (equity, stable, min_channel fixed_rate@50ms) returned a FRESH regular-session price from 19 publishers, not carried forward. Earlier (2026-09-23T16:18:10Z) the same key was NOT_ENTITLED (HTTP 403, no equity grant).",
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

const ANTHROPIC_MINT = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";

/*
 * Primary PreStocks demo asset (Task 10), chosen on TECHNICAL integration quality only
 * (not on company quality or any price view): of the six current products that passed
 * every no-funds check on 2026-09-24 (first-party identity, valid Token-2022 mint, Jupiter
 * exact-mint recognition, USDC route, BUY deposit rule, positive mark and token price, no
 * lifecycle notice), it had the deepest Jupiter liquidity (~$877k vs next ~$391k).
 */
export const PRESTOCKS_ASSETS: readonly VerifiedAssetConfig[] = [
  {
    referenceProvider: "PRESTOCKS",
    symbol: "ANTHROPIC",
    displayName: "Anthropic PreStocks",
    issuer: "PreStocks",
    underlyingSymbol: "Anthropic",
    mintAddress: ANTHROPIC_MINT,
    decimals: 9,
    tokenProgram: "spl-token-2022",
    reference: {
      provider: "prestocks",
      role: "private_market_mark",
      referenceType: "MARK_PRICE",
      symbol: "ANTHROPIC",
      contractAddress: ANTHROPIC_MINT,
      apiUrl: "https://prestocks.com/api/prestocks",
      productUrl: "https://www.prestocks.com/anthropic",
      description: "PreStocks Mark Price for the ANTHROPIC token (first-party prestocks.com API)",
    },
    execution: { status: "PENDING_JUPITER_VERIFICATION" },
    jupiter: {
      checkedAt: "2026-09-24T05:40:16Z",
      docsVersion: "Trigger V2 OpenAPI 2.0.0 (beta), developers.jup.ag docs as of 2026-09-24",
      levels: {
        IDENTITY_VERIFIED: {
          result: "PASSED",
          detail: "prestocks.com/api/prestocks lists symbol ANTHROPIC with contract_address Pren1FvF…Lkhw and external_url www.prestocks.com/anthropic (no lifecycle notice); Solana mainnet account is a Token-2022 mint with 9 decimals.",
        },
        JUPITER_TOKEN_RECOGNIZED: { result: "PASSED", detail: "GET /tokens/v2/search exact-mint match, decimals 9 (matches onchain)." },
        SPOT_ROUTE_VERIFIED: {
          result: "PASSED",
          detail: "GET /swap/v2/order quote-only (no taker): 10.5 USDC → 9959377 raw ANTHROPIC via metis/Meteora DLMM. Swap routability is not Trigger proof.",
        },
        TOKEN_EXTENSIONS_COMPATIBLE: {
          result: "RESTRICTED",
          detail: "Token-2022 with transferFeeConfig (100 bps from epoch 1039) and transferHook (no program set): Trigger rejects these as DEPOSIT mints unless whitelisted, so SELL is restricted; BUY deposits USDC and is unaffected per docs.",
        },
        TRIGGER_API_ACCESS_VERIFIED: { result: "PASSED", detail: "Same deployment key as AAPLx: POST /trigger/v2/auth/challenge 200 (2026-09-24)." },
        TRIGGER_DEPOSIT_CRAFT_VERIFIED: { result: "NOT_TESTED", detail: "Needs a wallet-signed JWT; no funded craft in Task 10." },
        LIVE_TRIGGER_ORDER_VERIFIED: { result: "NOT_TESTED", detail: "No funded order has been placed." },
      },
      sides: {
        BUY: {
          result: "NOT_TESTED",
          detail: "USDC → ANTHROPIC: deposit mint USDC (classic SPL, no extensions) is outside the documented restriction; route exists. Unproven until a live deposit craft and order succeed.",
        },
        SELL: {
          result: "RESTRICTED",
          detail: "ANTHROPIC → USDC: the deposit mint carries transferFeeConfig and transferHook, rejected unless Jupiter whitelists it. Live SELL stays disabled.",
        },
      },
    },
    referenceBasis: {
      status: "RESOLVED",
      policyReference: "PreStocks ANTHROPIC Mark Price (first-party prestocks.com API)",
      executionMonitor: "Jupiter Trigger monitors the ANTHROPIC token's USD market price",
      triggerMapping: "IDENTITY",
      disclosure: "The ANTHROPIC token may trade at a premium or discount to the PreStocks mark.",
      detail:
        "Task 10 decision (2026-09-24). The compiled USD target (from the captured mark) is sent to Jupiter unchanged. Evidence: Jupiter Price V3 usdPrice for this mint tracks the PreStocks API tokenPrice (identical digits for several PreStocks tokens on 2026-09-24), and the mint's ScaledUiAmount multiplier is 1. The mark and the token market price are deliberately distinct.",
    },
    verification: {
      identitySources: ["https://prestocks.com/api/prestocks", "https://www.prestocks.com/anthropic"],
      mintSources: [
        "https://prestocks.com/api/prestocks (contract_address for symbol ANTHROPIC)",
        "Solana mainnet getParsedAccountInfo(Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw): spl-token-2022 mint, decimals 9",
      ],
      verifiedAt: "2026-09-24",
      prestocksLiveCheck: {
        status: "PASSED",
        checkedAt: "2026-09-24T05:40:16Z",
        detail: "pnpm test:prestocks-live: API 200, 8 valid products; ANTHROPIC exact mint present with positive markPrice and tokenPrice; product page has no lifecycle notice.",
      },
    },
    tokenRestrictions: {
      transferFeeBps: 100,
      detail: "Token-2022 transfer fee: 100 bps (1.00%) since epoch 1039 (previously 50 bps). Token transfers, including delivery of filled output, may be reduced by this fee.",
    },
    notes: [
      "PreStocks provide only economic exposure to private companies; they confer no ownership, voting, dividend or information rights and are not available to U.S. persons (prestocks.com disclaimer).",
      "Issuer controls: permanent delegate, freeze authority and pausable config are set; default account state is initialized; ScaledUiAmount multiplier 1.",
    ],
  },
];

export const ALL_VERIFIED_ASSETS: readonly VerifiedAssetConfig[] = [...VERIFIED_ASSETS, ...PRESTOCKS_ASSETS];

/**
 * Entries whose own recorded gates passed. PYTH: the Pyth key read the feed. PRESTOCKS: the
 * first-party check passed, Jupiter recognized the exact mint, a USDC route exists and the
 * BUY deposit is not restricted. (PreStocks is re-checked against the live catalog at seed time.)
 */
export function seedableAssets(assets: readonly VerifiedAssetConfig[] = ALL_VERIFIED_ASSETS): VerifiedAssetConfig[] {
  return assets.filter((asset) => seedBlocker(asset) === null);
}

export function seedBlocker(asset: VerifiedAssetConfig): string | null {
  if (asset.referenceProvider === "PYTH") {
    const check = asset.verification.pythLiveCheck;
    return check.status === "PASSED" ? null : `Pyth live check is ${check.status} (${check.detail})`;
  }
  if (asset.verification.prestocksLiveCheck.status !== "PASSED") return `PreStocks check is ${asset.verification.prestocksLiveCheck.status}`;
  const levels = asset.jupiter.levels;
  if (levels.JUPITER_TOKEN_RECOGNIZED?.result !== "PASSED") return "Jupiter exact-mint recognition not passed";
  if (levels.SPOT_ROUTE_VERIFIED?.result !== "PASSED") return "USDC route not verified";
  if (asset.jupiter.sides.BUY.result === "RESTRICTED" || asset.jupiter.sides.BUY.result === "FAILED") return "BUY deposit restricted";
  return null;
}

/**
 * A verified integration that is NOT executable in this deployment, shown for product
 * discovery only (/markets, /policies/new). The database `assets` table holds executable
 * curated assets; this config also holds verified entries whose live reference access is
 * pending. Nothing here is seeded, selectable into a policy form, or carries a price.
 */
export interface PendingIntegration {
  symbol: string;
  displayName: string;
  issuer: string;
  underlyingSymbol: string;
  mintAddress: string;
  referenceProvider: "PYTH";
  /** e.g. "AAPL/USD" (from the curated Pyth symbol, never a runtime lookup). */
  referencePair: string;
  checks: { identity: boolean; mint: boolean; referenceMapping: boolean; jupiterToken: boolean; jupiterRouting: boolean };
  referenceAccess: "PENDING";
  execution: "DISABLED";
}

/**
 * Pyth-referenced entries whose live reference check has not passed and that are not among
 * the executable (seeded) assets. Deliberately exposes no check detail or HTTP status.
 */
export function pendingIntegrations(
  executableMints: ReadonlySet<string>,
  assets: readonly VerifiedAssetConfig[] = ALL_VERIFIED_ASSETS,
): PendingIntegration[] {
  return assets.flatMap((asset) => {
    if (asset.referenceProvider !== "PYTH") return [];
    if (asset.verification.pythLiveCheck.status === "PASSED" || executableMints.has(asset.mintAddress)) return [];
    const levels = asset.jupiter.levels;
    return [
      {
        symbol: asset.symbol,
        displayName: asset.displayName,
        issuer: asset.issuer,
        underlyingSymbol: asset.underlyingSymbol,
        mintAddress: asset.mintAddress,
        referenceProvider: "PYTH" as const,
        referencePair: asset.reference.symbol.replace(/^Equity\.[A-Z]+\./, ""),
        checks: {
          identity: levels.IDENTITY_VERIFIED?.result === "PASSED",
          // Schema-enforced: a sourced mint and a sourced Pyth symbol mapping.
          mint: asset.verification.mintSources.length > 0,
          referenceMapping: Boolean(asset.verification.pythSymbolSource),
          jupiterToken: levels.JUPITER_TOKEN_RECOGNIZED?.result === "PASSED",
          jupiterRouting: levels.SPOT_ROUTE_VERIFIED?.result === "PASSED",
        },
        referenceAccess: "PENDING" as const,
        execution: "DISABLED" as const,
      },
    ];
  });
}
