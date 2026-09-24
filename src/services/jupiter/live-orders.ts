import "server-only";
import type { Database } from "../../db/client.ts";
import { insertExecutionOnce } from "../../db/repositories/executions.ts";
import { appendPolicyEvent, lockPolicyForUpdate, updatePolicyStateIfStatus, type PolicyStateChanges } from "../../db/repositories/policies.ts";
import type { Policy } from "../../db/schema.ts";
import { AppError } from "../../domain/errors.ts";
import { POLICY_EVENT_TYPES, policyStatusForLiveProviderState, type LiveProviderState } from "../../domain/policy.ts";
import type { JupiterClient } from "../../integrations/jupiter/client.ts";
import type { OrderHistoryItem } from "../../integrations/jupiter/schemas.ts";
import { isSolanaSignature } from "../../integrations/jupiter/signed-transaction.ts";
import { normalizeJupiterOrderState } from "../../integrations/jupiter/trigger.ts";
import { logger } from "../../observability/logger.ts";
import { toJupiterAppError } from "./errors.ts";

/*
 * Live Jupiter order truth (GET /orders/history; price orders have no get-by-id).
 * - Orders are located by provider id, or (ARMING recovery) by the deposit transaction
 *   signature Circuit persisted before the create call, plus wallet, mints and amount.
 * - Provider state is stored separately (policies.provider_state); Circuit transitions
 *   only where the lifecycle actually changes, each exactly once (compare-and-set).
 * - Execution evidence comes only from Jupiter's reported values: inputUsed, outputAmount
 *   and fill events with real transaction signatures. Nothing is computed or invented.
 */

const PAGE_SIZE = 100;
/** Bounds each history scan (per state group) so a large account cannot stall a request. */
const MAX_PAGES = 10;
const DIGITS = /^\d+$/;

