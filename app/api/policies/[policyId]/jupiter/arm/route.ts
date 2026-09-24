import { z } from "zod";
import { logger } from "@/src/observability/logger";
import { armLivePolicy } from "@/src/services/jupiter/arm-live";
import { policyViewFor } from "@/src/services/policy-view";
import { jsonOk, newRequestId, parseJsonBody } from "../../../../_lib/http";
import { jupiterJsonError, jupiterPolicyContext } from "../../../../_lib/jupiter-route";

const bodySchema = z.strictObject({
  preparationId: z.uuid(),
  /** Base64 wallet-signed deposit. Omitted only to resubmit the stored one after re-authentication. */
  signedTransaction: z.string().min(1).max(4096).optional(),
});

/**
 * Authorize deposit & arm: verifies the wallet-signed deposit is exactly the prepared
 * transaction, commits its public signature, then creates the Jupiter order. Never signs.
 */
export async function POST(request: Request, context: RouteContext<"/api/policies/[policyId]/jupiter/arm">) {
  const requestId = newRequestId();
  try {
    const { db, wallet, mode, client, jwt, policyId } = await jupiterPolicyContext(request, context.params);
    const body = await parseJsonBody(request, bodySchema);
    const result = await armLivePolicy(
      db,
      { wallet, policyId, preparationId: body.preparationId, signedTransaction: body.signedTransaction, jwt, mode },
      { client },
    );
    logger.info("policy.live_arm", {
      requestId,
      policyId,
      wallet: wallet.address,
      outcome: result.outcome,
      status: result.policy.status,
      providerOrderId: result.policy.providerOrderId,
      depositTxSignature: result.depositTxSignature,
    });
    return jsonOk({ policy: await policyViewFor(db, result.policy), outcome: result.outcome, depositTxSignature: result.depositTxSignature }, requestId);
  } catch (error) {
    return jupiterJsonError(error, requestId, logger, "policy.live_arm_failed");
  }
}
