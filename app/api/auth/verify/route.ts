import { completeLogin } from "@/src/auth/login";
import { createSessionToken, setSessionCookie, SESSION_TTL_SECONDS } from "@/src/auth/session";
import { getSessionSecret } from "@/src/config/env";
import { getDb } from "@/src/db/client";
import { logger } from "@/src/observability/logger";
import { authVerifyRequestSchema } from "@/src/validation/api";
import { jsonError, jsonOk, newRequestId, parseJsonBody } from "../../_lib/http";

export async function POST(request: Request) {
  const requestId = newRequestId();
  try {
    const body = await parseJsonBody(request, authVerifyRequestSchema);
    const now = new Date();
    const wallet = await completeLogin(getDb(), {
      walletAddress: body.walletAddress,
      nonce: body.nonce,
      signatureBase64: body.signature,
      now,
    });
    const token = createSessionToken({ walletAddress: wallet.address, now, secret: getSessionSecret() });

    logger.info("auth.login_succeeded", { requestId, wallet: wallet.address });
    const response = jsonOk(
      {
        walletAddress: wallet.address,
        sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
      },
      requestId,
    );
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    return jsonError(error, requestId, logger, "auth.login_failed");
  }
}
