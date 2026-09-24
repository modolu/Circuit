import "server-only";
import { USDC } from "../../config/tokens.ts";
import type { Database } from "../../db/client.ts";
import {
  claimDepositResubmission,
  consumeDepositPreparation,
  findDepositPreparation,
  invalidateDepositPreparation,
  markDepositSubmissionStarted,
} from "../../db/repositories/jupiter-deposit-preparations.ts";
import { appendPolicyEvent, lockPolicyForUpdate, updatePolicyStateIfStatus } from "../../db/repositories/policies.ts";
import type { JupiterDepositPreparation, Policy, Wallet } from "../../db/schema.ts";
import { AppError } from "../../domain/errors.ts";
import { EXECUTION_PROVIDERS, POLICY_EVENT_TYPES } from "../../domain/policy.ts";
import { JupiterRequestError, type JupiterClient } from "../../integrations/jupiter/client.ts";
import { createSinglePriceOrderRequestSchema, type CreateOrderResponse } from "../../integrations/jupiter/schemas.ts";
import { SignedTransactionError, verifySignedTransaction } from "../../integrations/jupiter/signed-transaction.ts";
import { toCreatePriceOrderRequest, toJupiterSinglePriceOrderIntent } from "../../integrations/jupiter/trigger.ts";
import { logger } from "../../observability/logger.ts";
import { loadOwnedPolicy } from "../policy-lifecycle.ts";
import { requireJupiterJwt, requireLiveMode, toJupiterAppError } from "./errors.ts";
import { assertLiveBuyEligible } from "./live-gates.ts";
import { applyLiveOrder, findOrdersByDeposit } from "./live-orders.ts";

/*
 * Live arm (CIRCUIT_ARCHITECTURE.md §13, Task 9):
 *
 *   owned DRAFT + all live gates + a CRAFTED preparation
 *   → verify the wallet-signed deposit is EXACTLY the prepared transaction (message bytes,
 *     wallet Ed25519 signature, no other changes)
 *   → ONE DB transaction: commit the public deposit signature (+ the signed tx, transiently)
 *     and DRAFT → ARMING with events
 *   → POST /orders/price with values loaded from the policy/config/preparation only
 *   → on 200: provider order id + CONSUMED preparation; ARMED only when Jupiter confirms
 *     the deposit landed (depositConfirmed) and the returned deposit signature matches.
 *
 * Failure semantics: a timeout, network error, 5xx, duplicate-deposit or malformed
 * response is AMBIGUOUS (the deposit may have landed): the policy stays ARMING and is
 * recovered through history by the persisted deposit signature. No new deposit, requestId
 * or wallet signature is ever requested for it. Only a documented pre-landing rejection
 * (400 validation / invalid signed deposit, 403 wallet mismatch) marks the policy FAILED.
 * A 401 (JWT expired) keeps ARMING; after re-authentication the SAME signed deposit is
 * resubmitted (Jupiter documents create retries with the same deposit as idempotent).
 */

/** A resubmission never overlaps an in-flight create call (its client timeout is 45 s). */
export const RESUBMIT_AFTER_MS = 60_000;

export type LiveArmOutcome = "ARMED" | "CONFIRMATION_PENDING" | "ALREADY_ARMED" | "RECOVERED";

export interface LiveArmResult {
  policy: Policy;
  outcome: LiveArmOutcome;
  depositTxSignature: string | null;
}

function assertPreparationForPolicy(prep: JupiterDepositPreparation | undefined, policy: Policy, wallet: Wallet): JupiterDepositPreparation {
  if (!prep || prep.walletId !== wallet.id) throw new AppError("NOT_FOUND", "Deposit preparation not found.");
  if (
    prep.inputMint !== policy.inputMint ||
    prep.outputMint !== policy.outputMint ||
    prep.inputAmountAtomic !== policy.amountAtomic ||
    !prep.unsignedTransaction ||
    !prep.depositRequestId
  ) {
    throw new AppError("POLICY_STATE_CONFLICT", "This deposit preparation does not match the policy.");
  }
  return prep;
}

function signatureRejection(error: unknown): AppError {
  const reason = error instanceof SignedTransactionError ? error.reason : "malformed";
  const message =
    reason === "message_mismatch"
      ? "The signed transaction is not the deposit Circuit prepared. Nothing was submitted."
      : reason === "signer_missing" || reason === "signature_invalid" || reason === "signature_missing"
        ? "The deposit must be signed by the wallet signed in to Circuit. Nothing was submitted."
        : "The signed deposit transaction is invalid. Nothing was submitted.";
  return new AppError("VALIDATION_ERROR", message, { cause: `SIGNED_TX_${reason.toUpperCase()}` });
}

