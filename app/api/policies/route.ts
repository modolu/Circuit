import { requireAuthenticatedWallet } from "@/src/auth/current-wallet";
import { getDb } from "@/src/db/client";
import { logger } from "@/src/observability/logger";
import { createPolicyDraft } from "@/src/services/create-policy";
import { defaultReferenceClients, getAssetReference } from "@/src/services/get-reference";
import { createPolicyRequestSchema } from "@/src/validation/policy";
import { jsonError, jsonOk, newRequestId, parseJsonBody } from "../_lib/http";

/** Creates a DRAFT policy for the signed-in wallet. Nothing is signed or sent to Jupiter. */
export async function POST(request: Request) {
  const requestId = newRequestId();
  try {
    const db = getDb();
    const wallet = await requireAuthenticatedWallet(db);
    const body = await parseJsonBody(request, createPolicyRequestSchema);
    const clients = defaultReferenceClients();
    const policy = await createPolicyDraft(
      db,
      { wallet, request: body },
      { loadReference: (database, assetId) => getAssetReference(database, assetId, clients) },
    );
    logger.info("policy.draft_created", { requestId, policyId: policy.id, wallet: wallet.address, assetId: policy.asset.id });
    return jsonOk({ policy }, requestId, 201);
  } catch (error) {
    return jsonError(error, requestId, logger, "policy.create_failed");
  }
}
