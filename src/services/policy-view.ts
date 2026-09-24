import "server-only";
import { z } from "zod";
import { USDC } from "../config/tokens.ts";
import type { DbExecutor } from "../db/client.ts";
import { findAssetById } from "../db/repositories/assets.ts";
import { findExecutionByPolicyId } from "../db/repositories/executions.ts";
import { findActiveCancelPreparation, findLatestConfirmedCancelPreparation } from "../db/repositories/jupiter-cancel-preparations.ts";
import { findSubmittedDepositPreparation } from "../db/repositories/jupiter-deposit-preparations.ts";
import { findPolicyForWallet, listPoliciesForWallet, listPolicyEvents } from "../db/repositories/policies.ts";
import type { Execution, Policy, PolicyEvent } from "../db/schema.ts";
import { fromAtomicUnits } from "../domain/money.ts";
import { describePolicy, isSimulatedProvider, type PolicyStatus } from "../domain/policy.ts";
import { referenceName, referenceSnapshotSchema, type ReferenceFreshness, type ReferenceSnapshot } from "../domain/reference.ts";

/* Client-safe policy views. Every read is scoped to the owning wallet. */

export interface PolicyAssetSummary {
  id: string;
  symbol: string;
  displayName: string;
  underlyingSymbol: string;
  mintAddress: string;
  decimals: number;
}

/** The captured reference, provider-labelled. Provider detail stays provider-specific. */
export interface PolicyReferenceView {
  provider: "PYTH" | "PRESTOCKS";
  /** "Pyth AAPL reference" or "PreStocks mark". */
  name: string;
  /** Pyth feed symbol, or PreStocks product symbol. */
  symbol: string;
  priceUsd: string;
  freshness: ReferenceFreshness;
  timestampKind: "SOURCE" | "RECEIVED";
  /** SOURCE: provider generation time. RECEIVED: when Circuit received the response. */
  timestamp: string;
  marketSession: string | null;
  tokenPriceUsd: string | null;
  premiumPercent: string | null;
  productUrl: string | null;
}

export function toPolicyReferenceView(snapshot: ReferenceSnapshot, underlyingSymbol: string): PolicyReferenceView {
  const base = {
    provider: snapshot.provider,
    name: referenceName(snapshot.provider, underlyingSymbol),
    priceUsd: snapshot.priceUsd,
    freshness: snapshot.freshness,
    timestampKind: snapshot.timestampKind,
    timestamp: snapshot.sourceTimestamp ?? snapshot.receivedTimestamp,
  };
  return snapshot.provider === "PYTH"
    ? { ...base, symbol: snapshot.pyth.symbol, marketSession: snapshot.pyth.marketSession, tokenPriceUsd: null, premiumPercent: null, productUrl: null }
    : {
        ...base,
        symbol: snapshot.prestocks.symbol,
        marketSession: null,
        tokenPriceUsd: snapshot.prestocks.tokenPriceUsd,
        premiumPercent: snapshot.prestocks.premiumPercent,
        productUrl: snapshot.prestocks.productUrl,
      };
}

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
  reference: PolicyReferenceView | null;
  summary: string;
  provider: string;
  /** True when a simulated (mock) provider armed this policy. Its evidence is never onchain. */
  simulated: boolean;
  providerOrderId: string | null;
  armedAt: string | null;
  executedAt: string | null;
  cancelledAt: string | null;
  failure: { code: string; message: string | null } | null;
  /** Live Jupiter display state (e.g. EXECUTING, PENDING_WITHDRAW); null for drafts and simulated policies. */
  providerState: Policy["providerState"];
  /** Provider-reported progress only (strings). */
  providerProgress: { inputUsed: string | null; outputAmount: string | null; fillPercent: string | null; rawState: string | null } | null;
}

/** Live Jupiter evidence and pending steps for one policy (real signatures only). */
export interface LiveOrderDetails {
  depositPreparationId: string | null;
  depositTxSignature: string | null;
  vaultAddress: string | null;
  /** A withdrawal prepared but not yet confirmed: the user still has to sign/confirm it. */
  pendingWithdrawal: { id: string; purpose: "CANCEL" | "WITHDRAW_EXPIRED"; status: "PREPARED" | "SUBMITTING"; submitted: boolean } | null;
  withdrawalTxSignature: string | null;
  fillSignatures: string[];
}

