/*
 * PreStocks catalog DISCOVERY results (Task 10), keyed by EXACT mint, never by ticker.
 * This is display context for /markets only: nothing here is an execution asset. The
 * only executable PreStocks assets are curated in src/config/assets.ts and seeded.
 * Recorded from `pnpm test:prestocks-live` (no funds) on 2026-09-24; re-run the probe to refresh.
 */

export type DiscoveryStatus = "ROUTE_VERIFIED" | "UNVERIFIED" | "NOT_ELIGIBLE";

export interface DiscoveryRecord {
  symbol: string;
  status: DiscoveryStatus;
  detail: string;
}

export const PRESTOCKS_DISCOVERY_CHECKED_AT = "2026-09-24T05:40:16Z";

const ROUTE_VERIFIED = "Jupiter exact-mint recognition and a quote-only USDC route passed; not enabled for policies.";

export const PRESTOCKS_DISCOVERY: Readonly<Record<string, DiscoveryRecord>> = {
  Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw: { symbol: "ANTHROPIC", status: "ROUTE_VERIFIED", detail: ROUTE_VERIFIED },
  PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB: { symbol: "ANDURIL", status: "ROUTE_VERIFIED", detail: ROUTE_VERIFIED },
  PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd: { symbol: "FIGUREAI", status: "ROUTE_VERIFIED", detail: ROUTE_VERIFIED },
  PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua: { symbol: "KALSHI", status: "ROUTE_VERIFIED", detail: ROUTE_VERIFIED },
  PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S: { symbol: "NEURALINK", status: "ROUTE_VERIFIED", detail: ROUTE_VERIFIED },
  Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP: { symbol: "POLYMARKET", status: "ROUTE_VERIFIED", detail: ROUTE_VERIFIED },
  PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF: {
    symbol: "OPENAI",
    status: "UNVERIFIED",
    detail: "Jupiter Tokens search did not return this exact mint on 2026-09-24 (a USDC quote existed); a ScaledUiAmount multiplier change (1 → 1.486) is also configured on the mint.",
  },
  PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh: {
    symbol: "SPACEX",
    status: "NOT_ELIGIBLE",
    detail: "Transition: the first-party product page says SpaceX has gone public and SpaceX PreStocks must be swapped before 11:59pm UTC on 12 March 2027, or they expire worthless.",
  },
};
