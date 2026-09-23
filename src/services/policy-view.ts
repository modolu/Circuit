import "server-only";
import { z } from "zod";
import { USDC } from "../config/tokens.ts";
import type { DbExecutor } from "../db/client.ts";
import { findAssetById } from "../db/repositories/assets.ts";
import { findExecutionByPolicyId } from "../db/repositories/executions.ts";
import { findPolicyForWallet, listPoliciesForWallet, listPolicyEvents } from "../db/repositories/policies.ts";
import type { Execution, Policy, PolicyEvent } from "../db/schema.ts";
import { fromAtomicUnits } from "../domain/money.ts";
import { describePolicy, isSimulatedProvider, type PolicyStatus } from "../domain/policy.ts";

/* Client-safe policy views. Every read is scoped to the owning wallet. */

export interface PolicyAssetSummary {
  id: string;
  symbol: string;
  displayName: string;
  underlyingSymbol: string;
  mintAddress: string;
  decimals: number;
}

const snapshotSchema = z.object({
  symbol: z.string(),
  priceUsd: z.string(),
  freshness: z.enum(["FRESH", "CARRIED", "STALE"]),
  feedUpdateTimestamp: z.string(),
  marketSession: z.string().nullable().optional(),
});

export interface PolicyView {
  id: string;
  status: PolicyStatus;
  side: Policy["side"];
  triggerDirection: Policy["triggerDirection"];
  expressionType: Policy["sourceExpressionType"];
  sourceExpressionValue: string;
  compiledTriggerUsd: string;
  asset: PolicyAssetSummary;
  amount: { atomic: string; display: string; symbol: string };
  inputMint: string;
  outputMint: string;
  maxSlippageBps: number;
  expiresAt: string;
  createdAt: string;
  reference: z.infer<typeof snapshotSchema> | null;
  summary: string;
  provider: string;
  /** True when a simulated (mock) provider armed this policy. Its evidence is never onchain. */
  simulated: boolean;
  providerOrderId: string | null;
  armedAt: string | null;
  executedAt: string | null;
  cancelledAt: string | null;
  failure: { code: string; message: string | null } | null;
}

export interface ExecutionView {
  evidenceSource: Execution["evidenceSource"];
  providerOrderId: string;
  /** Null for simulated fills: there is no Solana transaction. */
  transactionSignature: string | null;
  inputAmountAtomic: string;
  outputAmountAtomic: string | null;
  executedAt: string;
}

export function toExecutionView(execution: Execution): ExecutionView {
  return {
    evidenceSource: execution.evidenceSource,
    providerOrderId: execution.providerOrderId,
    transactionSignature: execution.transactionSignature,
    inputAmountAtomic: execution.inputAmountAtomic.toString(),
    outputAmountAtomic: execution.outputAmountAtomic?.toString() ?? null,
    executedAt: execution.executedAt.toISOString(),
  };
}

export interface PolicyEventView {
  id: string;
  sequence: string;
  eventType: string;
  source: PolicyEvent["source"];
  createdAt: string;
}

export function toPolicyView(policy: Policy, asset: PolicyAssetSummary): PolicyView {
  const buying = policy.side === "BUY";
  const decimals = buying ? USDC.decimals : asset.decimals;
  const display = fromAtomicUnits(policy.amountAtomic, decimals);
  const snapshot = snapshotSchema.safeParse(policy.pythSnapshotJson);
  return {
    id: policy.id,
    status: policy.status,
    side: policy.side,
    triggerDirection: policy.triggerDirection,
    expressionType: policy.sourceExpressionType,
    sourceExpressionValue: policy.sourceExpressionValue,
    compiledTriggerUsd: policy.compiledTriggerUsd,
    asset,
    amount: { atomic: policy.amountAtomic.toString(), display, symbol: buying ? USDC.symbol : asset.symbol },
    inputMint: policy.inputMint,
    outputMint: policy.outputMint,
    maxSlippageBps: policy.maxSlippageBps,
    expiresAt: policy.expiresAt.toISOString(),
    createdAt: policy.createdAt.toISOString(),
    reference: snapshot.success ? snapshot.data : null,
    provider: policy.provider,
    simulated: isSimulatedProvider(policy.provider),
    providerOrderId: policy.providerOrderId,
    armedAt: policy.armedAt?.toISOString() ?? null,
    executedAt: policy.executedAt?.toISOString() ?? null,
    cancelledAt: policy.cancelledAt?.toISOString() ?? null,
    failure: policy.failureCode ? { code: policy.failureCode, message: policy.failureMessage } : null,
    summary: describePolicy({
      side: policy.side,
      direction: policy.triggerDirection,
      assetSymbol: asset.symbol,
      underlyingSymbol: asset.underlyingSymbol,
      quoteSymbol: USDC.symbol,
      amountDisplay: display,
      compiledTriggerUsd: policy.compiledTriggerUsd,
      expressionType: policy.sourceExpressionType,
      expressionValue: policy.sourceExpressionValue,
      referenceUsd: policy.pythReferenceUsd,
    }),
  };
}

export function toPolicyEventView(event: PolicyEvent): PolicyEventView {
  return {
    id: event.id,
    sequence: event.sequenceNumber.toString(),
    eventType: event.eventType,
    source: event.source,
    createdAt: event.createdAt.toISOString(),
  };
}

async function assetSummary(db: DbExecutor, assetId: string): Promise<PolicyAssetSummary | null> {
  const asset = await findAssetById(db, assetId);
  return asset
    ? {
        id: asset.id,
        symbol: asset.symbol,
        displayName: asset.displayName,
        underlyingSymbol: asset.underlyingSymbol,
        mintAddress: asset.mintAddress,
        decimals: asset.decimals,
      }
    : null;
}

/** Ownership is part of the query: another wallet's policy is indistinguishable from a missing one. */
export async function getPolicyViewForWallet(
  db: DbExecutor,
  { walletId, policyId }: { walletId: string; policyId: string },
): Promise<{ policy: PolicyView; events: PolicyEventView[]; execution: ExecutionView | null } | null> {
  const policy = await findPolicyForWallet(db, { policyId, walletId });
  if (!policy) return null;
  const asset = await assetSummary(db, policy.assetId);
  if (!asset) return null;
  const events = await listPolicyEvents(db, policy.id);
  const execution = await findExecutionByPolicyId(db, policy.id);
  return {
    policy: toPolicyView(policy, asset),
    events: events.map(toPolicyEventView),
    execution: execution ? toExecutionView(execution) : null,
  };
}

/** The view for a policy row that a lifecycle service has already scoped to the wallet. */
export async function policyViewFor(db: DbExecutor, policy: Policy): Promise<PolicyView> {
  const asset = await assetSummary(db, policy.assetId);
  if (!asset) throw new Error("policy asset missing");
  return toPolicyView(policy, asset);
}

export async function listPolicyViewsForWallet(db: DbExecutor, walletId: string, limit = 20): Promise<PolicyView[]> {
  const policies = await listPoliciesForWallet(db, walletId, { limit });
  const views: PolicyView[] = [];
  for (const policy of policies) {
    const asset = await assetSummary(db, policy.assetId);
    if (asset) views.push(toPolicyView(policy, asset));
  }
  return views;
}
