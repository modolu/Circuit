import { logger } from "@/src/observability/logger";
import { cancelPolicy } from "@/src/services/cancel-policy";
import { policyViewFor } from "@/src/services/policy-view";
import { jsonError, jsonOk, newRequestId } from "../../../_lib/http";
import { policyActionContext } from "../../../_lib/policy-route";

export async function POST(_request: Request, context: RouteContext<"/api/policies/[policyId]/cancel">) {
  const requestId = newRequestId();
  try {
    const { db, wallet, policyId, provider } = await policyActionContext(context.params);
    const result = await cancelPolicy(db, { wallet, policyId }, { provider });
    logger.info("policy.cancel_completed", { requestId, policyId, outcome: result.outcome, status: result.policy.status });
    return jsonOk({ policy: await policyViewFor(db, result.policy), outcome: result.outcome }, requestId);
  } catch (error) {
    return jsonError(error, requestId, logger, "policy.cancel_failed");
  }
}
