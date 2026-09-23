import "server-only";
import { z } from "zod";
import { requireAuthenticatedWallet } from "@/src/auth/current-wallet";
import { getDb, type Database } from "@/src/db/client";
import type { Wallet } from "@/src/db/schema";
import { AppError } from "@/src/domain/errors";
import { getExecutionProvider } from "@/src/integrations/jupiter/provider";
import type { ExecutionProvider } from "@/src/integrations/jupiter/types";

const policyIdSchema = z.uuid();

/** Shared preamble for /api/policies/[policyId]/* actions: session wallet, id validation, configured provider. */
export async function policyActionContext(
  params: Promise<{ policyId: string }>,
): Promise<{ db: Database; wallet: Wallet; policyId: string; provider: ExecutionProvider }> {
  const db = getDb();
  const wallet = await requireAuthenticatedWallet(db);
  const parsed = policyIdSchema.safeParse((await params).policyId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid request: check policyId.");
  return { db, wallet, policyId: parsed.data, provider: getExecutionProvider(db) };
}
