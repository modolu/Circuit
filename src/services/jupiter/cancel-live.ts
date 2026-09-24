import "server-only";
import type { Database } from "../../db/client.ts";
import {
  confirmCancelPreparation,
  findCancelPreparation,
  insertCancelPreparation,
  invalidateActiveCancelPreparations,
  invalidateCancelPreparation,
  markCancelSubmissionStarted,
} from "../../db/repositories/jupiter-cancel-preparations.ts";
import { appendPolicyEvent, lockPolicyForUpdate, updatePolicyStateIfStatus } from "../../db/repositories/policies.ts";
import type { JupiterCancelPreparation, Policy, Wallet } from "../../db/schema.ts";
import { AppError } from "../../domain/errors.ts";
import { EXECUTION_PROVIDERS, POLICY_EVENT_TYPES } from "../../domain/policy.ts";
import { JupiterRequestError, type JupiterClient } from "../../integrations/jupiter/client.ts";
import { isSolanaSignature, SignedTransactionError, verifySignedTransaction } from "../../integrations/jupiter/signed-transaction.ts";
import { logger } from "../../observability/logger.ts";
import { loadOwnedPolicy } from "../policy-lifecycle.ts";
import { requireJupiterJwt, requireLiveMode, toJupiterAppError } from "./errors.ts";
import { applyLiveOrder, assertOrderMatchesPolicy, findOrderById } from "./live-orders.ts";

/*
 * Live two-step cancellation / withdrawal (Jupiter "Manage Orders", Task 9).
 *
 * Step 1 (initiate): refresh the order from history first (provider truth wins: a filled
 * order is EXECUTED and is never cancelled). For an open order, or an expired one whose
 * funds are still in the vault, POST /orders/price/cancel/{id} stops fills and returns an
 * UNSIGNED withdrawal + cancelRequestId, persisted as a PREPARED row. Circuit is NOT
 * marked CANCELLED; provider_state becomes PENDING_WITHDRAW.
 *
 * Step 2 (confirm): verify the wallet-signed withdrawal is exactly the prepared one, commit
 * it (SUBMITTING) before POST /orders/price/confirm-cancel/{id}, then on success:
 * ARMED → CANCELLED (cancel) or EXPIRED stays EXPIRED with FUNDS_WITHDRAWN (expired).
 * Timeouts/5xx/401 leave it SUBMITTING for a retry of the SAME signed withdrawal; a 400
 * invalidates it, and initiating again re-crafts (documented as idempotent).
 */

export const CONFIRM_RETRY_AFTER_MS = 60_000;

export type CancelInitiateOutcome = "WITHDRAWAL_READY" | "ALREADY_FILLED" | "ALREADY_CANCELLED" | "ALREADY_FAILED" | "ALREADY_WITHDRAWN";

export interface CancelPreparationView {
  id: string;
  purpose: JupiterCancelPreparation["purpose"];
  status: JupiterCancelPreparation["status"];
  providerOrderId: string;
  withdrawalTxSignature: string | null;
  createdAt: string;
}

export function toCancelPreparationView(row: JupiterCancelPreparation): CancelPreparationView {
  return {
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    providerOrderId: row.providerOrderId,
    withdrawalTxSignature: row.withdrawalTxSignature,
    createdAt: row.createdAt.toISOString(),
  };
}

function assertLiveProviderPolicy(policy: Policy): string {
  if (policy.provider !== EXECUTION_PROVIDERS.LIVE) {
    throw new AppError("POLICY_STATE_CONFLICT", "This simulated policy is cancelled with the simulated provider.");
  }
  if (!policy.providerOrderId) throw new AppError("POLICY_STATE_CONFLICT", "This policy has no Jupiter order yet.");
  return policy.providerOrderId;
}

