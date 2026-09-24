import { z } from "zod";
import { logger } from "@/src/observability/logger";
import { confirmLiveCancel } from "@/src/services/jupiter/cancel-live";
import { policyViewFor } from "@/src/services/policy-view";
import { jsonOk, newRequestId, parseJsonBody } from "../../../../_lib/http";
import { jupiterJsonError, jupiterPolicyContext } from "../../../../_lib/jupiter-route";

const bodySchema = z.strictObject({
  preparationId: z.uuid(),
  /** Base64 wallet-signed withdrawal. Omitted only to retry the stored one. */
  signedTransaction: z.string().min(1).max(4096).optional(),
});

/** Cancel & withdraw, step 2: verifies the signed withdrawal, then confirms it with Jupiter. */
export async function POST(request: Request, context: RouteContext<"/api/policies/[policyId]/jupiter/confirm-cancel">) {
  const requestId = newRequestId();
  try {
    const { db, wallet, mode, client, jwt, policyId } = await jupiterPolicyContext(request, context.params);
    const body = await parseJsonBody(request, bodySchema);
    const result = await confirmLiveCancel(
      db,
      { wallet, policyId, preparationId: body.preparationId, signedTransaction: body.signedTransaction, jwt, mode },
      { client },
    );
    logger.info("policy.live_withdrawal_confirmed", {
      requestId,
      policyId,
      status: result.policy.status,
      withdrawalTxSignature: result.withdrawalTxSignature,
    });
    return jsonOk(
      { policy: await policyViewFor(db, result.policy), preparation: result.preparation, withdrawalTxSignature: result.withdrawalTxSignature },
      requestId,
    );
  } catch (error) {
    return jupiterJsonError(error, requestId, logger, "policy.live_withdrawal_failed");
  }
}
