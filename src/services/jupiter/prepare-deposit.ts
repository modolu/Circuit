import "server-only";
import { USDC } from "../../config/tokens.ts";
import type { Database } from "../../db/client.ts";
import {
  findActiveDepositPreparation,
  invalidateDepositPreparation,
  invalidateStaleReservation,
  invalidateUnsubmittedCrafted,
  markDepositPreparationCrafted,
  reserveDepositPreparation,
} from "../../db/repositories/jupiter-deposit-preparations.ts";
import { appendPolicyEvent } from "../../db/repositories/policies.ts";
import type { JupiterDepositPreparation, Wallet } from "../../db/schema.ts";
import { AppError } from "../../domain/errors.ts";
import { POLICY_EVENT_TYPES } from "../../domain/policy.ts";
import type { JupiterClient } from "../../integrations/jupiter/client.ts";
import { inspectUnsignedTransaction, SignedTransactionError } from "../../integrations/jupiter/signed-transaction.ts";
import { toDepositCraftRequest } from "../../integrations/jupiter/trigger.ts";
import { loadOwnedPolicy } from "../policy-lifecycle.ts";
import { requireJupiterJwt, requireLiveMode, toJupiterAppError } from "./errors.ts";
import { assertLiveBuyEligible } from "./live-gates.ts";

export { LIVE_SELL_DISABLED_MESSAGE } from "./live-gates.ts";

/*
 * Prepares (does NOT sign or submit) a live Jupiter BUY deposit for a DRAFT policy.
 *
 * Durability rule: Jupiter's deposit requestId is single-use and belongs to the
 * later order creation, so it is committed to the database BEFORE the unsigned
 * transaction is returned, and therefore before any wallet could be asked to sign it.
 *
 * Concurrency (reservation, no DB transaction held across HTTP):
 *   1. insert a PREPARING row; a partial unique index allows one active row per policy
 *   2. call /deposit/craft outside any transaction
 *   3. compare-and-set PREPARING → CRAFTED with requestId + unsigned tx (committed)
 * Concurrent callers hit the unique index and either receive the CRAFTED preparation
 * or a retryable "in progress" conflict. They never trigger a second craft.
 * A failed craft invalidates the reservation. Reservations abandoned by a crash are
 * reclaimed after STALE_RESERVATION_MS.
 *
 * Freshness (Task 9): a crafted transaction carries a recent blockhash that expires
 * within about a minute. An UNSUBMITTED CRAFTED preparation older than
 * CRAFTED_REUSE_MS is released and re-crafted, so the wallet is never asked to sign a
 * transaction that can no longer land. Once submission starts it is never re-crafted.
 *
 * Integrity (Task 9): the crafted transaction must deserialize, pay its fee from the
 * user's wallet (so its transaction id is the wallet's signature), and deposit into the
 * wallet's own Jupiter vault (receiverAddress == GET /vault).
 */

export const STALE_RESERVATION_MS = 60_000;
export const CRAFTED_REUSE_MS = 30_000;

export interface DepositPreparationView {
  id: string;
  policyId: string;
  status: JupiterDepositPreparation["status"];
  depositRequestId: string | null;
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: string;
  receiverAddress: string | null;
  depositTxSignature: string | null;
  submitted: boolean;
  createdAt: string;
  craftedAt: string;
}

export function toDepositPreparationView(row: JupiterDepositPreparation): DepositPreparationView {
  return {
    id: row.id,
    policyId: row.policyId,
    status: row.status,
    depositRequestId: row.depositRequestId,
    inputMint: row.inputMint,
    outputMint: row.outputMint,
    inputAmountAtomic: row.inputAmountAtomic.toString(),
    receiverAddress: row.receiverAddress,
    depositTxSignature: row.depositTxSignature,
    submitted: row.submissionStartedAt !== null,
    createdAt: row.createdAt.toISOString(),
    craftedAt: row.updatedAt.toISOString(),
  };
}

export interface PreparedDeposit {
  preparation: DepositPreparationView;
  /** Base64 UNSIGNED Jupiter deposit transaction. Returned only to the owning wallet. */
  unsignedTransaction: string;
  reused: boolean;
}

function fromCrafted(row: JupiterDepositPreparation, reused: boolean): PreparedDeposit {
  if (row.status !== "CRAFTED" || !row.unsignedTransaction) throw new AppError("INTERNAL_ERROR", "Deposit preparation is incomplete.");
  return { preparation: toDepositPreparationView(row), unsignedTransaction: row.unsignedTransaction, reused };
}

