import "server-only";
import type { Database } from "../../db/client.ts";
import { consumeDepositPreparation, findSubmittedDepositPreparation } from "../../db/repositories/jupiter-deposit-preparations.ts";
import { appendPolicyEvent, listPolicyEvents, lockPolicyForUpdate, updatePolicyStateIfStatus } from "../../db/repositories/policies.ts";
import type { Policy, Wallet } from "../../db/schema.ts";
import { AppError } from "../../domain/errors.ts";
import { EXECUTION_PROVIDERS, POLICY_EVENT_TYPES } from "../../domain/policy.ts";
import type { JupiterClient } from "../../integrations/jupiter/client.ts";
import type { ExecutionProvider } from "../../integrations/jupiter/types.ts";
import { logger } from "../../observability/logger.ts";
import { loadOwnedPolicy } from "../policy-lifecycle.ts";
import { reconcilePolicy } from "../reconcile-policy.ts";
import { requireJupiterJwt, requireLiveMode } from "./errors.ts";
import { applyLiveOrder, assertOrderMatchesPolicy, findOrderById, findOrdersByDeposit } from "./live-orders.ts";

/*
 * Live reconciliation from Jupiter order history (Task 9). Reads only: it never signs,
 * submits or re-sends a transaction, so it is safe on page load and on "Reconcile now".
 *
 * - ARMING without a provider order id: search history (active + past) for an order whose
 *   deposit event carries the persisted deposit signature and whose wallet, mints and
 *   initial amount match. One match → record it and continue. Zero → still pending.
 *   Several → PROVIDER_AMBIGUOUS: nothing is guessed.
 * - Known provider order id: find that exact order, verify it belongs to the wallet and
 *   policy, then mirror its state (see applyLiveOrder).
 */

export interface LiveReconcileResult {
  policy: Policy;
  changed: boolean;
  providerState: string | null;
  diagnostic?: string;
}

async function recordRecoveredOrder(db: Database, { policyId, prepId, orderId, depositTxSignature, now }: {
  policyId: string;
  prepId: string;
  orderId: string;
  depositTxSignature: string;
  now: Date;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await lockPolicyForUpdate(tx, policyId);
    if (!current || current.status !== "ARMING" || current.providerOrderId) return;
    await consumeDepositPreparation(tx, { id: prepId, providerOrderId: orderId, now });
    await updatePolicyStateIfStatus(tx, { policyId, expectedStatuses: ["ARMING"], changes: { providerOrderId: orderId } });
    await appendPolicyEvent(tx, {
      policyId,
      eventType: POLICY_EVENT_TYPES.PROVIDER_ORDER_RECOVERED,
      source: "JUPITER",
      payload: { provider: EXECUTION_PROVIDERS.LIVE, providerOrderId: orderId, depositTxSignature, matchedBy: "deposit_signature+wallet+mints+amount" },
    });
  });
}

