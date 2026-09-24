import { logger } from "@/src/observability/logger";
import { reconcileForMode } from "@/src/services/jupiter/reconcile-live";
import { policyViewFor } from "@/src/services/policy-view";
import { jsonOk, newRequestId } from "../../../_lib/http";
import { jupiterJsonError, jupiterPolicyContext } from "../../../_lib/jupiter-route";

/** Read-only: mirrors provider state (Jupiter history for live policies, the mock otherwise). */
export async function POST(request: Request, context: RouteContext<"/api/policies/[policyId]/reconcile">) {
  const requestId = newRequestId();
  try {
    const { db, wallet, mode, client, jwt, policyId, provider } = await jupiterPolicyContext(request, context.params);
    const result = await reconcileForMode(db, { wallet, policyId, jwt, mode }, { provider, client });
    logger.info("reconcile.completed", { requestId, policyId, changed: result.changed, providerState: result.providerState, status: result.policy.status });
    return jsonOk(
      { policy: await policyViewFor(db, result.policy), changed: result.changed, providerState: result.providerState, diagnostic: result.diagnostic ?? null },
      requestId,
    );
  } catch (error) {
    return jupiterJsonError(error, requestId, logger, "reconcile.failed");
  }
}
