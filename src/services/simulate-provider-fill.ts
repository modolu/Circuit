import "server-only";
import type { Database } from "../db/client.ts";
import { appendPolicyEvent } from "../db/repositories/policies.ts";
import type { Wallet } from "../db/schema.ts";
import { AppError } from "../domain/errors.ts";
import { POLICY_EVENT_TYPES } from "../domain/policy.ts";
import { isSimulatedExecutionProvider, type ExecutionProvider } from "../integrations/jupiter/types.ts";
import { assertOrderBelongsToPolicy, assertProviderMatches, loadOwnedPolicy } from "./policy-lifecycle.ts";

/**
 * DEMO CONTROL, mock mode only. Tells the simulated provider that the order
 * filled. It changes simulated provider state only: Circuit's policy stays ARMED
 * until reconciliation mirrors it. Unavailable (NOT_FOUND) in live mode.
 */
export async function simulateProviderFill(
  db: Database,
  { wallet, policyId }: { wallet: Wallet; policyId: string },
  { provider }: { provider: ExecutionProvider },
): Promise<{ providerOrderId: string; providerState: string }> {
  if (!isSimulatedExecutionProvider(provider)) throw new AppError("NOT_FOUND", "Not found.");

  const policy = await loadOwnedPolicy(db, wallet.id, policyId);
  if (policy.status !== "ARMED" || !policy.providerOrderId) {
    throw new AppError("POLICY_STATE_CONFLICT", "Only an armed simulated order can be filled.");
  }
  assertProviderMatches(policy, provider);

  const order = await provider.simulateFill(policy.providerOrderId);
  assertOrderBelongsToPolicy(policy, order);
  await appendPolicyEvent(db, {
    policyId,
    eventType: POLICY_EVENT_TYPES.SIMULATED_FILL_REQUESTED,
    source: "USER",
    payload: { provider: provider.id, simulated: true, providerOrderId: order.providerOrderId, providerStateAfter: order.rawState },
  });
  return { providerOrderId: order.providerOrderId, providerState: order.rawState };
}
