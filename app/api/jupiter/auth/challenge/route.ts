import { logger } from "@/src/observability/logger";
import { requestJupiterChallenge } from "@/src/services/jupiter/auth";
import { jsonOk, newRequestId } from "../../../_lib/http";
import { jupiterJsonError, jupiterRouteContext } from "../../../_lib/jupiter-route";

/** Jupiter message challenge for the signed-in Circuit wallet, returned exactly as Jupiter issued it. */
export async function POST(request: Request) {
  const requestId = newRequestId();
  try {
    const { wallet, mode, client } = await jupiterRouteContext(request);
    const challenge = await requestJupiterChallenge({ wallet, mode }, { client });
    logger.info("jupiter.auth_challenge_issued", { requestId, wallet: wallet.address });
    return jsonOk({ ...challenge, walletAddress: wallet.address }, requestId);
  } catch (error) {
    return jupiterJsonError(error, requestId, logger, "jupiter.auth_challenge_failed");
  }
}
