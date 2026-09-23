import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
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
    .set({ status: "INVALIDATED", updatedAt: now })
    .where(and(eq(jupiterDepositPreparations.id, id), inArray(jupiterDepositPreparations.status, [...from])))
    .returning();
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
