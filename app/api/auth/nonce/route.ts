import { issueLoginChallenge } from "@/src/auth/login";
import { getPublicEnv } from "@/src/config/env";
import { getDb } from "@/src/db/client";
import { logger } from "@/src/observability/logger";
import { authNonceRequestSchema } from "@/src/validation/api";
import { jsonError, jsonOk, newRequestId, parseJsonBody } from "../../_lib/http";

export async function POST(request: Request) {
  const requestId = newRequestId();
  try {
    const { walletAddress } = await parseJsonBody(request, authNonceRequestSchema);
    const env = getPublicEnv();
    const challenge = await issueLoginChallenge(getDb(), {
      walletAddress,
      config: { appOrigin: env.NEXT_PUBLIC_APP_URL, cluster: env.NEXT_PUBLIC_SOLANA_CLUSTER },
    });
    logger.info("auth.challenge_issued", { requestId, wallet: walletAddress });
    return jsonOk(
      {
        nonce: challenge.nonce,
        message: challenge.message,
        issuedAt: challenge.issuedAt.toISOString(),
        expiresAt: challenge.expiresAt.toISOString(),
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, logger, "auth.challenge_failed");
  }
}