export async function reconcileLivePolicy(
  db: Database,
  { wallet, policyId, jwt, mode, now = new Date() }: { wallet: Wallet; policyId: string; jwt: string | null; mode: "mock" | "live"; now?: Date },
  { client }: { client: JupiterClient },
): Promise<LiveReconcileResult> {
  requireLiveMode(mode);
  const policy = await loadOwnedPolicy(db, wallet.id, policyId);
  if (policy.provider !== EXECUTION_PROVIDERS.LIVE) {
    throw new AppError("PROVIDER_UNAVAILABLE", "This simulated policy can only be managed while Circuit runs in mock mode.");
  }
  if (policy.status === "DRAFT") throw new AppError("POLICY_STATE_CONFLICT", "A draft has no Jupiter order to reconcile.");
  // EXPIRED keeps refreshing its provider state so the UI knows whether funds were withdrawn.
  if (policy.status === "EXECUTED" || policy.status === "CANCELLED" || (policy.status === "FAILED" && !policy.providerOrderId)) {
    return { policy, changed: false, providerState: policy.providerState };
  }
  const token = requireJupiterJwt(jwt);

  const orderId = policy.providerOrderId;
  if (!orderId) {
    const prep = await findSubmittedDepositPreparation(db, policy.id);
    if (!prep?.depositTxSignature) {
      return { policy, changed: false, providerState: null, diagnostic: "No signed deposit is recorded for this policy, so there is nothing to recover." };
    }
    const matches = await findOrdersByDeposit(client, token, { policy, walletAddress: wallet.address, depositTxSignature: prep.depositTxSignature });
    if (matches.length === 0) {
      return {
        policy,
        changed: false,
        providerState: null,
        diagnostic: "Jupiter has no order for this deposit yet. Circuit will not ask for another deposit; reconcile again shortly.",
      };
    }
    if (matches.length > 1) {
      logger.warn("reconcile.provider_ambiguous", { policyId, candidates: matches.map((m) => m.id) });
      const events = await listPolicyEvents(db, policyId);
      if (!events.some((event) => event.eventType === POLICY_EVENT_TYPES.PROVIDER_ORDER_AMBIGUOUS)) {
        await appendPolicyEvent(db, {
          policyId,
          eventType: POLICY_EVENT_TYPES.PROVIDER_ORDER_AMBIGUOUS,
          source: "CIRCUIT",
          payload: { depositTxSignature: prep.depositTxSignature, candidateOrderIds: matches.map((m) => m.id) },
        });
      }
      throw new AppError("PROVIDER_REJECTED", "Jupiter reports more than one order for this deposit. Circuit will not guess which one is yours.", {
        cause: "PROVIDER_AMBIGUOUS",
      });
    }
    const match = matches[0]!;
    await recordRecoveredOrder(db, { policyId, prepId: prep.id, orderId: match.id, depositTxSignature: prep.depositTxSignature, now });
    const applied = await applyLiveOrder(db, { policyId, order: match, now });
    return { policy: await loadOwnedPolicy(db, wallet.id, policyId), changed: true, providerState: applied.providerState, ...(applied.diagnostic ? { diagnostic: applied.diagnostic } : {}) };
  }

  const order = await findOrderById(client, token, { orderId, mint: policy.outputMint });
  if (!order) {
    logger.warn("reconcile.order_not_found", { policyId, providerOrderId: orderId });
    return { policy, changed: false, providerState: policy.providerState, diagnostic: "Jupiter's order history does not list this order yet." };
  }
  assertOrderMatchesPolicy(order, policy, wallet.address);
  if (policy.status === "ARMING") {
    const prep = await findSubmittedDepositPreparation(db, policy.id);
    if (prep?.status === "CRAFTED") await consumeDepositPreparation(db, { id: prep.id, providerOrderId: order.id, now });
  }
  const applied = await applyLiveOrder(db, { policyId, order, now });
  return {
    policy: await loadOwnedPolicy(db, wallet.id, policyId),
    changed: applied.changed,
    providerState: applied.providerState,
    ...(applied.diagnostic ? { diagnostic: applied.diagnostic } : {}),
  };
}

/**
 * Reconcile entry point for the shared route and page load: a live policy reconciles
 * against Jupiter history, a simulated one against the mock provider. Never crosses over.
 */
export async function reconcileForMode(
  db: Database,
  { wallet, policyId, jwt, mode, now = new Date() }: { wallet: Wallet; policyId: string; jwt: string | null; mode: "mock" | "live"; now?: Date },
  deps: { provider: ExecutionProvider; client: JupiterClient },
): Promise<LiveReconcileResult> {
  const policy = await loadOwnedPolicy(db, wallet.id, policyId);
  if (policy.provider === EXECUTION_PROVIDERS.LIVE && policy.status !== "DRAFT") {
    return reconcileLivePolicy(db, { wallet, policyId, jwt, mode, now }, { client: deps.client });
  }
  return reconcilePolicy(db, { wallet, policyId, now }, { provider: deps.provider });
}
