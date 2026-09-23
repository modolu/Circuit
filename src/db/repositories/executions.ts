import "server-only";
import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { executions, type Execution, type NewExecution } from "../schema.ts";

export async function findExecutionByPolicyId(
  db: DbExecutor,
  policyId: string,
): Promise<Execution | undefined> {
  const [row] = await db.select().from(executions).where(eq(executions.policyId, policyId)).limit(1);
  return row;
}

/**
 * Records the single logical execution for a policy. Repeated reconciliation is
 * safe: if one already exists, it is returned unchanged with `inserted: false`.
 */
export async function insertExecutionOnce(
  db: DbExecutor,
  execution: Omit<NewExecution, "id" | "createdAt">,
): Promise<{ inserted: boolean; execution: Execution }> {
  const [inserted] = await db
    .insert(executions)
    .values(execution)
    .onConflictDoNothing({ target: executions.policyId })
    .returning();
  if (inserted) return { inserted: true, execution: inserted };

  const existing = await findExecutionByPolicyId(db, execution.policyId);
  if (!existing) throw new Error("execution conflict without an existing row");
  return { inserted: false, execution: existing };
}
