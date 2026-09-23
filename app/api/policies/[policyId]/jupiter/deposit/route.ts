import { z } from "zod";
import { AppError } from "@/src/domain/errors";
import { logger } from "@/src/observability/logger";
import { prepareJupiterDeposit } from "@/src/services/jupiter/prepare-deposit";
import { jsonOk, newRequestId } from "../../../../_lib/http";
import { jupiterJsonError, jupiterRouteContext } from "../../../../_lib/jupiter-route";

const policyIdSchema = z.uuid();

/**
 * Prepares (never signs or submits) a live Jupiter deposit for a DRAFT BUY policy.
 * The single-use requestId is committed before the unsigned transaction is returned.
 * Blocked in production until the Pyth live check and execution-price calibration pass.
 */
export async function POST(request: Request, context: RouteContext<"/api/policies/[policyId]/jupiter/deposit">) {
  const requestId = newRequestId();
  try {
    const { db, wallet, mode, client, jwt } = await jupiterRouteContext(request);
    const parsed = policyIdSchema.safeParse((await context.params).policyId);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid request: check policyId.");
    const prepared = await prepareJupiterDeposit(db, { wallet, policyId: parsed.data, jwt, mode }, { client });
    logger.info("jupiter.deposit_prepared", {
      requestId,
      policyId: parsed.data,
      wallet: wallet.address,
      preparationId: prepared.preparation.id,
      reused: prepared.reused,
    });
    return jsonOk(prepared, requestId);
  } catch (error) {
    return jupiterJsonError(error, requestId, logger, "jupiter.deposit_prepare_failed");
  }
}
