import "server-only";
import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { mockProviderOrders, type MockProviderOrder } from "../schema.ts";

/* Persistence for the simulated execution provider only (demo infrastructure). Never touches policies. */

type MockState = MockProviderOrder["state"];

export async function findMockOrderByProviderId(db: DbExecutor, providerOrderId: string): Promise<MockProviderOrder | undefined> {
  const [row] = await db.select().from(mockProviderOrders).where(eq(mockProviderOrders.providerOrderId, providerOrderId)).limit(1);
  return row;
}

export async function findMockOrderByClientRequestId(db: DbExecutor, clientRequestId: string): Promise<MockProviderOrder | undefined> {
  const [row] = await db.select().from(mockProviderOrders).where(eq(mockProviderOrders.clientRequestId, clientRequestId)).limit(1);
  return row;
}

/** Inserts unless the client request id already exists (idempotent create). */
export async function insertMockOrderIfAbsent(
  db: DbExecutor,
  order: { providerOrderId: string; clientRequestId: string; policyId: string; expiresAt: Date; createdAt: Date },
): Promise<MockProviderOrder | undefined> {
  const [row] = await db
    .insert(mockProviderOrders)
    .values({ ...order, state: "OPEN" })
    .onConflictDoNothing({ target: mockProviderOrders.clientRequestId })
    .returning();
  return row;
}

/** Compare-and-set state change: only from `from`. Returns the updated row, or undefined if the state had moved. */
export async function transitionMockOrder(
  db: DbExecutor,
  { providerOrderId, from, to, at }: { providerOrderId: string; from: MockState; to: MockState; at: Date },
): Promise<MockProviderOrder | undefined> {
  const [row] = await db
    .update(mockProviderOrders)
    .set({
      state: to,
      updatedAt: at,
      ...(to === "FILLED" ? { filledAt: at } : {}),
      ...(to === "CANCELLED" ? { cancelledAt: at } : {}),
    })
    .where(and(eq(mockProviderOrders.providerOrderId, providerOrderId), eq(mockProviderOrders.state, from)))
    .returning();
  return row;
}
