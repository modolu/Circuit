import "server-only";
import { USDC } from "../../config/tokens.ts";
import type { DbExecutor } from "../../db/client.ts";
import { findAssetById } from "../../db/repositories/assets.ts";
import { findPolicyForWallet } from "../../db/repositories/policies.ts";
import type { Asset, Policy } from "../../db/schema.ts";
import { assetMetadataSchema, liveBuyDepositGate, type ReferenceBasis } from "../../domain/asset.ts";
import { AppError } from "../../domain/errors.ts";
import { meetsProviderMinimum } from "../../integrations/jupiter/trigger.ts";

/*
 * Live Jupiter eligibility, shared by deposit preparation, arming and the policy page.
 * Order: BUY only → active asset → the provider's own live reference check PASSED (Pyth for
 * public equities, PreStocks for private-market tokens) → Jupiter BUY deposit
 * compatible → reference basis RESOLVED → USDC → stock-token mints → ≥ 10 USD.
 * Missing or malformed evidence fails closed. Production AAPLx stays blocked while the
 * Pyth key is NOT_ENTITLED; a PreStocks asset never depends on Pyth.
 */

export const LIVE_SELL_DISABLED_MESSAGE =
  "Live AAPLx sell orders are not enabled because the token's transfer-hook deposit path has not been verified with Jupiter Trigger.";

const GATE_MESSAGES = {
  PYTH_LIVE_CHECK_REQUIRED: "Live execution for this asset needs a verified live Pyth reference first.",
  PRESTOCKS_REFERENCE_CHECK_REQUIRED: "Live execution for this asset needs a verified PreStocks mark reference first.",
  BUY_DEPOSIT_NOT_COMPATIBLE: "Jupiter Trigger deposits for this asset have not been verified as compatible.",
  REFERENCE_BASIS_UNRESOLVED:
    "Live execution for this asset is blocked until its Pyth reference → Jupiter execution-price basis is recorded.",
} as const;

export interface LiveBuyContext {
  asset: Asset;
  referenceBasis: ReferenceBasis;
}

/** Throws the first failing gate as an AppError (internal reason on `cause`). */
export async function assertLiveBuyEligible(db: DbExecutor, policy: Policy): Promise<LiveBuyContext> {
  if (policy.side !== "BUY") throw new AppError("ASSET_DISABLED", LIVE_SELL_DISABLED_MESSAGE, { cause: "LIVE_SELL_NOT_VERIFIED" });

  const asset = await findAssetById(db, policy.assetId);
  if (!asset?.active) throw new AppError("ASSET_DISABLED", "This asset is not currently available in Circuit.");
  const metadata = assetMetadataSchema.safeParse(asset.metadata);
  if (!metadata.success) throw new AppError("ASSET_DISABLED", GATE_MESSAGES.BUY_DEPOSIT_NOT_COMPATIBLE, { cause: "ASSET_METADATA_INVALID" });
  const gate = liveBuyDepositGate(metadata.data);
  if (!gate.ok) throw new AppError("ASSET_DISABLED", GATE_MESSAGES[gate.reason], { cause: gate.reason });
  const referenceBasis = metadata.data.referenceBasis;
  if (!referenceBasis) throw new AppError("ASSET_DISABLED", GATE_MESSAGES.REFERENCE_BASIS_UNRESOLVED, { cause: "REFERENCE_BASIS_UNRESOLVED" });

  if (policy.inputMint !== USDC.mintAddress || policy.outputMint !== asset.mintAddress) {
    throw new AppError("ASSET_DISABLED", "Live Jupiter deposits support USDC → verified stock token only.", { cause: "UNEXPECTED_MINTS" });
  }
  // USDC is valued at 1 USD here. Jupiter values the deposit at market price when crafting.
  if (!meetsProviderMinimum({ inputAmountAtomic: policy.amountAtomic, inputDecimals: USDC.decimals, inputUsdPrice: "1" }).ok) {
    throw new AppError("VALIDATION_ERROR", "Live Jupiter Trigger orders must be worth at least 10 USD.", { cause: "BELOW_PROVIDER_MINIMUM" });
  }
  return { asset, referenceBasis };
}

export type LiveReadiness =
  | { ready: true; referenceBasis: ReferenceBasis }
  | { ready: false; code: string; message: string; referenceBasis: ReferenceBasis | null };

/** Non-throwing variant for rendering: why a DRAFT can or cannot be armed live. */
export async function liveReadinessFor(db: DbExecutor, policy: Policy): Promise<LiveReadiness> {
  try {
    const { referenceBasis } = await assertLiveBuyEligible(db, policy);
    return { ready: true, referenceBasis };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const asset = await findAssetById(db, policy.assetId);
    const metadata = asset ? assetMetadataSchema.safeParse(asset.metadata) : null;
    return {
      ready: false,
      code: typeof error.cause === "string" ? error.cause : error.code,
      message: error.message,
      referenceBasis: metadata?.success ? (metadata.data.referenceBasis ?? null) : null,
    };
  }
}

/** Page helper: live readiness for an owned policy (ownership enforced by the lookup). */
export async function liveReadinessForPolicy(db: DbExecutor, { walletId, policyId }: { walletId: string; policyId: string }): Promise<LiveReadiness> {
  const policy = await findPolicyForWallet(db, { policyId, walletId });
  if (!policy) throw new AppError("NOT_FOUND", "Policy not found.");
  return liveReadinessFor(db, policy);
}
