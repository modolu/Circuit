import "server-only";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { jupiterCancelPreparations, type JupiterCancelPreparation } from "../schema.ts";

/* Two-step Jupiter cancellation / withdrawal state (live mode). Reads/writes only. */

type Status = JupiterCancelPreparation["status"];
const ACTIVE: Status[] = ["PREPARED", "SUBMITTING"];

export async function findActiveCancelPreparation(db: DbExecutor, policyId: string): Promise<JupiterCancelPreparation | undefined> {
  const [row] = await db
    .select()
    .from(jupiterCancelPreparations)
    .where(and(eq(jupiterCancelPreparations.policyId, policyId), inArray(jupiterCancelPreparations.status, ACTIVE)))
    .limit(1);
  return row;
}

export async function findCancelPreparation(
  db: DbExecutor,
  { id, policyId }: { id: string; policyId: string },
): Promise<JupiterCancelPreparation | undefined> {
  const [row] = await db
    .select()
    .from(jupiterCancelPreparations)
    .where(and(eq(jupiterCancelPreparations.id, id), eq(jupiterCancelPreparations.policyId, policyId)))
    .limit(1);
  return row;
}

export async function findLatestConfirmedCancelPreparation(db: DbExecutor, policyId: string): Promise<JupiterCancelPreparation | undefined> {
  const [row] = await db
    .select()
    .from(jupiterCancelPreparations)
    .where(and(eq(jupiterCancelPreparations.policyId, policyId), eq(jupiterCancelPreparations.status, "CONFIRMED")))
    .orderBy(desc(jupiterCancelPreparations.confirmedAt))
    .limit(1);
  return row;
}

/** Invalidates any active preparation for the policy (a re-craft replaces it). Call inside a transaction. */
export async function invalidateActiveCancelPreparations(db: DbExecutor, { policyId, now }: { policyId: string; now: Date }): Promise<void> {
  await db
    .update(jupiterCancelPreparations)
    .set({ status: "INVALIDATED", signedTransaction: null, updatedAt: now })
    .where(and(eq(jupiterCancelPreparations.policyId, policyId), inArray(jupiterCancelPreparations.status, ACTIVE)));
}

export async function insertCancelPreparation(
  db: DbExecutor,
  values: {
    policyId: string;
    walletId: string;
    providerOrderId: string;
    purpose: JupiterCancelPreparation["purpose"];
    cancelRequestId: string;
    unsignedTransaction: string;
    now: Date;
  },
): Promise<JupiterCancelPreparation> {
  const [row] = await db
    .insert(jupiterCancelPreparations)
    .values({
      policyId: values.policyId,
      walletId: values.walletId,
      providerOrderId: values.providerOrderId,
      purpose: values.purpose,
      status: "PREPARED",
      cancelRequestId: values.cancelRequestId,
      unsignedTransaction: values.unsignedTransaction,
      createdAt: values.now,
      updatedAt: values.now,
    })
    .returning();
  if (!row) throw new Error("cancel preparation insert returned no row");
  return row;
}

/**
 * PREPARED → SUBMITTING with the verified signed withdrawal (and its public transaction id
 * when known), committed before confirm-cancel. A retry of the SAME signed transaction is
 * accepted only once the previous attempt is older than `olderThan` (no overlapping calls).
 */
export async function markCancelSubmissionStarted(
  db: DbExecutor,
  {
    id,
    withdrawalTxSignature,
    signedTransaction,
    olderThan,
    now,
  }: { id: string; withdrawalTxSignature: string | null; signedTransaction: string; olderThan: Date; now: Date },
): Promise<JupiterCancelPreparation | undefined> {
  const [row] = await db
    .update(jupiterCancelPreparations)
    .set({ status: "SUBMITTING", withdrawalTxSignature, signedTransaction, submissionStartedAt: now, updatedAt: now })
    .where(
      and(
        eq(jupiterCancelPreparations.id, id),
        or(
          eq(jupiterCancelPreparations.status, "PREPARED"),
          and(
            eq(jupiterCancelPreparations.status, "SUBMITTING"),
            eq(jupiterCancelPreparations.signedTransaction, signedTransaction),
            lt(jupiterCancelPreparations.submissionStartedAt, olderThan),
          ),
        ),
      ),
    )
    .returning();
  return row;
}

export async function confirmCancelPreparation(
  db: DbExecutor,
  { id, withdrawalTxSignature, now }: { id: string; withdrawalTxSignature: string; now: Date },
): Promise<JupiterCancelPreparation | undefined> {
  const [row] = await db
    .update(jupiterCancelPreparations)
    .set({ status: "CONFIRMED", withdrawalTxSignature, confirmedAt: now, signedTransaction: null, updatedAt: now })
    .where(and(eq(jupiterCancelPreparations.id, id), eq(jupiterCancelPreparations.status, "SUBMITTING")))
    .returning();
  return row;
}

export async function invalidateCancelPreparation(
  db: DbExecutor,
  { id, now }: { id: string; now: Date },
): Promise<JupiterCancelPreparation | undefined> {
  const [row] = await db
    .update(jupiterCancelPreparations)
    .set({ status: "INVALIDATED", signedTransaction: null, updatedAt: now })
    .where(and(eq(jupiterCancelPreparations.id, id), inArray(jupiterCancelPreparations.status, ACTIVE)))
    .returning();
  return row;
}
