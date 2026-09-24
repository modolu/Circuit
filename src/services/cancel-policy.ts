import "server-only";
import type { Database } from "../db/client.ts";
import { appendPolicyEvent } from "../db/repositories/policies.ts";
import type { Policy, Wallet } from "../db/schema.ts";
import { AppError } from "../domain/errors.ts";
import { normalizeProviderState, POLICY_EVENT_TYPES } from "../domain/policy.ts";
import type { ExecutionProvider } from "../integrations/jupiter/types.ts";
import {
  applyTerminalProviderState,
  assertOrderBelongsToPolicy,
  assertProviderMatches,
  loadOwnedPolicy,
} from "./policy-lifecycle.ts";

/*
 * Cancels an ARMED policy (CIRCUIT_ARCHITECTURE.md §15). CANCELLED is recorded
 * only after the provider confirms it. If the provider already filled, expired
 * or failed the order, provider truth wins and that state is applied instead.
 */

export type CancelOutcome = "CANCELLED" | "ALREADY_FILLED" | "ALREADY_EXPIRED" | "ALREADY_FAILED";

export async function cancelPolicy(
  db: Database,
  { wallet, policyId, now = new Date() }: { wallet: Wallet; policyId: string; now?: Date },
  { provider }: { provider: ExecutionProvider },
): Promise<{ policy: Policy; outcome: CancelOutcome }> {
  const policy = await loadOwnedPolicy(db, wallet.id, policyId);
  if (!provider.configured && policy.provider === provider.id) {
    throw new AppError("POLICY_STATE_CONFLICT", "Live Jupiter orders are cancelled with Cancel & withdraw.");
  }
  if (policy.status !== "ARMED" || !policy.providerOrderId) {
    throw new AppError("POLICY_STATE_CONFLICT", `A ${policy.status} policy cannot be cancelled with the provider.`);
  }
  assertProviderMatches(policy, provider);

  await appendPolicyEvent(db, {
    policyId,
    eventType: POLICY_EVENT_TYPES.CANCEL_REQUESTED,
    source: "USER",
    payload: { provider: provider.id, simulated: provider.simulated, providerOrderId: policy.providerOrderId },
  });

  const order = await provider.cancelOrder(policy.providerOrderId);
  assertOrderBelongsToPolicy(policy, order);
  const state = normalizeProviderState(order.rawState);
  if (state === "OPEN" || state === "UNKNOWN") {
    throw new AppError("CANCELLATION_FAILED", "The provider has not confirmed the cancellation. The order may still be active.", {
      retryable: true,
    });
  }

  await applyTerminalProviderState(db, { policy, order, state, provider, now });
  const latest = await loadOwnedPolicy(db, wallet.id, policyId);
  const outcome: CancelOutcome =
    state === "CANCELLED" ? "CANCELLED" : state === "FILLED" ? "ALREADY_FILLED" : state === "EXPIRED" ? "ALREADY_EXPIRED" : "ALREADY_FAILED";
  return { policy: latest, outcome };
}
