import { logger } from "@/src/observability/logger";
import { registerJupiterVault } from "@/src/services/jupiter/vault";
import { jsonOk, newRequestId } from "../../../_lib/http";
import { jupiterJsonError, jupiterRouteContext } from "../../../_lib/jupiter-route";

/** Explicit user action: registers (or returns the existing) Jupiter vault. Moves no funds. */
export async function POST(request: Request) {
  const requestId = newRequestId();
  try {
    const { wallet, mode, client, jwt } = await jupiterRouteContext(request);
    const result = await registerJupiterVault({ wallet, jwt, mode }, { client });
    logger.info("jupiter.vault_registered", { requestId, wallet: wallet.address, created: result.created, status: result.vault.status });
    return jsonOk(result, requestId);
  } catch (error) {
    return jupiterJsonError(error, requestId, logger, "jupiter.vault_register_failed");
  }
}
