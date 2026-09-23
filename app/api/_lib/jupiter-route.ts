import "server-only";
import type { NextResponse } from "next/server";
import { requireAuthenticatedWallet } from "@/src/auth/current-wallet";
import { clearJupiterSessionCookie, readJupiterJwtFromRequest } from "@/src/auth/jupiter-session";
import { getDb, type Database } from "@/src/db/client";
import type { Wallet } from "@/src/db/schema";
import { toAppError } from "@/src/domain/errors";
import { getJupiterClient, type JupiterClient } from "@/src/integrations/jupiter/client";
import { getExecutionMode } from "@/src/integrations/jupiter/provider";
import type { Logger } from "@/src/observability/logger";
import { jsonError } from "./http";

/**
 * Shared preamble for /api/jupiter/* routes. The wallet always comes from the Circuit
 * session, never from the request body. The Jupiter JWT is read from its HttpOnly cookie
 * and only used when it is bound to that same wallet.
 */
export async function jupiterRouteContext(request: Request): Promise<{
  db: Database;
  wallet: Wallet;
  mode: "mock" | "live";
  client: JupiterClient;
  jwt: string | null;
}> {
  const db = getDb();
  const wallet = await requireAuthenticatedWallet(db);
  return {
    db,
    wallet,
    mode: getExecutionMode(),
    client: getJupiterClient(),
    jwt: readJupiterJwtFromRequest(request, wallet.address),
  };
}

/** Error response that also drops the Jupiter cookie when Jupiter says the session is no longer valid. */
export function jupiterJsonError(error: unknown, requestId: string, log: Logger, event: string): NextResponse {
  const response = jsonError(error, requestId, log, event);
  if (toAppError(error).code === "PROVIDER_AUTH_REQUIRED") clearJupiterSessionCookie(response);
  return response;
}
