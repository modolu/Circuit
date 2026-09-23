import { logger } from "@/src/observability/logger";
import { simulateProviderFill } from "@/src/services/simulate-provider-fill";
import { jsonError, jsonOk, newRequestId } from "../../../../_lib/http";
import { policyActionContext } from "../../../../_lib/policy-route";

/**
 * DEMO CONTROL (mock mode only): the simulated provider reports the order FILLED.
 * Circuit's policy does not change until reconciliation. NOT_FOUND in live mode.
 */
export async function POST(_request: Request, context: RouteContext<"/api/policies/[policyId]/mock/simulate-fill">) {
  const requestId = newRequestId();
  try {
    const { db, wallet, policyId, provider } = await policyActionContext(context.params);
    const result = await simulateProviderFill(db, { wallet, policyId }, { provider });
    logger.info("mock.simulated_fill", { requestId, policyId, providerOrderId: result.providerOrderId, providerState: result.providerState });
    return jsonOk({ simulated: true, ...result }, requestId);
  } catch (error) {
    return jsonError(error, requestId, logger, "mock.simulated_fill_failed");
  }
}
