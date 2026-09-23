import "server-only";
import type { Database, DbExecutor } from "../db/client.ts";
import { insertExecutionOnce } from "../db/repositories/executions.ts";
import { appendPolicyEvent, findPolicyForWallet, updatePolicyStateIfStatus } from "../db/repositories/policies.ts";
import type { Policy } from "../db/schema.ts";
import { AppError } from "../domain/errors.ts";
import {
  armRequestId,
  policyStatusForProviderState,
  POLICY_EVENT_TYPES,
  type PolicyEventSource,
  type ProviderOrderState,
} from "../domain/policy.ts";
import type { ExecutionProvider, ProviderOrder } from "../integrations/jupiter/types.ts";

/* Shared lifecycle steps for arm, reconcile, cancel and the simulated fill. */

/** Ownership is part of the lookup: another wallet's policy reads as NOT_FOUND. */
export async function loadOwnedPolicy(db: DbExecutor, walletId: string, policyId: string): Promise<Policy> {
  const policy = await findPolicyForWallet(db, { policyId, walletId });
  if (!policy) throw new AppError("NOT_FOUND", "Policy not found.");
  return policy;
}

/** A policy is only ever managed by the provider that armed it. There is no live↔mock crossover. */
export function assertProviderMatches(policy: Policy, provider: ExecutionProvider): void {
  if (policy.provider !== provider.id) {
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      provider.simulated
        ? "This policy belongs to the live provider and cannot be managed by the simulated provider."
        : "This simulated policy can only be managed while Circuit runs in mock mode.",
    );
  }
}

export function providerEventSource(provider: ExecutionProvider): PolicyEventSource {
  return provider.simulated ? "MOCK_PROVIDER" : "JUPITER";
}

/** Rejects a provider order that isn't this policy's arm order. */
export function assertOrderBelongsToPolicy(policy: Policy, order: ProviderOrder): void {
  if (order.providerOrderId !== policy.providerOrderId || order.clientRequestId !== armRequestId(policy.id)) {
    throw new AppError("PROVIDER_REJECTED", "The provider order does not belong to this policy.");
  }
}

const PROVIDER_EVENT: Record<Exclude<ProviderOrderState, "OPEN">, string> = {
  FILLED: POLICY_EVENT_TYPES.PROVIDER_ORDER_FILLED,
  CANCELLED: POLICY_EVENT_TYPES.PROVIDER_ORDER_CANCELLED,
  EXPIRED: POLICY_EVENT_TYPES.PROVIDER_ORDER_EXPIRED,
  FAILED: POLICY_EVENT_TYPES.PROVIDER_ORDER_FAILED,
};

const POLICY_EVENT: Record<Exclude<ProviderOrderState, "OPEN">, string> = {
  FILLED: POLICY_EVENT_TYPES.EXECUTED,
  CANCELLED: POLICY_EVENT_TYPES.CANCELLED,
  EXPIRED: POLICY_EVENT_TYPES.EXPIRED,
  FAILED: POLICY_EVENT_TYPES.FAILED,
};

/**
 * Mirrors a terminal provider state into Circuit exactly once: a compare-and-set
 * from ARMED, then events and (for FILLED) the execution record, in one transaction.
 * Returns false when another writer already applied a transition.
 */
export async function applyTerminalProviderState(
  db: Database,
  { policy, order, state, provider, now }: {
    policy: Policy;
    order: ProviderOrder;
    state: Exclude<ProviderOrderState, "OPEN">;
    provider: ExecutionProvider;
    now: Date;
  },
): Promise<boolean> {
  if (state === "FILLED" && !provider.simulated) {
    // Live settlement evidence (signature, amounts) arrives with the Jupiter adapter.
    throw new AppError("PROVIDER_UNAVAILABLE", "Live fill evidence is not supported yet.");
  }
  const target = policyStatusForProviderState(state);
  return db.transaction(async (tx) => {
    const updated = await updatePolicyStateIfStatus(tx, {
      policyId: policy.id,
      expectedStatuses: ["ARMED"],
      changes: {
        status: target,
        ...(state === "FILLED" ? { executedAt: order.filledAt ?? now } : {}),
        ...(state === "CANCELLED" ? { cancelledAt: order.cancelledAt ?? now } : {}),
        ...(state === "FAILED" ? { failureCode: "PROVIDER_FAILED", failureMessage: "The provider reported the order as failed." } : {}),
      },
    });
    if (!updated) return false;

    const simulated = provider.simulated;
    await appendPolicyEvent(tx, {
      policyId: policy.id,
      eventType: PROVIDER_EVENT[state],
      source: providerEventSource(provider),
      payload: { provider: provider.id, simulated, providerOrderId: order.providerOrderId, providerState: order.rawState },
    });
    if (state === "FILLED") {
      await insertExecutionOnce(tx, {
        policyId: policy.id,
        providerOrderId: order.providerOrderId,
        // No Solana transaction exists for a simulated fill: no signature, no output amount.
        evidenceSource: "SIMULATED",
        transactionSignature: null,
        inputAmountAtomic: policy.amountAtomic,
        outputAmountAtomic: null,
        effectivePriceUsd: null,
        fillJson: { simulated: true, provider: provider.id, providerOrderId: order.providerOrderId, providerState: "FILLED" },
        executedAt: order.filledAt ?? now,
      });
    }
    await appendPolicyEvent(tx, {
      policyId: policy.id,
      eventType: POLICY_EVENT[state],
      source: "CIRCUIT",
      payload: { from: "ARMED", to: target, provider: provider.id, simulated },
    });
    return true;
  });
}
