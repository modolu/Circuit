/**
 * Verified quote token (CIRCUIT_ARCHITECTURE.md §5.2, §27). Never resolved by symbol.
 *
 * USDC on Solana mainnet:
 * - Circle, https://developers.circle.com/stablecoins/usdc-contract-addresses ("Solana":
 *   EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v; devnet uses a different mint).
 * - Solana mainnet getParsedAccountInfo (2026-09-23): spl-token mint, decimals 6, initialized.
 * - Backed's issuer API lists the same mint with 6 decimals as AAPLx's stablecoin pair.
 */
export const USDC = {
  symbol: "USDC",
  mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6,
  tokenProgram: "spl-token",
  verification: {
    sources: [
      "https://developers.circle.com/stablecoins/usdc-contract-addresses",
      "Solana mainnet getParsedAccountInfo(EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v): spl-token, decimals 6",
    ],
    verifiedAt: "2026-09-23",
  },
} as const;

export type QuoteToken = Pick<typeof USDC, "symbol" | "mintAddress" | "decimals">;
