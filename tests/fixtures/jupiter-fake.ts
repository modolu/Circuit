import { PublicKey } from "@solana/web3.js";
import { JupiterRequestError, type JupiterClient, type OrderHistoryQuery } from "@/src/integrations/jupiter/client";
import type {
  CancelInitiateResponse,
  ConfirmCancelResponse,
  CreateOrderResponse,
  CreateSinglePriceOrderRequest,
  DepositCraftRequest,
  OrderHistoryItem,
} from "@/src/integrations/jupiter/schemas";
import { buildUnsignedTransaction, fakeSignature, transactionId } from "./transactions";

/*
 * In-memory Jupiter Trigger V2 double for tests. It records every call, never touches the
 * network, and returns deterministic TEST-ONLY transactions (never real funds or JWTs).
 */

// JWT-shaped placeholder, not a real token.
export const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LW5vdC1yZWFsIn0.c2lnbmF0dXJlLW5vdC1yZWFs";
export const TEST_VAULT = "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV";
export const TEST_CHALLENGE = "Sign this message to authenticate with Jupiter.\n\n  Exact  whitespace\tmatters.  ";

let sequence = 0;
const next = () => (sequence += 1);

type Op = "create" | "history" | "cancel" | "confirm" | "craft";

export class FakeJupiter implements JupiterClient {
  readonly hasApiKey = true;
  calls: string[] = [];
  vaultOwner: string | null = null;
  vaultRegistered = false;
  unauthorized = false;
  craftDelayMs = 0;
  craftFailure: Error | null = null;
  craftCount = 0;
  createDelayMs = 0;
  /** Queued one-shot failures per operation (consumed in order). */
  failures: Partial<Record<Op, Error[]>> = {};
  /** Every create body Jupiter received. */
  created: CreateSinglePriceOrderRequest[] = [];
  /** Test hook run when create is called (e.g. to inspect the database mid-flight). */
  onCreate: ((body: CreateSinglePriceOrderRequest) => Promise<void>) | null = null;
  /** Override the create response (defaults to a confirmed order). */
  createResponse: ((body: CreateSinglePriceOrderRequest) => CreateOrderResponse) | null = null;
  /** Jupiter's order history for the authenticated wallet. */
  orders: OrderHistoryItem[] = [];
  cancelCount = 0;
  confirmCount = 0;

  private takeFailure(op: Op): void {
    const queue = this.failures[op];
    const failure = queue?.shift();
    if (failure) throw failure;
  }

  findTokenByMint = async () => null;
  quoteRoute = async () => {
    throw new Error("not used");
  };

  async requestAuthChallenge(walletPubkey: string, type: "message" | "transaction") {
    this.calls.push(`challenge:${walletPubkey}:${type}`);
    return { type: "message" as const, challenge: TEST_CHALLENGE };
  }

  async verifyAuth(walletPubkey: string, signature: string) {
    this.calls.push(`verify:${walletPubkey}:${signature}`);
    this.vaultOwner = walletPubkey;
    return TEST_JWT;
  }

  async getVault(jwt: string) {
    this.calls.push(`vault:${jwt === TEST_JWT}`);
    if (this.unauthorized) throw new JupiterRequestError("unauthorized", 401);
    return this.vaultRegistered && this.vaultOwner ? { userPubkey: this.vaultOwner, vaultPubkey: TEST_VAULT } : null;
  }

  async registerVault() {
    this.calls.push("register");
    if (this.unauthorized) throw new JupiterRequestError("unauthorized", 401);
    const created = !this.vaultRegistered;
    this.vaultRegistered = true;
    return { vault: { userPubkey: this.vaultOwner!, vaultPubkey: TEST_VAULT }, created };
  }

  async craftDeposit(_jwt: string, request: DepositCraftRequest) {
    this.craftCount += 1;
    this.calls.push(`craft:${request.amount}`);
    if (this.craftDelayMs) await new Promise((resolve) => setTimeout(resolve, this.craftDelayMs));
    this.takeFailure("craft");
    if (this.craftFailure) throw this.craftFailure;
    const n = next();
    return {
      transaction: buildUnsignedTransaction({ payer: new PublicKey(request.userAddress), lamports: 1000 + n }),
      requestId: `req-${n}-not-real`,
      receiverAddress: TEST_VAULT,
      mint: request.inputMint,
      amount: request.amount,
      tokenDecimals: 6,
    };
  }

