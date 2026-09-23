import "server-only";
import { USDC } from "../../config/tokens.ts";
import type { Database } from "../../db/client.ts";
import { findAssetById } from "../../db/repositories/assets.ts";
import {
  findActiveDepositPreparation,
  invalidateDepositPreparation,
  invalidateStaleReservation,
  markDepositPreparationCrafted,
  reserveDepositPreparation,
} from "../../db/repositories/jupiter-deposit-preparations.ts";
import type { JupiterDepositPreparation, Wallet } from "../../db/schema.ts";
import { assetMetadataSchema, liveBuyDepositGate } from "../../domain/asset.ts";
import { AppError } from "../../domain/errors.ts";
import type { JupiterClient } from "../../integrations/jupiter/client.ts";
import { meetsProviderMinimum, toDepositCraftRequest } from "../../integrations/jupiter/trigger.ts";
import { loadOwnedPolicy } from "../policy-lifecycle.ts";
import { requireJupiterJwt, requireLiveMode, toJupiterAppError } from "./errors.ts";

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
 * reclaimed after STALE_RESERVATION_MS. There is no automatic re-craft loop.
 */

export const STALE_RESERVATION_MS = 60_000;

export const LIVE_SELL_DISABLED_MESSAGE =
  "Live AAPLx sell orders are not enabled because the token's transfer-hook deposit path has not been verified with Jupiter Trigger.";

const GATE_MESSAGES = {
  PYTH_LIVE_CHECK_REQUIRED: "Live execution for this asset needs a verified live Pyth reference first.",
  BUY_DEPOSIT_NOT_COMPATIBLE: "Jupiter Trigger deposits for this asset have not been verified as compatible.",
  EXECUTION_PRICE_CALIBRATION_REQUIRED:
    "Live execution for this asset is blocked until the Pyth reference → token execution-price calibration is complete.",
} as const;

export interface DepositPreparationView {
  id: string;
  policyId: string;
  status: JupiterDepositPreparation["status"];
  depositRequestId: string | null;
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: string;
  receiverAddress: string | null;
  createdAt: string;
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
    createdAt: row.createdAt.toISOString(),
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
  if (policy.side !== "BUY") throw new AppError("ASSET_DISABLED", LIVE_SELL_DISABLED_MESSAGE, { cause: "LIVE_SELL_NOT_VERIFIED" });

  const asset = await findAssetById(db, policy.assetId);
  if (!asset?.active) throw new AppError("ASSET_DISABLED", "This asset is not currently available in Circuit.");
  const metadata = assetMetadataSchema.safeParse(asset.metadata);
  if (!metadata.success) throw new AppError("ASSET_DISABLED", GATE_MESSAGES.BUY_DEPOSIT_NOT_COMPATIBLE, { cause: "ASSET_METADATA_INVALID" });
  const gate = liveBuyDepositGate(metadata.data);
  if (!gate.ok) throw new AppError("ASSET_DISABLED", GATE_MESSAGES[gate.reason], { cause: gate.reason });

  if (policy.inputMint !== USDC.mintAddress || policy.outputMint !== asset.mintAddress) {
    throw new AppError("ASSET_DISABLED", "Live Jupiter deposits support USDC → verified stock token only.", { cause: "UNEXPECTED_MINTS" });
  }
  // USDC is valued at 1 USD here. Jupiter values the deposit at market price, so a live
  // demo should use a small margin above the floor (not hard-coded here).
  if (!meetsProviderMinimum({ inputAmountAtomic: policy.amountAtomic, inputDecimals: USDC.decimals, inputUsdPrice: "1" }).ok) {
    throw new AppError("VALIDATION_ERROR", "Live Jupiter Trigger orders must be worth at least 10 USD.", { cause: "BELOW_PROVIDER_MINIMUM" });
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
  if (crafted.mint !== policy.inputMint || crafted.amount !== policy.amountAtomic.toString() || crafted.tokenDecimals !== USDC.decimals) {
    await invalidateDepositPreparation(db, { id: reservation.id, from: ["PREPARING"], now });
    throw new AppError("PROVIDER_REJECTED", "Jupiter returned a deposit that does not match the policy.", { cause: "DEPOSIT_MISMATCH" });
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
  return fromCrafted(saved, false);
}
