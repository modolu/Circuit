import { logger } from "@/src/observability/logger";
import { initiateLiveCancel } from "@/src/services/jupiter/cancel-live";
import { policyViewFor } from "@/src/services/policy-view";
import { jsonOk, newRequestId } from "../../../../_lib/http";
import { jupiterJsonError, jupiterPolicyContext } from "../../../../_lib/jupiter-route";

/** Cancel & withdraw, step 1: Jupiter stops fills and returns an unsigned withdrawal. Never signs. */
export async function POST(request: Request, context: RouteContext<"/api/policies/[policyId]/jupiter/cancel">) {
  const requestId = newRequestId();
  try {
    const { db, wallet, mode, client, jwt, policyId } = await jupiterPolicyContext(request, context.params);
    const result = await initiateLiveCancel(db, { wallet, policyId, jwt, mode }, { client });
    logger.info("policy.live_cancel_initiated", { requestId, policyId, outcome: result.outcome, status: result.policy.status });
    return jsonOk(
      {
        policy: await policyViewFor(db, result.policy),
        outcome: result.outcome,
        preparation: result.preparation ?? null,
        unsignedTransaction: result.unsignedTransaction ?? null,
      },
      requestId,
    );
  } catch (error) {
    return jupiterJsonError(error, requestId, logger, "policy.live_cancel_failed");
  }
}