export async function initiateLiveCancel(
  db: Database,
  { wallet, policyId, jwt, mode, now = new Date() }: { wallet: Wallet; policyId: string; jwt: string | null; mode: "mock" | "live"; now?: Date },
  { client }: { client: JupiterClient },
): Promise<{ policy: Policy; outcome: CancelInitiateOutcome; preparation?: CancelPreparationView; unsignedTransaction?: string }> {
  requireLiveMode(mode);
  const token = requireJupiterJwt(jwt);
  let policy = await loadOwnedPolicy(db, wallet.id, policyId);
  const orderId = assertLiveProviderPolicy(policy);
  if (policy.status !== "ARMED" && policy.status !== "EXPIRED") {
    throw new AppError("POLICY_STATE_CONFLICT", `A ${policy.status} policy has nothing to cancel or withdraw.`);
  }

  // Provider truth first: a fill before cancellation wins.
  const order = await findOrderById(client, token, { orderId, mint: policy.outputMint });
  if (!order) throw new AppError("ORDER_NOT_FOUND", "Jupiter's order history does not list this order.");
  assertOrderMatchesPolicy(order, policy, wallet.address);
  await applyLiveOrder(db, { policyId, order, now });
  policy = await loadOwnedPolicy(db, wallet.id, policyId);
  if (policy.status === "EXECUTED") return { policy, outcome: "ALREADY_FILLED" };
  if (policy.status === "CANCELLED") return { policy, outcome: "ALREADY_CANCELLED" };
  if (policy.status === "FAILED") return { policy, outcome: "ALREADY_FAILED" };
  if (policy.status === "EXPIRED" && order.orderState === "cancelled") return { policy, outcome: "ALREADY_WITHDRAWN" };
  if (order.orderState === "executing") {
    throw new AppError("CANCELLATION_FAILED", "Jupiter is executing this order right now, so it cannot be cancelled. Reconcile shortly.", { retryable: true });
  }
  if (!["open", "pending_withdraw", "expired"].includes(order.orderState)) {
    throw new AppError("CANCELLATION_FAILED", "This order is not in a state Jupiter can cancel yet. Reconcile and try again.", { retryable: true });
  }
  const purpose: JupiterCancelPreparation["purpose"] = policy.status === "EXPIRED" ? "WITHDRAW_EXPIRED" : "CANCEL";

  await appendPolicyEvent(db, {
    policyId,
    eventType: POLICY_EVENT_TYPES.CANCEL_REQUESTED,
    source: "USER",
    payload: { provider: EXECUTION_PROVIDERS.LIVE, simulated: false, providerOrderId: orderId, purpose },
  });

  let crafted;
  try {
    crafted = await client.initiatePriceOrderCancel(token, orderId);
  } catch (error) {
    throw toJupiterAppError(error, "cancel");
  }
  if (crafted.id !== orderId) {
    throw new AppError("PROVIDER_REJECTED", "Jupiter returned a withdrawal for a different order.", { cause: "CANCEL_ORDER_MISMATCH" });
  }
  // The wallet must be a required signer of the withdrawal; anything else is not presented for signing.
  try {
    verifyShape(crafted.transaction, wallet.address);
  } catch {
    throw new AppError("PROVIDER_REJECTED", "Jupiter returned a withdrawal transaction Circuit cannot safely present for signing.", {
      cause: "WITHDRAWAL_TX_UNSAFE",
    });
  }

  const preparation = await db.transaction(async (tx) => {
    const locked = await lockPolicyForUpdate(tx, policyId);
    if (!locked || (locked.status !== "ARMED" && locked.status !== "EXPIRED")) {
      throw new AppError("POLICY_STATE_CONFLICT", "The policy changed while preparing the withdrawal. Refresh to see its state.");
    }
    await invalidateActiveCancelPreparations(tx, { policyId, now });
    const row = await insertCancelPreparation(tx, {
      policyId,
      walletId: wallet.id,
      providerOrderId: orderId,
      purpose,
      cancelRequestId: crafted.requestId,
      unsignedTransaction: crafted.transaction,
      now,
    });
    const previous = locked.providerState;
    await updatePolicyStateIfStatus(tx, {
      policyId,
      expectedStatuses: [locked.status],
      changes: { providerState: "PENDING_WITHDRAW", providerStateUpdatedAt: now },
    });
    await appendPolicyEvent(tx, {
      policyId,
      eventType: POLICY_EVENT_TYPES.CANCEL_INITIATED,
      source: "JUPITER",
      payload: { providerOrderId: orderId, purpose, cancelPreparationId: row.id, from: previous, to: "PENDING_WITHDRAW" },
    });
    return row;
  });
  return {
    policy: await loadOwnedPolicy(db, wallet.id, policyId),
    outcome: "WITHDRAWAL_READY",
    preparation: toCancelPreparationView(preparation),
    unsignedTransaction: preparation.unsignedTransaction,
  };
}

