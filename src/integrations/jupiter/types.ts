import type { ExecutionProviderId, TriggerCondition } from "../../domain/policy.ts";

/*
 * Circuit-owned execution-provider contract (CIRCUIT_ARCHITECTURE.md §11).
 * These are NOT Jupiter wire types. The live adapter will map documented
 * Trigger V2 DTOs into these shapes; the mock provider implements them directly.
 */

export interface CreateProviderOrderRequest {
  policyId: string;
  /** Application idempotency key: repeating it returns the same order, never a second one. */
  clientRequestId: string;
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: bigint;
  triggerUsd: string;
  triggerCondition: TriggerCondition;
  slippageBps: number;
  expiresAt: Date;
}

export interface ProviderOrder {
  providerOrderId: string;
  clientRequestId: string;
  /** Raw provider state. Normalize with `normalizeProviderState`; never guess unknown values. */
  rawState: string;
  createdAt: Date;
  expiresAt: Date;
  filledAt: Date | null;
  cancelledAt: Date | null;
}

export type ProviderFailureReason = "not_configured" | "rejected" | "unavailable" | "not_found";

export class ProviderError extends Error {
  override readonly name = "ProviderError";
  readonly reason: ProviderFailureReason;
  /** True when the provider definitely did not create or change anything, so it is safe to mark FAILED. */
  readonly definitive: boolean;

  constructor(reason: ProviderFailureReason, definitive: boolean) {
    super(`Execution provider error: ${reason}`);
    this.reason = reason;
    this.definitive = definitive;
  }
}

export interface ExecutionProvider {
  readonly id: ExecutionProviderId;
  /** True for the demo provider. Its events and evidence are always labelled simulated. */
  readonly simulated: boolean;
  /** False when this mode cannot place orders (live mode before the Jupiter adapter exists). */
  readonly configured: boolean;
  createOrder(request: CreateProviderOrderRequest): Promise<ProviderOrder>;
  getOrder(providerOrderId: string): Promise<ProviderOrder | null>;
  cancelOrder(providerOrderId: string): Promise<ProviderOrder>;
}

/** Only the simulated provider can be told that an order filled. */
export interface SimulatedExecutionProvider extends ExecutionProvider {
  readonly simulated: true;
  simulateFill(providerOrderId: string): Promise<ProviderOrder>;
}

export function isSimulatedExecutionProvider(provider: ExecutionProvider): provider is SimulatedExecutionProvider {
  return provider.simulated && "simulateFill" in provider;
}
