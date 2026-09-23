import { getDb } from "@/src/db/client";
import { logger } from "@/src/observability/logger";
import { listPublicAssets } from "@/src/services/list-assets";
import { jsonError, jsonOk, newRequestId } from "../_lib/http";

/** Curated, active assets only: public catalog fields, no internal metadata. */
export async function GET() {
  const requestId = newRequestId();
  try {
    return jsonOk({ assets: await listPublicAssets(getDb()) }, requestId);
  } catch (error) {
    return jsonError(error, requestId, logger, "assets.list_failed");
  }
}
