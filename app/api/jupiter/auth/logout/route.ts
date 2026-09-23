import { clearJupiterSessionCookie } from "@/src/auth/jupiter-session";
import { logger } from "@/src/observability/logger";
import { jsonError, jsonOk, newRequestId } from "../../../_lib/http";

/** Clears only the Jupiter session cookie. The Circuit session stays signed in. */
export async function POST() {
  const requestId = newRequestId();
  try {
    const response = jsonOk({ jupiterSignedOut: true }, requestId);
    clearJupiterSessionCookie(response);
    logger.info("jupiter.auth_logged_out", { requestId });
    return response;
  } catch (error) {
    return jsonError(error, requestId, logger, "jupiter.auth_logout_failed");
  }
}
