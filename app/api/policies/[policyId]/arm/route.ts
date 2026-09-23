import { logger } from "@/src/observability/logger";
import { armPolicy } from "@/src/services/arm-policy";
import { policyViewFor } from "@/src/services/policy-view";
import { jsonError, jsonOk, newRequestId } from "../../../_lib/http";
import { policyActionContext } from "../../../_lib/policy-route";

export async function POST(_request: Request, context: RouteContext<"/api/policies/[policyId]/arm">) {
  const requestId = newRequestId();
  try {
    const { db, wallet, policyId, provider } = await policyActionContext(context.params);
    const policy = await armPolicy(db, { wallet, policyId }, { provider });
    logger.info("policy.armed", { requestId, policyId, wallet: wallet.address, provider: provider.id, providerOrderId: policy.providerOrderId });
    return jsonOk({ policy: await policyViewFor(db, policy) }, requestId);
  } catch (error) {
    return jsonError(error, requestId, logger, "policy.arm_failed");
  }
}
