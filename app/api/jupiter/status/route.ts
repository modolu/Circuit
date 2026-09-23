import { clearJupiterSessionCookie } from "@/src/auth/jupiter-session";
import { logger } from "@/src/observability/logger";
import { getJupiterStatus } from "@/src/services/jupiter/vault";
import { jsonOk, newRequestId } from "../../_lib/http";
import { jupiterJsonError, jupiterRouteContext } from "../../_lib/jupiter-route";

/** Jupiter auth + vault state for the signed-in wallet. Never returns the JWT. */
export async function GET(request: Request) {
  const requestId = newRequestId();
  try {
    const { wallet, mode, client, jwt } = await jupiterRouteContext(request);
    if (mode !== "live") return jsonOk({ mode, authenticated: false, expired: false, vault: null }, requestId);
    const status = await getJupiterStatus({ wallet, jwt, mode }, { client });
    const response = jsonOk({ mode, ...status }, requestId);
    if (status.expired) clearJupiterSessionCookie(response);
    return response;
  } catch (error) {
    return jupiterJsonError(error, requestId, logger, "jupiter.status_failed");
  }
}
