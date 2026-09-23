/*
 * Sanitized Jupiter fixtures (2026-09-23).
 * - Token and quote objects: real public fields from keyless live calls (no keys involved).
 * - Challenge: the live message layout with placeholders substituted for wallet, time and nonce.
 * - Deposit/create/history/cancel: the documented Trigger V2 OpenAPI example shapes. No live JWT existed.
 * Nothing here is a real JWT, API key, nonce or signed transaction.
 */

export const AAPLX_MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const FAKE_WALLET = "11111111111111111111111111111112";

export const tokenSearchFixture = [
  {
    id: AAPLX_MINT,
    name: "Apple xStock",
    symbol: "AAPLx",
    icon: "https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png",
    decimals: 8,
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    isVerified: true,
    tags: ["moonshot-verified", "token-2022", "verified", "xstocks", "stocks", "rwa", "equities"],
    liquidity: 665918.0593800242,
    organicScoreLabel: "medium",
    stats24h: { futureField: true },
  },
];

export const swapQuoteFixture = {
  swapType: "aggregator",
  inputMint: USDC_MINT,
  outputMint: AAPLX_MINT,
  inAmount: "10500000",
  outAmount: "3098940",
  router: "metis",
  mode: "ultra",
  slippageBps: 0,
  feeBps: 10,
  transaction: null,
  taker: null,
  routePlan: [{ swapInfo: { label: "Whirlpool" }, percent: 100 }],
  unknownNewField: "ignored",
};

export const messageChallengeFixture = {
  type: "message",
  challenge:
    "Sign this message to authenticate with Jupiter that you are the owner of <WALLET_PUBKEY>.\n\nThis challenge expires at <ISO_TIME> with the nonce of <NONCE_PLACEHOLDER>.",
};

export const transactionChallengeFixture = { type: "transaction", transaction: "PLACEHOLDER_BASE64_MEMO_TX" };

export const depositCraftFixture = {
  transaction: "PLACEHOLDER_BASE64_UNSIGNED_TX",
  requestId: "01234567-89ab-cdef-0123-456789abcdef",
  receiverAddress: "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV",
  mint: USDC_MINT,
  amount: "10500000",
  tokenDecimals: 6,
  inputTokenAccount: "PlaceholderInputTokenAccount",
};

export const createOrderFixture = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  txSignature: "PLACEHOLDER_DEPOSIT_SIGNATURE",
  depositConfirmed: true,
};

export const historyFixture = {
  orders: [
    {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      orderType: "single",
      orderState: "filled",
      rawState: "fill_success",
      userPubkey: FAKE_WALLET,
      privyWalletPubkey: "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV",
      inputMint: USDC_MINT,
      initialInputAmount: "10500000",
      remainingInputAmount: "0",
      outputMint: AAPLX_MINT,
      triggerMint: AAPLX_MINT,
      triggerCondition: "below",
      triggerPriceUsd: 181,
      slippageBps: 50,
      expiresAt: 1790272800000,
      createdAt: 1790186400000,
      updatedAt: 1790190000000,
      triggeredAt: 1790189990000,
      outputAmount: "PLACEHOLDER_NOT_A_REAL_FILL",
      inputUsed: "10500000",
      fillPercent: 1,
      events: [
        { type: "deposit", timestamp: 1790186400000, state: "success", txSignature: "PLACEHOLDER_SIG_1", mint: USDC_MINT, amount: "10500000" },
        { type: "fill", timestamp: 1790190000000, state: "success", txSignature: "PLACEHOLDER_SIG_2", outputMint: AAPLX_MINT, outputAmount: "PLACEHOLDER", orderContext: "buy_below" },
      ],
    },
  ],
  pagination: { total: 1, limit: 20, offset: 0 },
};

export const cancelInitiateFixture = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  transaction: "PLACEHOLDER_BASE64_UNSIGNED_WITHDRAWAL",
  requestId: "cancel-request-uuid",
};

export const confirmCancelFixture = { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", txSignature: "PLACEHOLDER_WITHDRAW_SIG" };
