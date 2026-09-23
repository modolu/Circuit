import { logger } from "@/src/observability/logger";
import { policyViewFor } from "@/src/services/policy-view";
import { reconcilePolicy } from "@/src/services/reconcile-policy";
import { jsonError, jsonOk, newRequestId } from "../../../_lib/http";
import { policyActionContext } from "../../../_lib/policy-route";

export async function POST(_request: Request, context: RouteContext<"/api/policies/[policyId]/reconcile">) {
  const requestId = newRequestId();
  try {
    const { db, wallet, policyId, provider } = await policyActionContext(context.params);
    const result = await reconcilePolicy(db, { wallet, policyId }, { provider });
    logger.info("reconcile.completed", { requestId, policyId, changed: result.changed, providerState: result.providerState, status: result.policy.status });
    return jsonOk(
      { policy: await policyViewFor(db, result.policy), changed: result.changed, providerState: result.providerState, diagnostic: result.diagnostic ?? null },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, logger, "reconcile.failed");
  }
}
