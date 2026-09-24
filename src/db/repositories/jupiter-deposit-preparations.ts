import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { jupiterDepositPreparations, type JupiterDepositPreparation } from "../schema.ts";

/* Pre-signing Jupiter deposit state (live mode). Reads/writes only; no provider calls here. */

type Status = JupiterDepositPreparation["status"];

export async function findActiveDepositPreparation(db: DbExecutor, policyId: string): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .select()
    .from(jupiterDepositPreparations)
    .where(and(eq(jupiterDepositPreparations.policyId, policyId), inArray(jupiterDepositPreparations.status, ["PREPARING", "CRAFTED"])))
    .limit(1);
  return row;
}

/** Reserves the policy's single active slot. Returns undefined if another active preparation exists. */
export async function reserveDepositPreparation(
  db: DbExecutor,
  values: { policyId: string; walletId: string; inputMint: string; outputMint: string; inputAmountAtomic: bigint; now: Date },
): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .insert(jupiterDepositPreparations)
    .values({
      policyId: values.policyId,
      walletId: values.walletId,
      status: "PREPARING",
      inputMint: values.inputMint,
      outputMint: values.outputMint,
      inputAmountAtomic: values.inputAmountAtomic,
      createdAt: values.now,
      updatedAt: values.now,
    })
    .onConflictDoNothing()
    .returning();
  return row;
}

/** PREPARING → CRAFTED with the provider's single-use requestId and unsigned transaction (compare-and-set). */
export async function markDepositPreparationCrafted(
  db: DbExecutor,
  { id, depositRequestId, unsignedTransaction, receiverAddress, now }: {
    id: string;
    depositRequestId: string;
    unsignedTransaction: string;
    receiverAddress: string;
    now: Date;
  },
): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .update(jupiterDepositPreparations)
    .set({ status: "CRAFTED", depositRequestId, unsignedTransaction, receiverAddress, updatedAt: now })
    .where(and(eq(jupiterDepositPreparations.id, id), eq(jupiterDepositPreparations.status, "PREPARING")))
    .returning();
  return row;
}

export async function invalidateDepositPreparation(
  db: DbExecutor,
  { id, from, now }: { id: string; from: readonly Status[]; now: Date },
): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .update(jupiterDepositPreparations)
    .set({ status: "INVALIDATED", signedTransaction: null, updatedAt: now })
    .where(and(eq(jupiterDepositPreparations.id, id), inArray(jupiterDepositPreparations.status, [...from])))
    .returning();
  return row;
}

/** Releases a CRAFTED preparation that was never submitted (e.g. its blockhash is too old to sign). */
export async function invalidateUnsubmittedCrafted(
  db: DbExecutor,
  { id, now }: { id: string; now: Date },
): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .update(jupiterDepositPreparations)
    .set({ status: "INVALIDATED", updatedAt: now })
    .where(
      and(
        eq(jupiterDepositPreparations.id, id),
        eq(jupiterDepositPreparations.status, "CRAFTED"),
        isNull(jupiterDepositPreparations.submissionStartedAt),
      ),
    )
    .returning();
  return row;
}

export async function findDepositPreparation(
  db: DbExecutor,
  { id, policyId }: { id: string; policyId: string },
): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .select()
    .from(jupiterDepositPreparations)
    .where(and(eq(jupiterDepositPreparations.id, id), eq(jupiterDepositPreparations.policyId, policyId)))
    .limit(1);
  return row;
}

/**
 * FIRST submission: commits the wallet's public deposit signature and, transiently, the
 * verified signed transaction BEFORE the provider create call. Compare-and-set: only a
 * CRAFTED preparation that has never been submitted qualifies, so concurrent requests
 * cannot both reach Jupiter.
 */
export async function markDepositSubmissionStarted(
  db: DbExecutor,
  { id, depositTxSignature, signedTransaction, now }: { id: string; depositTxSignature: string; signedTransaction: string; now: Date },
): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .update(jupiterDepositPreparations)
    .set({ depositTxSignature, signedTransaction, submissionStartedAt: now, updatedAt: now })
    .where(
      and(
        eq(jupiterDepositPreparations.id, id),
        eq(jupiterDepositPreparations.status, "CRAFTED"),
        isNull(jupiterDepositPreparations.submissionStartedAt),
      ),
    )
    .returning();
  return row;
}

/**
 * Explicit RESUBMISSION of the same signed deposit (Jupiter documents create retries with
 * the same deposit as idempotent). Only after the previous attempt is older than
 * `olderThan`, so a retry never overlaps an in-flight create call.
 */
export async function claimDepositResubmission(
  db: DbExecutor,
  { id, depositTxSignature, olderThan, now }: { id: string; depositTxSignature: string; olderThan: Date; now: Date },
): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .update(jupiterDepositPreparations)
    .set({ submissionStartedAt: now, updatedAt: now })
    .where(
      and(
        eq(jupiterDepositPreparations.id, id),
        eq(jupiterDepositPreparations.status, "CRAFTED"),
        eq(jupiterDepositPreparations.depositTxSignature, depositTxSignature),
        isNotNull(jupiterDepositPreparations.signedTransaction),
        lt(jupiterDepositPreparations.submissionStartedAt, olderThan),
      ),
    )
    .returning();
  return row;
}

/** CRAFTED (submitted) → CONSUMED once Jupiter confirms the order exists. Clears the signed transaction. */
export async function consumeDepositPreparation(
  db: DbExecutor,
  { id, providerOrderId, now }: { id: string; providerOrderId: string; now: Date },
): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .update(jupiterDepositPreparations)
    .set({ status: "CONSUMED", providerOrderId, consumedAt: now, signedTransaction: null, updatedAt: now })
    .where(
      and(
        eq(jupiterDepositPreparations.id, id),
        eq(jupiterDepositPreparations.status, "CRAFTED"),
        isNotNull(jupiterDepositPreparations.submissionStartedAt),
      ),
    )
    .returning();
  return row;
}

/** The preparation whose signed deposit was sent (or consumed) for this policy: the recovery anchor. */
export async function findSubmittedDepositPreparation(db: DbExecutor, policyId: string): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .select()
    .from(jupiterDepositPreparations)
    .where(
      and(
        eq(jupiterDepositPreparations.policyId, policyId),
        isNotNull(jupiterDepositPreparations.depositTxSignature),
        inArray(jupiterDepositPreparations.status, ["CRAFTED", "CONSUMED"]),
      ),
    )
    .orderBy(desc(jupiterDepositPreparations.submissionStartedAt))
    .limit(1);
  return row;
}

/** Releases a PREPARING reservation abandoned by a crashed request. */
export async function invalidateStaleReservation(
  db: DbExecutor,
  { id, olderThan, now }: { id: string; olderThan: Date; now: Date },
): Promise<JupiterDepositPreparation | undefined> {
  const [row] = await db
    .update(jupiterDepositPreparations)
    .set({ status: "INVALIDATED", updatedAt: now })
    .where(
      and(
        eq(jupiterDepositPreparations.id, id),
        eq(jupiterDepositPreparations.status, "PREPARING"),
        lt(jupiterDepositPreparations.updatedAt, olderThan),
      ),
    )
    .returning();
  return row;
}
