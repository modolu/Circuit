import { z } from "zod";
import { requireSession } from "@/src/auth/session";
import { getDb } from "@/src/db/client";
import { AppError } from "@/src/domain/errors";
import { getPythClient } from "@/src/integrations/pyth/client";
import { logger } from "@/src/observability/logger";
import { getAssetReference } from "@/src/services/get-reference";
import { jsonError, jsonOk, newRequestId } from "../../_lib/http";

const assetIdSchema = z.uuid();

/**
 * Live Pyth reference for one curated asset. The feed is chosen by the stored
 * asset, never by the request. Signed-in users only.
 */
export async function GET(_request: Request, context: RouteContext<"/api/reference/[assetId]">) {
  const requestId = newRequestId();
  try {
    await requireSession();
    const parsed = assetIdSchema.safeParse((await context.params).assetId);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid request: check assetId.");

    const result = await getAssetReference(getDb(), parsed.data, { pyth: getPythClient() });
    logger.info("reference.fetched", {
      requestId,
      assetId: result.asset.id,
      feedId: result.reference.feedId,
      freshness: result.reference.freshness,
      marketSession: result.reference.marketSession,
    });
    return jsonOk(result, requestId);
  } catch (error) {
    return jsonError(error, requestId, logger, "reference.fetch_failed");
  }
}
