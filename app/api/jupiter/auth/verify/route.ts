import { z } from "zod";
import { setJupiterSessionCookie } from "@/src/auth/jupiter-session";
import { logger } from "@/src/observability/logger";
import { verifyJupiterChallenge } from "@/src/services/jupiter/auth";
import { jsonOk, newRequestId, parseJsonBody } from "../../../_lib/http";
import { jupiterJsonError, jupiterRouteContext } from "../../../_lib/jupiter-route";

const bodySchema = z.strictObject({ signature: z.string().min(1).max(200) });

/**
 * Exchanges the wallet's signature over Jupiter's challenge for a Trigger JWT. The JWT
 * goes only into the HttpOnly `circuit_jupiter_session` cookie; the JSON body never has it.
 */
export async function POST(request: Request) {
  const requestId = newRequestId();
  try {
    const { wallet, mode, client } = await jupiterRouteContext(request);
    const body = await parseJsonBody(request, bodySchema);
    const { jwt } = await verifyJupiterChallenge({ wallet, signatureBase64: body.signature, mode }, { client });
    const response = jsonOk({ authenticated: true, walletAddress: wallet.address }, requestId);
    setJupiterSessionCookie(response, wallet.address, jwt);
    logger.info("jupiter.auth_verified", { requestId, wallet: wallet.address });
    return response;
  } catch (error) {
    return jupiterJsonError(error, requestId, logger, "jupiter.auth_verify_failed");
  }
}