/** Definitive = Jupiter documents that the order was not created and the deposit did not land. */
function isDefinitiveRejection(error: unknown): boolean {
  if (!(error instanceof JupiterRequestError)) return false;
  if (error.reason === "forbidden") return true;
  if (error.reason === "bad_request") return !/duplicate/i.test(error.providerMessage ?? "");
  return false;
}

export async function armLivePolicy(
  db: Database,
  {
    wallet,
    policyId,
    preparationId,
    signedTransaction,
    jwt,
    mode,
    now = new Date(),
  }: {
    wallet: Wallet;
    policyId: string;
    preparationId: string;
    /** Base64 wallet-signed deposit. Omit only to resubmit the stored one for an ARMING policy. */
    signedTransaction?: string;
    jwt: string | null;
    mode: "mock" | "live";
    now?: Date;
  },
  { client }: { client: JupiterClient },
): Promise<LiveArmResult> {
  requireLiveMode(mode);
  const token = requireJupiterJwt(jwt);

  const policy = await loadOwnedPolicy(db, wallet.id, policyId);
  if (policy.status !== "DRAFT" && policy.provider !== EXECUTION_PROVIDERS.LIVE) {
    throw new AppError("POLICY_STATE_CONFLICT", "This policy is managed by the simulated provider.");
  }
  if (["ARMED", "EXECUTED", "CANCELLED", "EXPIRED", "FAILED"].includes(policy.status)) {
    return { policy, outcome: "ALREADY_ARMED", depositTxSignature: null };
  }
  if (policy.status === "ARMING" && policy.providerOrderId) {
    throw new AppError("POLICY_STATE_CONFLICT", "Jupiter already created this order and is confirming the deposit. Use Reconcile to refresh it.");
  }
  if (policy.status === "DRAFT") {
    if (policy.expiresAt.getTime() <= now.getTime()) throw new AppError("POLICY_EXPIRED", "This draft has passed its expiry.");
    await assertLiveBuyEligible(db, policy);
  } else if (policy.side !== "BUY") {
    throw new AppError("ASSET_DISABLED", "Live sell orders are not enabled.");
  }

  const prep = assertPreparationForPolicy(await findDepositPreparation(db, { id: preparationId, policyId }), policy, wallet);
  if (prep.status !== "CRAFTED") {
    throw new AppError("POLICY_STATE_CONFLICT", "This deposit preparation can no longer be used. Prepare a new deposit.");
  }
  const unsigned = prep.unsignedTransaction as string;

  // 1. Prove the signed transaction is exactly the prepared one, signed by this wallet.
  const candidate = signedTransaction ?? prep.signedTransaction;
  if (!candidate) throw new AppError("VALIDATION_ERROR", "Sign the prepared deposit in your wallet first.");
  let verified;
  try {
    verified = verifySignedTransaction({ preparedUnsignedBase64: unsigned, signedBase64: candidate, walletAddress: wallet.address });
  } catch (error) {
    throw signatureRejection(error);
  }
  const depositTxSignature = verified.transactionSignature;
  if (!depositTxSignature) throw signatureRejection(new SignedTransactionError("fee_payer_mismatch"));

  // 2. Commit the recovery anchor and DRAFT → ARMING before any provider call.
  const resubmission = policy.status === "ARMING";
  if (resubmission) {
    if (prep.depositTxSignature !== depositTxSignature) {
      throw new AppError("POLICY_STATE_CONFLICT", "A different deposit was already submitted for this policy. Nothing was submitted.");
    }
    // The same deposit may already have landed: look before resubmitting.
    const found = await findOrdersByDeposit(client, token, { policy, walletAddress: wallet.address, depositTxSignature });
    if (found.length === 1) {
      const recovered = await recordProviderOrder(db, { policy, prep, orderId: found[0]!.id, depositTxSignature, now, recovered: true });
      await applyLiveOrder(db, { policyId, order: found[0]!, now });
      return { policy: (await loadOwnedPolicy(db, wallet.id, policyId)) ?? recovered, outcome: "RECOVERED", depositTxSignature };
    }
    if (found.length > 1) {
      throw new AppError("PROVIDER_REJECTED", "Jupiter reports more than one order for this deposit. Circuit will not guess; contact support.", {
        cause: "PROVIDER_AMBIGUOUS",
      });
    }
    const claimed = await claimDepositResubmission(db, {
      id: prep.id,
      depositTxSignature,
      olderThan: new Date(now.getTime() - RESUBMIT_AFTER_MS),
      now,
    });
    if (!claimed) {
      throw new AppError("POLICY_STATE_CONFLICT", "The deposit was submitted moments ago. Reconcile shortly instead of resubmitting.", { retryable: true });
    }
  } else {
    await db.transaction(async (tx) => {
      const locked = await lockPolicyForUpdate(tx, policyId);
      if (locked?.status !== "DRAFT") throw new AppError("POLICY_STATE_CONFLICT", "The policy changed while arming. Refresh to see its state.");
      const marked = await markDepositSubmissionStarted(tx, {
        id: prep.id,
        depositTxSignature,
        signedTransaction: verified.signedTransactionBase64,
        now,
      });
      if (!marked) throw new AppError("POLICY_STATE_CONFLICT", "This deposit is already being submitted. Refresh to see its status.");
      const arming = await updatePolicyStateIfStatus(tx, {
        policyId,
        expectedStatuses: ["DRAFT"],
        changes: { status: "ARMING", provider: EXECUTION_PROVIDERS.LIVE },
      });
      if (!arming) throw new AppError("POLICY_STATE_CONFLICT", "The policy changed while arming. Refresh to see its state.");
      await appendPolicyEvent(tx, {
        policyId,
        eventType: POLICY_EVENT_TYPES.DEPOSIT_SIGNED,
        source: "USER",
        payload: { preparationId: prep.id, depositTxSignature, depositRequestId: prep.depositRequestId },
      });
      await appendPolicyEvent(tx, {
        policyId,
        eventType: POLICY_EVENT_TYPES.ARMING,
        source: "CIRCUIT",
        payload: { provider: EXECUTION_PROVIDERS.LIVE, simulated: false, depositTxSignature },
      });
    });
  }

  // 3. Build the order body from persisted policy/config/preparation values only.
  const intent = toJupiterSinglePriceOrderIntent(
    {
      side: policy.side,
      triggerDirection: policy.triggerDirection,
      inputMint: policy.inputMint,
      outputMint: policy.outputMint,
      inputAmountAtomic: policy.amountAtomic,
      compiledTriggerUsd: policy.compiledTriggerUsd,
      slippageBps: policy.maxSlippageBps,
      expiresAt: policy.expiresAt,
    },
    { stockMint: policy.outputMint, quoteMint: USDC.mintAddress, now },
  );
  const body = createSinglePriceOrderRequestSchema.parse(
    toCreatePriceOrderRequest(intent, {
      depositRequestId: prep.depositRequestId as string,
      depositSignedTx: verified.signedTransactionBase64,
      userPubkey: wallet.address,
    }),
  );

  // 4. Create. Outside any DB transaction.
  let created: CreateOrderResponse;
  try {
    created = await client.createPriceOrder(token, body);
  } catch (error) {
    if (isDefinitiveRejection(error)) {
      const appError = toJupiterAppError(error, "order");
      await markArmFailed(db, { policyId, prepId: prep.id, reason: typeof appError.cause === "string" ? appError.cause : "rejected", message: appError.message, now });
      throw new AppError("PROVIDER_REJECTED", `${appError.message} No deposit was made. The policy is marked FAILED.`, { cause: appError.cause });
    }
    const appError = toJupiterAppError(error, "order");
    await appendPolicyEvent(db, {
      policyId,
      eventType: POLICY_EVENT_TYPES.PROVIDER_SUBMISSION_UNCONFIRMED,
      source: "CIRCUIT",
      payload: { depositTxSignature, reason: typeof appError.cause === "string" ? appError.cause : appError.code },
    });
    logger.warn("jupiter.create_unconfirmed", { policyId, depositTxSignature, code: appError.code });
    if (appError.code === "PROVIDER_AUTH_REQUIRED") {
      throw new AppError(
        "PROVIDER_AUTH_REQUIRED",
        "Your Jupiter session expired before the order was confirmed. Reconnect Jupiter, then resubmit: your signed deposit is kept, so no new signature is needed.",
        { cause: appError.cause },
      );
    }
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Jupiter did not confirm the order. Your deposit may still land, so Circuit will not ask for another one. Use Reconcile to check.",
      { cause: appError.cause, retryable: true },
    );
  }

  // 5. Record the provider order. ARMED only when Jupiter confirms the deposit landed.
  const signatureMatches = created.txSignature === depositTxSignature;
  if (!signatureMatches) {
    logger.warn("jupiter.create_signature_mismatch", { policyId, providerOrderId: created.id });
  }
  const confirmed = created.depositConfirmed && signatureMatches;
  const recorded = await recordProviderOrder(db, {
    policy,
    prep,
    orderId: created.id,
    depositTxSignature,
    now,
    recovered: false,
    armed: confirmed,
    createPayload: { depositConfirmed: created.depositConfirmed, providerTxSignature: created.txSignature, signatureMatches, message: created.message ?? null },
  });
  return { policy: recorded, outcome: confirmed ? "ARMED" : "CONFIRMATION_PENDING", depositTxSignature };
}