async function* historyPages(client: JupiterClient, jwt: string, mint: string) {
  for (const state of ["active", "past"] as const) {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let response;
      try {
        response = await client.listOrderHistory(jwt, { state, mint, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      } catch (error) {
        throw toJupiterAppError(error, "history");
      }
      yield response.orders;
      if (response.orders.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= response.pagination.total) break;
    }
  }
}

/** The order with exactly this id, searching active then past orders for the stock mint. */
export async function findOrderById(client: JupiterClient, jwt: string, { orderId, mint }: { orderId: string; mint: string }): Promise<OrderHistoryItem | null> {
  for await (const orders of historyPages(client, jwt, mint)) {
    const match = orders.find((order) => order.id === orderId);
    if (match) return match;
  }
  return null;
}

/** Whether a history order provably belongs to this policy and wallet. */
export function orderMatchesPolicy(order: OrderHistoryItem, policy: Policy, walletAddress: string): boolean {
  return (
    order.userPubkey === walletAddress &&
    order.inputMint === policy.inputMint &&
    order.outputMint === policy.outputMint &&
    (order.initialInputAmount === undefined || order.initialInputAmount === policy.amountAtomic.toString())
  );
}

export function assertOrderMatchesPolicy(order: OrderHistoryItem, policy: Policy, walletAddress: string): void {
  if (!orderMatchesPolicy(order, policy, walletAddress)) {
    throw new AppError("PROVIDER_REJECTED", "The Jupiter order does not match this policy's wallet, mints or amount.", { cause: "ORDER_MISMATCH" });
  }
}

function hasDepositSignature(order: OrderHistoryItem, depositTxSignature: string): boolean {
  return order.events.some((event) => event.type === "deposit" && event.txSignature === depositTxSignature);
}

/**
 * ARMING recovery: orders whose deposit event carries the persisted deposit signature AND
 * match the wallet, mints and exact initial amount. Never matched by ticker or amount alone.
 */
export async function findOrdersByDeposit(
  client: JupiterClient,
  jwt: string,
  { policy, walletAddress, depositTxSignature }: { policy: Policy; walletAddress: string; depositTxSignature: string },
): Promise<OrderHistoryItem[]> {
  const found = new Map<string, OrderHistoryItem>();
  for await (const orders of historyPages(client, jwt, policy.outputMint)) {
    for (const order of orders) {
      if (
        hasDepositSignature(order, depositTxSignature) &&
        order.initialInputAmount === policy.amountAtomic.toString() &&
        orderMatchesPolicy(order, policy, walletAddress)
      ) {
        found.set(order.id, order);
      }
    }
  }
  return [...found.values()];
}

/** Provider-reported progress only, as strings. fillPercent is display context, never money. */
export function providerProgress(order: OrderHistoryItem): Record<string, unknown> {
  return {
    rawState: order.rawState ?? null,
    inputUsed: order.inputUsed ?? null,
    outputAmount: order.outputAmount ?? null,
    fillPercent: order.fillPercent === null || order.fillPercent === undefined ? null : String(order.fillPercent),
    remainingInputAmount: order.remainingInputAmount ?? null,
    triggeredAt: order.triggeredAt ?? null,
  };
}

export interface FillEvidence {
  transactionSignature: string;
  inputAmountAtomic: bigint;
  outputAmountAtomic: bigint;
  executedAt: Date;
  fillJson: Record<string, unknown>;
}

/**
 * Real execution evidence for a FILLED order, or null when Jupiter has not reported it
 * completely. The recorded signature is the latest successful FILL event's signature
 * (never the deposit's); `fillJson.fills` keeps every fill event, the complete evidence
 * when an order filled in several transactions.
 */
export function fillEvidence(order: OrderHistoryItem): FillEvidence | null {
  if (!order.inputUsed || !DIGITS.test(order.inputUsed) || !order.outputAmount || !DIGITS.test(order.outputAmount)) return null;
  const fills = order.events
    .filter((event) => event.type === "fill")
    .map((event) => ({
      timestamp: event.timestamp,
      state: event.state ?? null,
      txSignature: event.txSignature ?? null,
      outputMint: event.outputMint ?? null,
      outputAmount: event.outputAmount ?? null,
      orderContext: event.orderContext ?? null,
    }));
  const settled = fills
    .filter((fill) => fill.state !== "failed" && fill.state !== "pending" && isSolanaSignature(fill.txSignature))
    .sort((a, b) => a.timestamp - b.timestamp);
  const final = settled.at(-1);
  if (!final?.txSignature) return null;
  const executedAtMs = order.triggeredAt ?? final.timestamp;
  return {
    transactionSignature: final.txSignature,
    inputAmountAtomic: BigInt(order.inputUsed),
    outputAmountAtomic: BigInt(order.outputAmount),
    executedAt: new Date(final.timestamp || executedAtMs),
    fillJson: {
      source: "jupiter_order_history",
      providerOrderId: order.id,
      orderState: order.orderState,
      rawState: order.rawState ?? null,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inputUsed: order.inputUsed,
      outputAmount: order.outputAmount,
      fillPercent: order.fillPercent === null || order.fillPercent === undefined ? null : String(order.fillPercent),
      triggeredAt: order.triggeredAt ?? null,
      recordedSignature: "latest successful fill event",
      fills,
    },
  };
}

export interface ApplyResult {
  changed: boolean;
  providerState: LiveProviderState | "UNKNOWN";
  diagnostic?: string;
}

const TERMINAL_EVENTS: Record<"FILLED" | "CANCELLED" | "EXPIRED" | "FAILED", { provider: string; policy: string }> = {
  FILLED: { provider: POLICY_EVENT_TYPES.PROVIDER_ORDER_FILLED, policy: POLICY_EVENT_TYPES.EXECUTED },
  CANCELLED: { provider: POLICY_EVENT_TYPES.PROVIDER_ORDER_CANCELLED, policy: POLICY_EVENT_TYPES.CANCELLED },
  EXPIRED: { provider: POLICY_EVENT_TYPES.PROVIDER_ORDER_EXPIRED, policy: POLICY_EVENT_TYPES.EXPIRED },
  FAILED: { provider: POLICY_EVENT_TYPES.PROVIDER_ORDER_FAILED, policy: POLICY_EVENT_TYPES.FAILED },
};

function eventTime(order: OrderHistoryItem, type: string, fallback: Date): Date {
  const event = order.events.filter((e) => e.type === type).sort((a, b) => a.timestamp - b.timestamp).at(-1);
  return event ? new Date(event.timestamp) : fallback;
}

/**
 * Mirrors one Jupiter order into the policy, in ONE transaction under a row lock:
 * provider state/progress (when changed), ARMING → ARMED when the order is confirmed
 * live, and a terminal transition exactly once. Terminal Circuit states never move
 * (e.g. an EXPIRED policy whose funds were later withdrawn stays EXPIRED; EXECUTED never
 * becomes CANCELLED). Unknown states are logged and left alone.
 */
export async function applyLiveOrder(
  db: Database,
  { policyId, order, now }: { policyId: string; order: OrderHistoryItem; now: Date },
): Promise<ApplyResult> {
  const state = normalizeJupiterOrderState(order.orderState);
  if (state === "UNKNOWN") {
    logger.warn("reconcile.unknown_state", { policyId, providerOrderId: order.id, orderState: order.orderState, rawState: order.rawState });
    return { changed: false, providerState: "UNKNOWN", diagnostic: "Jupiter reported an unrecognized order state. No change was made." };
  }

  return db.transaction(async (tx) => {
    const policy = await lockPolicyForUpdate(tx, policyId);
    if (!policy) throw new AppError("NOT_FOUND", "Policy not found.");
    let changed = false;
    let diagnostic: string | undefined;

    const progress = providerProgress(order);
    const progressChanged = JSON.stringify(policy.providerProgressJson ?? null) !== JSON.stringify(progress);
    if (policy.providerState !== state || progressChanged) {
      const updated = await updatePolicyStateIfStatus(tx, {
        policyId,
        expectedStatuses: [policy.status],
        changes: { providerState: state, providerStateUpdatedAt: now, providerProgressJson: progress },
      });
      if (updated && policy.providerState !== state) {
        await appendPolicyEvent(tx, {
          policyId,
          eventType: POLICY_EVENT_TYPES.PROVIDER_STATE_CHANGED,
          source: "JUPITER",
          payload: { providerOrderId: order.id, from: policy.providerState, to: state, orderState: order.orderState, rawState: order.rawState ?? null },
        });
        changed = true;
      }
    }

    let status = policy.status;
    const target = policyStatusForLiveProviderState(state);

    // ARMING → ARMED once Jupiter reports the order beyond `pending` (not for deposit failure).
    if (status === "ARMING" && target !== "ARMING" && state !== "FAILED") {
      const armed = await updatePolicyStateIfStatus(tx, {
        policyId,
        expectedStatuses: ["ARMING"],
        changes: { status: "ARMED", providerOrderId: order.id, armedAt: now },
      });
      if (armed) {
        await appendPolicyEvent(tx, {
          policyId,
          eventType: POLICY_EVENT_TYPES.ARMED,
          source: "CIRCUIT",
          payload: { from: "ARMING", to: "ARMED", provider: armed.provider, providerOrderId: order.id, providerState: state },
        });
        status = "ARMED";
        changed = true;
      }
    }

    const terminal = state === "FILLED" || state === "CANCELLED" || state === "EXPIRED" || state === "FAILED" ? state : null;
    const canTerminate = status === "ARMED" || (status === "ARMING" && terminal === "FAILED");
    if (terminal && canTerminate) {
      let changes: PolicyStateChanges = { status: policyStatusForLiveProviderState(terminal) };
      let evidence: FillEvidence | null = null;
      if (terminal === "FILLED") {
        evidence = fillEvidence(order);
        if (!evidence) {
          diagnostic = "Jupiter reports the order filled, but has not yet reported complete fill evidence (amounts and fill signature). Circuit will record EXECUTED once it does.";
          logger.warn("reconcile.fill_evidence_incomplete", { policyId, providerOrderId: order.id });
          return { changed, providerState: state, diagnostic };
        }
        changes = { ...changes, executedAt: evidence.executedAt };
      } else if (terminal === "CANCELLED") {
        changes = { ...changes, cancelledAt: eventTime(order, "cancelled", now) };
      } else if (terminal === "FAILED") {
        changes = { ...changes, failureCode: "PROVIDER_FAILED", failureMessage: "Jupiter reported the order as failed." };
      }

      const finished = await updatePolicyStateIfStatus(tx, { policyId, expectedStatuses: [status], changes });
      if (finished) {
        const events = TERMINAL_EVENTS[terminal];
        await appendPolicyEvent(tx, {
          policyId,
          eventType: events.provider,
          source: "JUPITER",
          payload: {
            providerOrderId: order.id,
            orderState: order.orderState,
            rawState: order.rawState ?? null,
            ...(evidence ? { fillSignature: evidence.transactionSignature, inputUsed: order.inputUsed, outputAmount: order.outputAmount } : {}),
          },
        });
        if (evidence) {
          await insertExecutionOnce(tx, {
            policyId,
            providerOrderId: order.id,
            evidenceSource: "ONCHAIN",
            transactionSignature: evidence.transactionSignature,
            inputAmountAtomic: evidence.inputAmountAtomic,
            outputAmountAtomic: evidence.outputAmountAtomic,
            // Not derived: the effective price of a ScaledUiAmount token needs care; show amounts only.
            effectivePriceUsd: null,
            fillJson: evidence.fillJson,
            executedAt: evidence.executedAt,
          });
        }
        await appendPolicyEvent(tx, {
          policyId,
          eventType: events.policy,
          source: "CIRCUIT",
          payload: { from: status, to: changes.status, providerOrderId: order.id },
        });
        changed = true;
      }
    }
    return { changed, providerState: state, ...(diagnostic ? { diagnostic } : {}) };
  });
}
