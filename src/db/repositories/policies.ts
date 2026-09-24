import "server-only";
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { PolicyStatus } from "../../domain/policy.ts";
import type { DbExecutor } from "../client.ts";
import {
  policies,
  policyEvents,
  type NewPolicy,
  type NewPolicyEvent,
  type Policy,
  type PolicyEvent,
} from "../schema.ts";

/*
 * Persistence primitives only. Which transitions are allowed, and when, is
 * decided by domain/service code (CIRCUIT_ARCHITECTURE.md §17).
 */

export async function insertPolicy(
  db: DbExecutor,
  policy: Omit<NewPolicy, "id" | "createdAt" | "updatedAt"> & { createdAt?: Date },
): Promise<Policy> {
  const [row] = await db.insert(policies).values(policy).returning();
  if (!row) throw new Error("policy insert returned no row");
  return row;
}

export async function findPolicyById(db: DbExecutor, id: string): Promise<Policy | undefined> {
  const [row] = await db.select().from(policies).where(eq(policies.id, id)).limit(1);
  return row;
}

/** Scoped read: returns nothing unless the policy belongs to `walletId`. */
export async function findPolicyForWallet(
  db: DbExecutor,
  { policyId, walletId }: { policyId: string; walletId: string },
): Promise<Policy | undefined> {
  const [row] = await db
    .select()
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.walletId, walletId)))
    .limit(1);
  return row;
}

/**
 * Locks the row for the rest of the transaction (`SELECT … FOR UPDATE`), so
 * concurrent arm/reconcile attempts serialize. Call inside `db.transaction`.
 */
export async function lockPolicyForUpdate(db: DbExecutor, id: string): Promise<Policy | undefined> {
  const [row] = await db.select().from(policies).where(eq(policies.id, id)).limit(1).for("update");
  return row;
}

export interface PolicyCursor {
  createdAt: Date;
  id: string;
}

/** Newest first, cursor-paginated on (created_at, id). */
export async function listPoliciesForWallet(
  db: DbExecutor,
  walletId: string,
  { limit = 20, before }: { limit?: number; before?: PolicyCursor } = {},
): Promise<Policy[]> {
  const scope = eq(policies.walletId, walletId);
  const page = before
    ? or(
        lt(policies.createdAt, before.createdAt),
        and(eq(policies.createdAt, before.createdAt), lt(policies.id, before.id)),
      )
    : undefined;
  return db
    .select()
    .from(policies)
    .where(page ? and(scope, page) : scope)
    .orderBy(desc(policies.createdAt), desc(policies.id))
    .limit(limit);
}

export async function listPoliciesByStatus(
  db: DbExecutor,
  status: PolicyStatus,
  { limit = 100 }: { limit?: number } = {},
): Promise<Policy[]> {
  return db
    .select()
    .from(policies)
    .where(eq(policies.status, status))
    .orderBy(asc(policies.expiresAt))
    .limit(limit);
}

/** The only mutable policy columns. Intent fields (asset, side, amount, trigger…) never change after insert. */
export type PolicyStateChanges = Partial<
  Pick<
    Policy,
    | "status"
    | "provider"
    | "providerOrderId"
    | "failureCode"
    | "failureMessage"
    | "armedAt"
    | "executedAt"
    | "cancelledAt"
    | "providerState"
    | "providerStateUpdatedAt"
    | "providerProgressJson"
  >
>;

/**
 * Compare-and-set update: applies `changes` only while the policy is still in
 * one of `expectedStatuses`. Returns the updated row, or `undefined` if another
 * writer got there first.
 */
export async function updatePolicyStateIfStatus(
  db: DbExecutor,
  {
    policyId,
    expectedStatuses,
    changes,
  }: { policyId: string; expectedStatuses: readonly PolicyStatus[]; changes: PolicyStateChanges },
): Promise<Policy | undefined> {
  const [row] = await db
    .update(policies)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(policies.id, policyId), inArray(policies.status, [...expectedStatuses])))
    .returning();
  return row;
}

/** Audit events are append-only: there is deliberately no update or delete here. */
export async function appendPolicyEvent(
  db: DbExecutor,
  event: Omit<NewPolicyEvent, "id" | "sequenceNumber" | "createdAt"> & { createdAt?: Date },
): Promise<PolicyEvent> {
  const [row] = await db.insert(policyEvents).values(event).returning();
  if (!row) throw new Error("policy event insert returned no row");
  return row;
}

export async function listPolicyEvents(db: DbExecutor, policyId: string): Promise<PolicyEvent[]> {
  return db
    .select()
    .from(policyEvents)
    .where(eq(policyEvents.policyId, policyId))
    .orderBy(asc(policyEvents.createdAt), asc(policyEvents.sequenceNumber));
}
