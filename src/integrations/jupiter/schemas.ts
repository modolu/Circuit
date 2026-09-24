import { z } from "zod";

/*
 * Jupiter wire DTOs, validated with Zod. Every external payload starts as
 * `unknown`, and Jupiter names stop in src/integrations/jupiter.
 *
 * Sources (verified 2026-09-23):
 * - Trigger V2 OpenAPI: https://developers.jup.ag/docs/openapi-spec/trigger/v2/trigger.yaml (version 2.0.0)
 * - Trigger docs: authentication, deposit, create-order, order-history, manage-orders, errors
 * - Tokens V2: GET /tokens/v2/search · Swap: GET /swap/v2/order (quote-only without `taker`)
 * Trigger V2 is documented as beta, so objects are non-strict: unknown fields are ignored.
 */

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const atomicAmount = z.string().regex(/^\d+$/);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Trigger service errors: `{ error, details? }`. */
export const triggerErrorSchema = z.object({
  error: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/** API-gateway errors (e.g. a key without Trigger permission): `{ code, message }`. */
export const gatewayErrorSchema = z.object({ code: z.number(), message: z.string() });

// ---------------------------------------------------------------------------
// Auth: POST /trigger/v2/auth/challenge, POST /trigger/v2/auth/verify
// ---------------------------------------------------------------------------

export const authChallengeRequestSchema = z.object({
  walletPubkey: base58,
  type: z.enum(["message", "transaction"]),
});

export const authChallengeResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), challenge: z.string().min(1) }),
  z.object({ type: z.literal("transaction"), transaction: z.string().min(1) }),
]);

export const authVerifyRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), walletPubkey: base58, signature: z.string().min(1) }),
  z.object({ type: z.literal("transaction"), walletPubkey: base58, signedTransaction: z.string().min(1) }),
]);

/** The JWT is a secret: never log or persist it unencrypted. TTL is 24h, with no refresh endpoint. */
export const authVerifyResponseSchema = z.object({ token: z.string().min(1) });

// ---------------------------------------------------------------------------
// Vault: GET /trigger/v2/vault (404 = none), GET /trigger/v2/vault/register (409 = exists)
// ---------------------------------------------------------------------------

