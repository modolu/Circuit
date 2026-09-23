import "server-only";
import { USDC } from "../config/tokens.ts";
import type { Database } from "../db/client.ts";
import { appendPolicyEvent, insertPolicy } from "../db/repositories/policies.ts";
import type { Wallet } from "../db/schema.ts";
import { AppError } from "../domain/errors.ts";
import { POLICY_EVENT_TYPES } from "../domain/policy.ts";
import type { CreatePolicyRequest } from "../validation/policy.ts";
import { compilePolicy } from "./compile-policy.ts";
import type { AssetReference } from "./get-reference.ts";
import { toPolicyView, type PolicyView } from "./policy-view.ts";

/**
 * Loads the curated asset and a live Pyth reference for it. Production passes
 * `getAssetReference` backed by the real Pyth client; tests inject fixtures.
 * Callers can never supply a reference price.
 */
export type ReferenceLoader = (db: Database, assetId: string) => Promise<AssetReference>;

/**
 * Creates a DRAFT policy (CIRCUIT_ARCHITECTURE.md §12):
 * live reference → deterministic compile → one transaction writing the policy
 * plus POLICY_CREATED, REFERENCE_CAPTURED and POLICY_COMPILED, in that order.
 */
export async function createPolicyDraft(
  db: Database,
  { wallet, request, now = new Date() }: { wallet: Wallet; request: CreatePolicyRequest; now?: Date },
  { loadReference }: { loadReference: ReferenceLoader },
): Promise<PolicyView> {
  const { asset, reference } = await loadReference(db, request.assetId);
  if (!asset.reference.configured) {
    throw new AppError("ASSET_DISABLED", "This asset has no configured reference feed.");
  }

  const expiresAt = new Date(now.getTime() + request.expiryHours * 60 * 60 * 1000);
  const compiled = compilePolicy({
    asset,
    quote: USDC,
    side: request.side,
    triggerDirection: request.triggerDirection,
    expressionType: request.expressionType,
    expressionValue: request.expressionValue,
    amount: request.amount,
    maxSlippageBps: request.maxSlippageBps,
    now,
    expiresAt,
    referenceSnapshot: reference,
  });

  const policy = await db.transaction(async (tx) => {
    const created = await insertPolicy(tx, {
      walletId: wallet.id,
      assetId: asset.id,
      side: compiled.side,
      triggerDirection: compiled.triggerDirection,
      sourceExpressionType: compiled.expressionType,
      sourceExpressionValue: compiled.sourceExpressionValue,
      compiledTriggerUsd: compiled.compiledTriggerUsd,
      amountAtomic: compiled.inputAmountAtomic,
      inputMint: compiled.inputMint,
      outputMint: compiled.outputMint,
      maxSlippageBps: compiled.slippageBps,
      expiresAt: compiled.expiresAt,
      status: "DRAFT",
      pythReferenceUsd: reference.priceUsd,
      pythFeedTimestamp: new Date(reference.feedUpdateTimestamp),
      pythSnapshotJson: { ...reference },
      createdAt: now,
    });

    await appendPolicyEvent(tx, {
      policyId: created.id,
      eventType: POLICY_EVENT_TYPES.CREATED,
      source: "USER",
      payload: {
        wallet: wallet.address,
        assetId: asset.id,
        side: request.side,
        triggerDirection: request.triggerDirection,
        expressionType: request.expressionType,
        expressionValue: request.expressionValue,
        amount: request.amount,
        maxSlippageBps: request.maxSlippageBps,
        expiryHours: request.expiryHours,
      },
    });
    await appendPolicyEvent(tx, {
      policyId: created.id,
      eventType: POLICY_EVENT_TYPES.REFERENCE_CAPTURED,
      source: "CIRCUIT",
      payload: {
        provider: "pyth_pro",
        feedId: reference.feedId,
        symbol: reference.symbol,
        priceUsd: reference.priceUsd,
        freshness: reference.freshness,
        marketSession: reference.marketSession,
        feedUpdateTimestamp: reference.feedUpdateTimestamp,
        receivedTimestamp: reference.receivedTimestamp,
      },
    });
    await appendPolicyEvent(tx, {
      policyId: created.id,
      eventType: POLICY_EVENT_TYPES.COMPILED,
      source: "CIRCUIT",
      payload: {
        compiledTriggerUsd: compiled.compiledTriggerUsd,
        triggerCondition: compiled.triggerCondition,
        orderFamily: compiled.orderFamily,
        inputMint: compiled.inputMint,
        outputMint: compiled.outputMint,
        inputAmountAtomic: compiled.inputAmountAtomic.toString(),
        slippageBps: compiled.slippageBps,
        expiresAt: compiled.expiresAt.toISOString(),
        warnings: compiled.warnings,
      },
    });
    return created;
  });

  return toPolicyView(policy, asset);
}