export interface ExecutionView {
  evidenceSource: Execution["evidenceSource"];
  providerOrderId: string;
  /** Null for simulated fills: there is no Solana transaction. */
  transactionSignature: string | null;
  inputAmountAtomic: string;
  outputAmountAtomic: string | null;
  executedAt: string;
  /** Every provider-reported fill signature (ONCHAIN only), oldest first. */
  fillSignatures: string[];
}

const fillJsonSchema = z.object({
  fills: z.array(z.object({ txSignature: z.string().nullable(), state: z.string().nullable() })).default([]),
});

export function toExecutionView(execution: Execution): ExecutionView {
  return {
    evidenceSource: execution.evidenceSource,
    providerOrderId: execution.providerOrderId,
    transactionSignature: execution.transactionSignature,
    inputAmountAtomic: execution.inputAmountAtomic.toString(),
    outputAmountAtomic: execution.outputAmountAtomic?.toString() ?? null,
    executedAt: execution.executedAt.toISOString(),
    fillSignatures:
      execution.evidenceSource === "ONCHAIN"
        ? (fillJsonSchema.safeParse(execution.fillJson).data?.fills ?? [])
            .filter((fill) => fill.state !== "failed" && fill.state !== "pending")
            .flatMap((fill) => (fill.txSignature ? [fill.txSignature] : []))
        : [],
  };
}

const nullableString = z.string().nullable().catch(null).default(null);
const progressSchema = z.object({
  inputUsed: nullableString,
  outputAmount: nullableString,
  fillPercent: nullableString,
  rawState: nullableString,
});

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
  const snapshot = referenceSnapshotSchema.safeParse(policy.referenceSnapshotJson);
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
    reference: snapshot.success ? toPolicyReferenceView(snapshot.data, asset.underlyingSymbol) : null,
    provider: policy.provider,
    simulated: isSimulatedProvider(policy.provider),
    providerOrderId: policy.providerOrderId,
    armedAt: policy.armedAt?.toISOString() ?? null,
    executedAt: policy.executedAt?.toISOString() ?? null,
    cancelledAt: policy.cancelledAt?.toISOString() ?? null,
    failure: policy.failureCode ? { code: policy.failureCode, message: policy.failureMessage } : null,
    providerState: policy.providerState,
    providerProgress: progressSchema.safeParse(policy.providerProgressJson).data ?? null,
    summary: describePolicy({
      side: policy.side,
      direction: policy.triggerDirection,
      assetSymbol: asset.symbol,
      underlyingSymbol: asset.underlyingSymbol,
      referenceName: referenceName(policy.referenceProvider, asset.underlyingSymbol),
      quoteSymbol: USDC.symbol,
      amountDisplay: display,
      compiledTriggerUsd: policy.compiledTriggerUsd,
      expressionType: policy.sourceExpressionType,
      expressionValue: policy.sourceExpressionValue,
      referenceUsd: policy.referenceUsd,
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
): Promise<{ policy: PolicyView; events: PolicyEventView[]; execution: ExecutionView | null; live: LiveOrderDetails | null } | null> {
  const policy = await findPolicyForWallet(db, { policyId, walletId });
  if (!policy) return null;
  const asset = await assetSummary(db, policy.assetId);
  if (!asset) return null;
  const events = await listPolicyEvents(db, policy.id);
  const execution = await findExecutionByPolicyId(db, policy.id);
  const executionView = execution ? toExecutionView(execution) : null;
  return {
    policy: toPolicyView(policy, asset),
    events: events.map(toPolicyEventView),
    execution: executionView,
    live: isSimulatedProvider(policy.provider) || policy.status === "DRAFT" ? null : await liveOrderDetails(db, policy.id, executionView),
  };
}

async function liveOrderDetails(db: DbExecutor, policyId: string, execution: ExecutionView | null): Promise<LiveOrderDetails> {
  const deposit = await findSubmittedDepositPreparation(db, policyId);
  const pending = await findActiveCancelPreparation(db, policyId);
  const confirmed = await findLatestConfirmedCancelPreparation(db, policyId);
  return {
    depositPreparationId: deposit?.id ?? null,
    depositTxSignature: deposit?.depositTxSignature ?? null,
    vaultAddress: deposit?.receiverAddress ?? null,
    pendingWithdrawal: pending
      ? { id: pending.id, purpose: pending.purpose, status: pending.status as "PREPARED" | "SUBMITTING", submitted: pending.status === "SUBMITTING" }
      : null,
    withdrawalTxSignature: confirmed?.withdrawalTxSignature ?? null,
    fillSignatures: execution?.fillSignatures ?? [],
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
