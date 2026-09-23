import "server-only";
import type { Database } from "../db/client.ts";
import type { Policy, Wallet } from "../db/schema.ts";
import { AppError } from "../domain/errors.ts";
import { isTerminalStatus, normalizeProviderState } from "../domain/policy.ts";
import type { ExecutionProvider } from "../integrations/jupiter/types.ts";
import { logger } from "../observability/logger.ts";
import {
  applyTerminalProviderState,
  assertOrderBelongsToPolicy,
  assertProviderMatches,
  loadOwnedPolicy,
} from "./policy-lifecycle.ts";

/*
 * Mirrors the provider's order state into Circuit (CIRCUIT_ARCHITECTURE.md §14).
 * Idempotent: unchanged state writes nothing; a terminal state is applied once.
 * Unknown provider states are logged and left alone, never guessed at.
 */

export interface ReconcileResult {
  policy: Policy;
  changed: boolean;
  providerState: string | null;
  diagnostic?: string;
}

export async function reconcilePolicy(
  db: Database,
  { wallet, policyId, now = new Date() }: { wallet: Wallet; policyId: string; now?: Date },
  { provider }: { provider: ExecutionProvider },
): Promise<ReconcileResult> {
  const policy = await loadOwnedPolicy(db, wallet.id, policyId);
  if (isTerminalStatus(policy.status)) return { policy, changed: false, providerState: null };
  if (policy.status !== "ARMED" || !policy.providerOrderId) {
    throw new AppError("POLICY_STATE_CONFLICT", "Only armed policies can be reconciled.");
  }
  assertProviderMatches(policy, provider);

  const order = await provider.getOrder(policy.providerOrderId);
  if (!order) {
    logger.warn("reconcile.order_not_found", { policyId, providerOrderId: policy.providerOrderId });
    throw new AppError("ORDER_NOT_FOUND", "The provider has no record of this order.");
  }
  assertOrderBelongsToPolicy(policy, order);

  const state = normalizeProviderState(order.rawState);
  if (state === "UNKNOWN") {
    logger.warn("reconcile.unknown_state", { policyId, providerOrderId: order.providerOrderId, rawState: order.rawState });
    return { policy, changed: false, providerState: order.rawState, diagnostic: "The provider reported an unrecognized state. No change was made." };
  }
  if (state === "OPEN") return { policy, changed: false, providerState: state };

  const changed = await applyTerminalProviderState(db, { policy, order, state, provider, now });
  const latest = await loadOwnedPolicy(db, wallet.id, policyId);
  return { policy: latest, changed, providerState: state };
}
