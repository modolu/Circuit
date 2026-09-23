import { clearJupiterSessionCookie } from "@/src/auth/jupiter-session";
import { clearSessionCookie } from "@/src/auth/session";
import { logger } from "@/src/observability/logger";
import { jsonError, jsonOk, newRequestId } from "../../_lib/http";

/** Clears the Circuit session cookie and the Jupiter session cookie. Does not touch the wallet connection. */
export async function POST() {
  const requestId = newRequestId();
  try {
    const response = jsonOk({ signedOut: true }, requestId);
    clearSessionCookie(response);
    clearJupiterSessionCookie(response);
    logger.info("auth.logged_out", { requestId });
    return response;
  } catch (error) {
    return jsonError(error, requestId, logger, "auth.logout_failed");
  }
}