export const vaultResponseSchema = z.object({
  userPubkey: base58,
  vaultPubkey: base58,
  privyVaultId: z.string().min(1),
  privyUserId: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Deposit: POST /trigger/v2/deposit/craft (returns an UNSIGNED transaction)
// ---------------------------------------------------------------------------

export const depositCraftRequestSchema = z.object({
  inputMint: base58,
  outputMint: base58,
  userAddress: base58,
  amount: atomicAmount,
  orderType: z.literal("price"),
  orderSubType: z.literal("single"),
});

export const depositCraftResponseSchema = z.object({
  transaction: z.string().min(1),
  requestId: z.string().min(1),
  receiverAddress: base58,
  mint: base58,
  amount: atomicAmount,
  tokenDecimals: z.number().int().nonnegative(),
  inputTokenAccount: z.string().optional(),
  outputTokenAccount: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Create: POST /trigger/v2/orders/price (single)
// ---------------------------------------------------------------------------

export const createSinglePriceOrderRequestSchema = z.object({
  orderType: z.literal("single"),
  depositRequestId: z.string().min(1),
  depositSignedTx: z.string().min(1),
  userPubkey: base58,
  inputMint: base58,
  inputAmount: atomicAmount,
  outputMint: base58,
  triggerMint: base58,
  triggerCondition: z.enum(["above", "below"]),
  triggerPriceUsd: z.number().positive(),
  slippageBps: z.number().int().min(0).max(10_000),
  expiresAt: z.number().int().positive(),
});

/** `txSignature` is the deposit signature. `message` appears on idempotent retries. */
export const createOrderResponseSchema = z.object({
  id: z.string().min(1),
  txSignature: z.string().min(1),
  depositConfirmed: z.boolean(),
  message: z.string().optional(),
});

// ---------------------------------------------------------------------------
// History: GET /trigger/v2/orders/history (no GET-by-id for price orders)
// ---------------------------------------------------------------------------

export const JUPITER_ORDER_STATES = [
  "pending",
  "open",
  "executing",
  "filled",
  "pending_withdraw",
  "cancelled",
  "expired",
  "failed",
] as const;

export const orderEventSchema = z.object({
  type: z.string(),
  timestamp: z.number(),
  state: z.string().optional(),
  txSignature: z.string().optional(),
  mint: z.string().optional(),
  amount: z.string().optional(),
  outputMint: z.string().optional(),
  outputAmount: z.string().optional(),
  orderContext: z.string().optional(),
});

export const orderHistoryItemSchema = z.object({
  id: z.string().min(1),
  orderType: z.string(),
  // Kept as string: unknown future states must reach the normalizer, not fail parsing.
  orderState: z.string(),
  rawState: z.string().optional(),
  userPubkey: z.string(),
  inputMint: z.string(),
  outputMint: z.string(),
  initialInputAmount: z.string().optional(),
  remainingInputAmount: z.string().optional(),
  triggerMint: z.string().optional(),
  triggerCondition: z.string().optional(),
  triggerPriceUsd: z.number().nullish(),
  slippageBps: z.number().nullish(),
  expiresAt: z.number().nullish(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  triggeredAt: z.number().nullish(),
  outputAmount: z.string().nullish(),
  inputUsed: z.string().nullish(),
  fillPercent: z.number().nullish(),
  events: z.array(orderEventSchema).default([]),
});

export const orderHistoryResponseSchema = z.object({
  orders: z.array(orderHistoryItemSchema),
  pagination: z.object({ total: z.number(), limit: z.number(), offset: z.number() }),
});

// ---------------------------------------------------------------------------
// Cancel: POST /orders/price/cancel/{id} → POST /orders/price/confirm-cancel/{id}
// ---------------------------------------------------------------------------

/** Step 1 stops fills immediately (`ready_to_cancel`) and returns an UNSIGNED withdrawal transaction. */
export const cancelInitiateResponseSchema = z.object({
  id: z.string().min(1),
  transaction: z.string().min(1),
  requestId: z.string().min(1),
});

export const confirmCancelRequestSchema = z.object({
  signedTransaction: z.string().min(1),
  cancelRequestId: z.string().min(1),
});

export const confirmCancelResponseSchema = z.object({ id: z.string().min(1), txSignature: z.string().min(1) });

// ---------------------------------------------------------------------------
// Tokens V2 and Swap quote (execution-discovery evidence only)
// ---------------------------------------------------------------------------

export const tokenInfoSchema = z.object({
  id: base58,
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  tokenProgram: base58.optional(),
  isVerified: z.boolean().nullish(),
  tags: z.array(z.string()).nullish(),
  liquidity: z.number().nullish(),
  usdPrice: z.number().nullish(),
});
export const tokenSearchResponseSchema = z.array(z.unknown());

/** Without `taker`, `transaction` is null: a price/route check with nothing to sign. */
export const swapQuoteResponseSchema = z.object({
  inputMint: base58.optional(),
  outputMint: base58.optional(),
  inAmount: atomicAmount,
  outAmount: atomicAmount,
  router: z.string().optional(),
  mode: z.string().optional(),
  swapType: z.string().optional(),
  transaction: z.string().nullable().optional(),
  errorCode: z.number().optional(),
  errorMessage: z.string().optional(),
  routePlan: z
    .array(z.object({ swapInfo: z.object({ label: z.string().optional() }).optional() }))
    .optional(),
});

export type AuthChallengeResponse = z.infer<typeof authChallengeResponseSchema>;
export type DepositCraftRequest = z.infer<typeof depositCraftRequestSchema>;
export type DepositCraftResponse = z.infer<typeof depositCraftResponseSchema>;
export type CreateSinglePriceOrderRequest = z.infer<typeof createSinglePriceOrderRequestSchema>;
export type OrderHistoryItem = z.infer<typeof orderHistoryItemSchema>;
export type OrderHistoryResponse = z.infer<typeof orderHistoryResponseSchema>;
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;
export type CancelInitiateResponse = z.infer<typeof cancelInitiateResponseSchema>;
export type ConfirmCancelResponse = z.infer<typeof confirmCancelResponseSchema>;
export type TokenInfo = z.infer<typeof tokenInfoSchema>;
export type SwapQuote = z.infer<typeof swapQuoteResponseSchema>;
