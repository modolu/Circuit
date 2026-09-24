import { z } from "zod";
import { requireSession } from "@/src/auth/session";
import { getDb } from "@/src/db/client";
import { AppError } from "@/src/domain/errors";
import { logger } from "@/src/observability/logger";
import { defaultReferenceClients, getAssetReference } from "@/src/services/get-reference";
import { jsonError, jsonOk, newRequestId } from "../../_lib/http";

const assetIdSchema = z.uuid();

/**
 * Live reference for one curated asset. The provider (Pyth or PreStocks) and its
 * configuration are chosen by the stored asset, never by the request. Signed-in users only.
 */
export async function GET(_request: Request, context: RouteContext<"/api/reference/[assetId]">) {
  const requestId = newRequestId();
  try {
    await requireSession();
    const parsed = assetIdSchema.safeParse((await context.params).assetId);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid request: check assetId.");

    const result = await getAssetReference(getDb(), parsed.data, defaultReferenceClients());
    logger.info("reference.fetched", {
      requestId,
      assetId: result.asset.id,
      provider: result.reference.provider,
      freshness: result.reference.freshness,
    });
    return jsonOk(result, requestId);
  } catch (error) {
    return jsonError(error, requestId, logger, "reference.fetch_failed");
  }
}