export async function prepareJupiterDeposit(
  db: Database,
  { wallet, policyId, jwt, mode, now = new Date() }: {
    wallet: Wallet;
    policyId: string;
    jwt: string | null;
    mode: "mock" | "live";
    now?: Date;
  },
  { client }: { client: JupiterClient },
): Promise<PreparedDeposit> {
  requireLiveMode(mode);
  const token = requireJupiterJwt(jwt);

  const policy = await loadOwnedPolicy(db, wallet.id, policyId);
  if (policy.status !== "DRAFT") throw new AppError("POLICY_STATE_CONFLICT", `A ${policy.status} policy cannot have a deposit prepared.`);
  if (policy.expiresAt.getTime() <= now.getTime()) throw new AppError("POLICY_EXPIRED", "This draft has passed its expiry.");
  await assertLiveBuyEligible(db, policy);

  // The deposit goes into the wallet's own Jupiter vault; there is none until the user sets it up.
  let vault;
  try {
    vault = await client.getVault(token);
  } catch (error) {
    throw toJupiterAppError(error, "vault");
  }
  if (!vault || vault.userPubkey !== wallet.address) {
    throw new AppError("PROVIDER_REJECTED", "Set up your Jupiter vault on the dashboard before preparing a deposit.", { cause: "NO_VAULT" });
  }

  // 0. Reuse a fresh, unsubmitted preparation; release a stale one so it is re-crafted.
  const current = await findActiveDepositPreparation(db, policy.id);
  if (current?.status === "CRAFTED") {
    if (current.submissionStartedAt) {
      throw new AppError("POLICY_STATE_CONFLICT", "This deposit was already signed and submitted. Refresh the policy to see its status.");
    }
    if (now.getTime() - current.updatedAt.getTime() < CRAFTED_REUSE_MS) return fromCrafted(current, true);
    await invalidateUnsubmittedCrafted(db, { id: current.id, now });
  }

  // 1. Reserve the policy's single active slot (or recover the existing preparation).
  let reservation = await reserveDepositPreparation(db, {
    policyId: policy.id,
    walletId: wallet.id,
    inputMint: policy.inputMint,
    outputMint: policy.outputMint,
    inputAmountAtomic: policy.amountAtomic,
    now,
  });
  if (!reservation) {
    const existing = await findActiveDepositPreparation(db, policy.id);
    if (existing?.status === "CRAFTED") return fromCrafted(existing, true);
    if (existing?.status === "PREPARING") {
      const reclaimed = await invalidateStaleReservation(db, {
        id: existing.id,
        olderThan: new Date(now.getTime() - STALE_RESERVATION_MS),
        now,
      });
      if (!reclaimed) {
        throw new AppError("POLICY_STATE_CONFLICT", "A deposit is already being prepared for this policy. Try again shortly.", { retryable: true });
      }
      reservation = await reserveDepositPreparation(db, {
        policyId: policy.id,
        walletId: wallet.id,
        inputMint: policy.inputMint,
        outputMint: policy.outputMint,
        inputAmountAtomic: policy.amountAtomic,
        now,
      });
    }
    if (!reservation) throw new AppError("POLICY_STATE_CONFLICT", "A deposit is already being prepared for this policy. Try again shortly.", { retryable: true });
  }

  // 2. Craft outside any database transaction.
  let crafted;
  try {
    crafted = await client.craftDeposit(
      token,
      toDepositCraftRequest({ inputMint: policy.inputMint, outputMint: policy.outputMint, inputAmount: policy.amountAtomic.toString() }, wallet.address),
    );
  } catch (error) {
    await invalidateDepositPreparation(db, { id: reservation.id, from: ["PREPARING"], now });
    throw toJupiterAppError(error, "deposit");
  }
  if (
    crafted.mint !== policy.inputMint ||
    crafted.amount !== policy.amountAtomic.toString() ||
    crafted.tokenDecimals !== USDC.decimals ||
    crafted.receiverAddress !== vault.vaultPubkey
  ) {
    await invalidateDepositPreparation(db, { id: reservation.id, from: ["PREPARING"], now });
    throw new AppError("PROVIDER_REJECTED", "Jupiter returned a deposit that does not match the policy.", { cause: "DEPOSIT_MISMATCH" });
  }
  try {
    inspectUnsignedTransaction(crafted.transaction, wallet.address);
  } catch (error) {
    await invalidateDepositPreparation(db, { id: reservation.id, from: ["PREPARING"], now });
    const reason = error instanceof SignedTransactionError ? error.reason : "malformed";
    throw new AppError("PROVIDER_REJECTED", "Jupiter returned a deposit transaction Circuit cannot safely present for signing.", {
      cause: `DEPOSIT_TX_${reason.toUpperCase()}`,
    });
  }

  // 3. Commit the single-use requestId BEFORE returning the unsigned transaction.
  const saved = await markDepositPreparationCrafted(db, {
    id: reservation.id,
    depositRequestId: crafted.requestId,
    unsignedTransaction: crafted.transaction,
    receiverAddress: crafted.receiverAddress,
    now,
  });
  if (!saved) {
    throw new AppError("POLICY_STATE_CONFLICT", "The deposit preparation changed while crafting. Try again.", { retryable: true });
  }
  await appendPolicyEvent(db, {
    policyId: policy.id,
    eventType: POLICY_EVENT_TYPES.DEPOSIT_PREPARED,
    source: "JUPITER",
    payload: { preparationId: saved.id, depositRequestId: saved.depositRequestId, receiverAddress: saved.receiverAddress, amountAtomic: saved.inputAmountAtomic.toString() },
  });
  return fromCrafted(saved, false);
}