/** Structural check only: the wallet must be a required signer (verifySignedTransaction does the full check later). */
function verifyShape(unsignedBase64: string, walletAddress: string): void {
  try {
    verifySignedTransaction({ preparedUnsignedBase64: unsignedBase64, signedBase64: unsignedBase64, walletAddress });
  } catch (error) {
    // An unsigned transaction necessarily fails at the wallet's (empty) signature slot;
    // anything earlier (malformed, wallet not a signer) is unsafe to present.
    if (error instanceof SignedTransactionError && error.reason === "signature_missing") return;
    throw error;
  }
}

export async function confirmLiveCancel(
  db: Database,
  {
    wallet,
    policyId,
    preparationId,
    signedTransaction,
    jwt,
    mode,
    now = new Date(),
  }: {
    wallet: Wallet;
    policyId: string;
    preparationId: string;
    /** Base64 wallet-signed withdrawal. Omit only to retry the stored one. */
    signedTransaction?: string;
    jwt: string | null;
    mode: "mock" | "live";
    now?: Date;
  },
  { client }: { client: JupiterClient },
): Promise<{ policy: Policy; preparation: CancelPreparationView; withdrawalTxSignature: string }> {
  requireLiveMode(mode);
  const token = requireJupiterJwt(jwt);
  const policy = await loadOwnedPolicy(db, wallet.id, policyId);
  const orderId = assertLiveProviderPolicy(policy);

  const prep = await findCancelPreparation(db, { id: preparationId, policyId });
  if (!prep || prep.walletId !== wallet.id || prep.providerOrderId !== orderId) throw new AppError("NOT_FOUND", "Withdrawal preparation not found.");
  if (prep.status === "CONFIRMED" && prep.withdrawalTxSignature) {
    return { policy, preparation: toCancelPreparationView(prep), withdrawalTxSignature: prep.withdrawalTxSignature };
  }
  if (prep.status === "INVALIDATED") {
    throw new AppError("CANCELLATION_FAILED", "This withdrawal transaction is no longer valid. Start the withdrawal again to get a fresh one.");
  }

  const candidate = signedTransaction ?? prep.signedTransaction;
  if (!candidate) throw new AppError("VALIDATION_ERROR", "Sign the withdrawal transaction in your wallet first.");
  let verified;
  try {
    verified = verifySignedTransaction({ preparedUnsignedBase64: prep.unsignedTransaction, signedBase64: candidate, walletAddress: wallet.address });
  } catch (error) {
    const reason = error instanceof SignedTransactionError ? error.reason : "malformed";
    throw new AppError(
      "VALIDATION_ERROR",
      reason === "message_mismatch"
        ? "The signed transaction is not the withdrawal Circuit prepared. Nothing was submitted."
        : "The withdrawal must be signed by the wallet signed in to Circuit. Nothing was submitted.",
      { cause: `SIGNED_TX_${reason.toUpperCase()}` },
    );
  }

  const submitting = await markCancelSubmissionStarted(db, {
    id: prep.id,
    withdrawalTxSignature: verified.transactionSignature,
    signedTransaction: verified.signedTransactionBase64,
    olderThan: new Date(now.getTime() - CONFIRM_RETRY_AFTER_MS),
    now,
  });
  if (!submitting) {
    throw new AppError("POLICY_STATE_CONFLICT", "This withdrawal was submitted moments ago. Reconcile shortly before retrying.", { retryable: true });
  }
  await appendPolicyEvent(db, {
    policyId,
    eventType: POLICY_EVENT_TYPES.WITHDRAWAL_SIGNED,
    source: "USER",
    payload: { providerOrderId: orderId, cancelPreparationId: prep.id, withdrawalTxSignature: verified.transactionSignature, purpose: prep.purpose },
  });

  let confirmed;
  try {
    confirmed = await client.confirmPriceOrderCancel(token, orderId, {
      signedTransaction: verified.signedTransactionBase64,
      cancelRequestId: prep.cancelRequestId,
    });
  } catch (error) {
    const appError = toJupiterAppError(error, "cancel");
    if (error instanceof JupiterRequestError && error.reason === "bad_request") {
      // Jupiter rejected this signed withdrawal: it cannot land. A new initiate re-crafts it.
      await invalidateCancelPreparation(db, { id: prep.id, now });
      throw new AppError("CANCELLATION_FAILED", `${appError.message} Start the withdrawal again to get a fresh transaction.`, { cause: appError.cause });
    }
    logger.warn("jupiter.confirm_cancel_unconfirmed", { policyId, providerOrderId: orderId, code: appError.code });
    if (appError.code === "PROVIDER_AUTH_REQUIRED") throw appError;
    throw new AppError("CANCELLATION_FAILED", "Jupiter did not confirm the withdrawal. The order stays stopped; retry the confirmation.", {
      cause: appError.cause,
      retryable: true,
    });
  }
  if (confirmed.id !== orderId || !isSolanaSignature(confirmed.txSignature)) {
    throw new AppError("PROVIDER_REJECTED", "Jupiter returned an unexpected withdrawal confirmation.", { cause: "CONFIRM_MISMATCH" });
  }
  if (verified.transactionSignature && confirmed.txSignature !== verified.transactionSignature) {
    logger.warn("jupiter.withdrawal_signature_mismatch", { policyId, providerOrderId: orderId });
  }

  const result = await db.transaction(async (tx) => {
    const locked = await lockPolicyForUpdate(tx, policyId);
    if (!locked) throw new AppError("NOT_FOUND", "Policy not found.");
    const done = await confirmCancelPreparation(tx, { id: prep.id, withdrawalTxSignature: confirmed.txSignature, now });
    if (!done) return { policy: locked, preparation: prep };
    await appendPolicyEvent(tx, {
      policyId,
      eventType: POLICY_EVENT_TYPES.FUNDS_WITHDRAWN,
      source: "JUPITER",
      payload: { providerOrderId: orderId, withdrawalTxSignature: confirmed.txSignature, purpose: prep.purpose },
    });
    let updated: Policy | undefined;
    if (locked.status === "ARMED") {
      updated = await updatePolicyStateIfStatus(tx, {
        policyId,
        expectedStatuses: ["ARMED"],
        changes: { status: "CANCELLED", cancelledAt: now, providerState: "CANCELLED", providerStateUpdatedAt: now },
      });
      if (updated) {
        await appendPolicyEvent(tx, {
          policyId,
          eventType: POLICY_EVENT_TYPES.PROVIDER_ORDER_CANCELLED,
          source: "JUPITER",
          payload: { providerOrderId: orderId, withdrawalTxSignature: confirmed.txSignature },
        });
        await appendPolicyEvent(tx, {
          policyId,
          eventType: POLICY_EVENT_TYPES.CANCELLED,
          source: "CIRCUIT",
          payload: { from: "ARMED", to: "CANCELLED", provider: EXECUTION_PROVIDERS.LIVE, providerOrderId: orderId },
        });
      }
    } else {
      // EXPIRED stays EXPIRED: the withdrawal is recorded separately, never as a cancellation.
      updated = await updatePolicyStateIfStatus(tx, {
        policyId,
        expectedStatuses: [locked.status],
        changes: { providerState: "CANCELLED", providerStateUpdatedAt: now },
      });
    }
    return { policy: updated ?? locked, preparation: done };
  });
  return { policy: result.policy, preparation: toCancelPreparationView(result.preparation), withdrawalTxSignature: confirmed.txSignature };
}