  async createPriceOrder(_jwt: string, body: CreateSinglePriceOrderRequest): Promise<CreateOrderResponse> {
    this.calls.push(`create:${body.depositRequestId}`);
    this.created.push(body);
    if (this.onCreate) await this.onCreate(body);
    if (this.createDelayMs) await new Promise((resolve) => setTimeout(resolve, this.createDelayMs));
    if (this.unauthorized) throw new JupiterRequestError("unauthorized", 401);
    this.takeFailure("create");
    if (this.createResponse) return this.createResponse(body);
    return { id: `order-${next()}-not-real`, txSignature: transactionId(body.depositSignedTx), depositConfirmed: true };
  }

  async listOrderHistory(_jwt: string, query: OrderHistoryQuery) {
    this.calls.push(`history:${query.state ?? "all"}:${query.offset ?? 0}`);
    if (this.unauthorized) throw new JupiterRequestError("unauthorized", 401);
    this.takeFailure("history");
    const past = new Set(["filled", "cancelled", "expired", "failed"]);
    const filtered = this.orders.filter((order) => {
      if (query.mint && order.inputMint !== query.mint && order.outputMint !== query.mint) return false;
      if (query.state === "active") return !past.has(order.orderState);
      if (query.state === "past") return past.has(order.orderState);
      return true;
    });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    return { orders: filtered.slice(offset, offset + limit), pagination: { total: filtered.length, limit, offset } };
  }

  async initiatePriceOrderCancel(_jwt: string, orderId: string): Promise<CancelInitiateResponse> {
    this.cancelCount += 1;
    this.calls.push(`cancel:${orderId}`);
    if (this.unauthorized) throw new JupiterRequestError("unauthorized", 401);
    this.takeFailure("cancel");
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) throw new JupiterRequestError("not_found", 404);
    if (order.orderState === "open" || order.orderState === "expired") order.orderState = "pending_withdraw";
    const n = next();
    return {
      id: orderId,
      transaction: buildUnsignedTransaction({ payer: new PublicKey(order.userPubkey), lamports: 5000 + n }),
      requestId: `cancel-${n}-not-real`,
    };
  }

  async confirmPriceOrderCancel(_jwt: string, orderId: string, body: { signedTransaction: string; cancelRequestId: string }): Promise<ConfirmCancelResponse> {
    this.confirmCount += 1;
    this.calls.push(`confirm:${orderId}:${body.cancelRequestId}`);
    if (this.unauthorized) throw new JupiterRequestError("unauthorized", 401);
    this.takeFailure("confirm");
    const order = this.orders.find((o) => o.id === orderId);
    if (order) order.orderState = "cancelled";
    return { id: orderId, txSignature: transactionId(body.signedTransaction) };
  }
}

/** A Jupiter history order in the documented OrderHistoryItem shape (test values only). */
export function historyOrder({
  id,
  userPubkey,
  inputMint,
  outputMint,
  amount,
  orderState = "open",
  depositTxSignature,
  fills = [],
  inputUsed,
  outputAmount,
  fillPercent,
  rawState,
}: {
  id: string;
  userPubkey: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  orderState?: string;
  depositTxSignature: string;
  fills?: Array<{ txSignature: string; timestamp: number; outputAmount: string; state?: string }>;
  inputUsed?: string;
  outputAmount?: string;
  fillPercent?: number;
  rawState?: string;
}): OrderHistoryItem {
  return {
    id,
    orderType: "single",
    orderState,
    rawState: rawState ?? orderState,
    userPubkey,
    inputMint,
    outputMint,
    initialInputAmount: amount,
    remainingInputAmount: amount,
    triggerMint: outputMint,
    triggerCondition: "below",
    triggerPriceUsd: 194,
    slippageBps: 50,
    expiresAt: 1_790_300_000_000,
    createdAt: 1_790_180_400_000,
    updatedAt: 1_790_180_400_000,
    triggeredAt: fills.length ? fills[0]!.timestamp : null,
    outputAmount: outputAmount ?? null,
    inputUsed: inputUsed ?? null,
    fillPercent: fillPercent ?? null,
    events: [
      { type: "deposit", timestamp: 1_790_180_400_000, state: "success", txSignature: depositTxSignature, mint: inputMint, amount },
      ...fills.map((fill) => ({
        type: "fill",
        timestamp: fill.timestamp,
        state: fill.state ?? "success",
        txSignature: fill.txSignature,
        outputMint,
        outputAmount: fill.outputAmount,
      })),
    ],
  };
}

export { fakeSignature };
