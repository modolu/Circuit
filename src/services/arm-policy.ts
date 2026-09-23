import "server-only";
import type { Database } from "../db/client.ts";
import { appendPolicyEvent, lockPolicyForUpdate, updatePolicyStateIfStatus } from "../db/repositories/policies.ts";
import type { Policy, Wallet } from "../db/schema.ts";
import { AppError } from "../domain/errors.ts";
import { armRequestId, normalizeProviderState, POLICY_EVENT_TYPES, triggerCondition } from "../domain/policy.ts";
import { ProviderError, type ExecutionProvider, type ProviderOrder } from "../integrations/jupiter/types.ts";
import { assertOrderBelongsToPolicy, providerEventSource } from "./policy-lifecycle.ts";

/*
 * Arms a DRAFT (CIRCUIT_ARCHITECTURE.md §13, §24):
 * DRAFT → ARMING (row lock) → provider createOrder (idempotent on the policy's
 * fixed client request id) → ARMING → ARMED with the provider order id.
 * ARMED is never set before the provider confirms the order exists. Concurrent or
 * repeated requests resume the same ARMING attempt and get the same single order.
 */

type Claim = { kind: "already_armed"; policy: Policy } | { kind: "arming"; policy: Policy };

async function claimForArming(db: Database, { walletId, policyId, provider, now }: {
  walletId: string;
  policyId: string;
  provider: ExecutionProvider;
  now: Date;
}): Promise<Claim> {
  return db.transaction(async (tx) => {
    const policy = await lockPolicyForUpdate(tx, policyId);
    if (!policy || policy.walletId !== walletId) throw new AppError("NOT_FOUND", "Policy not found.");

    if (policy.status === "ARMED") {
      if (policy.provider !== provider.id) throw new AppError("POLICY_STATE_CONFLICT", "This policy was armed with another provider.");
      return { kind: "already_armed", policy };
    }
    if (policy.status === "ARMING") {
      if (policy.provider !== provider.id) throw new AppError("POLICY_STATE_CONFLICT", "This policy is being armed with another provider.");
      return { kind: "arming", policy };
    }
    if (policy.status !== "DRAFT") {
      throw new AppError("POLICY_STATE_CONFLICT", `A ${policy.status} policy cannot be armed.`);
    }
    if (policy.expiresAt.getTime() <= now.getTime()) {
      throw new AppError("POLICY_EXPIRED", "This draft has passed its expiry and can no longer be armed.");
    }

    const arming = await updatePolicyStateIfStatus(tx, {
      policyId,
      expectedStatuses: ["DRAFT"],
      changes: { status: "ARMING", provider: provider.id },
    });
    if (!arming) throw new AppError("POLICY_STATE_CONFLICT", "The policy changed while arming. Refresh and try again.");
    await appendPolicyEvent(tx, {
      policyId,
      eventType: POLICY_EVENT_TYPES.ARMING,
      source: "CIRCUIT",
      payload: { provider: provider.id, simulated: provider.simulated, clientRequestId: armRequestId(policyId) },
    });
    return { kind: "arming", policy: arming };
  });
}

async function markArmFailed(db: Database, policy: Policy, provider: ExecutionProvider, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const failed = await updatePolicyStateIfStatus(tx, {
      policyId: policy.id,
      expectedStatuses: ["ARMING"],
      changes: {
        status: "FAILED",
        failureCode: "PROVIDER_REJECTED",
        failureMessage: "The execution provider rejected the order.",
      },
    });
    if (!failed) return;
    await appendPolicyEvent(tx, {
      policyId: policy.id,
      eventType: POLICY_EVENT_TYPES.FAILED,
      source: "CIRCUIT",
      payload: { from: "ARMING", to: "FAILED", provider: provider.id, simulated: provider.simulated, reason },
    });
  });
}

export async function armPolicy(
  db: Database,
  { wallet, policyId, now = new Date() }: { wallet: Wallet; policyId: string; now?: Date },
  { provider }: { provider: ExecutionProvider },
): Promise<Policy> {
  if (!provider.configured) {
    throw new AppError("PROVIDER_UNAVAILABLE", "Live Jupiter execution is not configured yet.");
  }

  const claim = await claimForArming(db, { walletId: wallet.id, policyId, provider, now });
  if (claim.kind === "already_armed") return claim.policy;
  const policy = claim.policy;

  let order: ProviderOrder;
  try {
    order = await provider.createOrder({
      policyId: policy.id,
      clientRequestId: armRequestId(policy.id),
      inputMint: policy.inputMint,
      outputMint: policy.outputMint,
      inputAmountAtomic: policy.amountAtomic,
      triggerUsd: policy.compiledTriggerUsd,
      triggerCondition: triggerCondition(policy.triggerDirection),
      slippageBps: policy.maxSlippageBps,
      expiresAt: policy.expiresAt,
    });
  } catch (error) {
    if (error instanceof ProviderError && error.definitive) {
      await markArmFailed(db, policy, provider, error.reason);
      throw new AppError("PROVIDER_REJECTED", "The execution provider rejected the order. The policy is marked FAILED.");
    }
    // Ambiguous outcome: stay ARMING. A retry resumes with the same client request id,
    // so it can never create a second order.
    throw new AppError("PROVIDER_UNAVAILABLE", "The execution provider did not respond. Try arming again.", { retryable: true });
  }

  if (order.clientRequestId !== armRequestId(policy.id) || normalizeProviderState(order.rawState) !== "OPEN") {
    throw new AppError("PROVIDER_REJECTED", "The provider returned an unexpected order.");
  }

  return db.transaction(async (tx) => {
    const armed = await updatePolicyStateIfStatus(tx, {
      policyId: policy.id,
      expectedStatuses: ["ARMING"],
      changes: { status: "ARMED", providerOrderId: order.providerOrderId, armedAt: now },
    });
    if (!armed) {
      // A concurrent request completed the same arm first; it must hold the same order.
      const current = await lockPolicyForUpdate(tx, policy.id);
      if (current?.status === "ARMED") {
        assertOrderBelongsToPolicy(current, order);
        return current;
      }
      throw new AppError("POLICY_STATE_CONFLICT", "The policy changed while arming. Refresh to see its state.");
    }
    await appendPolicyEvent(tx, {
      policyId: policy.id,
      eventType: POLICY_EVENT_TYPES.PROVIDER_ORDER_CREATED,
      source: providerEventSource(provider),
      payload: { provider: provider.id, simulated: provider.simulated, providerOrderId: order.providerOrderId, providerState: order.rawState },
    });
    await appendPolicyEvent(tx, {
      policyId: policy.id,
      eventType: POLICY_EVENT_TYPES.ARMED,
      source: "CIRCUIT",
      payload: { from: "ARMING", to: "ARMED", provider: provider.id, simulated: provider.simulated, providerOrderId: order.providerOrderId },
    });
    return armed;
  });
}