async function markArmFailed(
  db: Database,
  { policyId, prepId, reason, message, now }: { policyId: string; prepId: string; reason: string; message: string; now: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    await invalidateDepositPreparation(tx, { id: prepId, from: ["CRAFTED"], now });
    const failed = await updatePolicyStateIfStatus(tx, {
      policyId,
      expectedStatuses: ["ARMING"],
      changes: { status: "FAILED", failureCode: "PROVIDER_REJECTED", failureMessage: message.slice(0, 300) },
    });
    if (!failed) return;
    await appendPolicyEvent(tx, {
      policyId,
      eventType: POLICY_EVENT_TYPES.FAILED,
      source: "CIRCUIT",
      payload: { from: "ARMING", to: "FAILED", provider: EXECUTION_PROVIDERS.LIVE, reason, depositLanded: false },
    });
  });
}

/**
 * Persists Jupiter's order id for the policy (ARMING), consumes the deposit preparation
 * and, when confirmed, moves ARMING → ARMED — all in one transaction.
 */
async function recordProviderOrder(
  db: Database,
  {
    policy,
    prep,
    orderId,
    depositTxSignature,
    now,
    recovered,
    armed = false,
    createPayload = {},
  }: {
    policy: Policy;
    prep: JupiterDepositPreparation;
    orderId: string;
    depositTxSignature: string;
    now: Date;
    recovered: boolean;
    armed?: boolean;
    createPayload?: Record<string, unknown>;
  },
): Promise<Policy> {
  return db.transaction(async (tx) => {
    const current = await lockPolicyForUpdate(tx, policy.id);
    if (!current) throw new AppError("NOT_FOUND", "Policy not found.");
    if (current.providerOrderId && current.providerOrderId !== orderId) {
      throw new AppError("PROVIDER_REJECTED", "Jupiter returned a different order than the one already recorded.", { cause: "PROVIDER_AMBIGUOUS" });
    }
    await consumeDepositPreparation(tx, { id: prep.id, providerOrderId: orderId, now });
    if (current.status !== "ARMING") return current;
    if (!current.providerOrderId) {
      await appendPolicyEvent(tx, {
        policyId: policy.id,
        eventType: recovered ? POLICY_EVENT_TYPES.PROVIDER_ORDER_RECOVERED : POLICY_EVENT_TYPES.PROVIDER_ORDER_CREATED,
        source: "JUPITER",
        payload: { provider: EXECUTION_PROVIDERS.LIVE, simulated: false, providerOrderId: orderId, depositTxSignature, ...createPayload },
      });
    }
    const updated = await updatePolicyStateIfStatus(tx, {
      policyId: policy.id,
      expectedStatuses: ["ARMING"],
      changes: armed
        ? { providerOrderId: orderId, status: "ARMED", armedAt: now, providerState: "OPEN", providerStateUpdatedAt: now }
        : { providerOrderId: orderId, providerState: "PENDING", providerStateUpdatedAt: now },
    });
    if (!updated) return current;
    if (armed) {
      await appendPolicyEvent(tx, {
        policyId: policy.id,
        eventType: POLICY_EVENT_TYPES.ARMED,
        source: "CIRCUIT",
        payload: { from: "ARMING", to: "ARMED", provider: EXECUTION_PROVIDERS.LIVE, simulated: false, providerOrderId: orderId },
      });
    }
    return updated;
  });
}
