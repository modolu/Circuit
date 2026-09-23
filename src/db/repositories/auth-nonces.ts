import "server-only";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { authNonces, type AuthNonce, type NewAuthNonce } from "../schema.ts";

export async function insertAuthNonce(
  db: DbExecutor,
  nonce: Omit<NewAuthNonce, "id" | "consumedAt" | "createdAt">,
): Promise<AuthNonce> {
  const [row] = await db.insert(authNonces).values(nonce).returning();
  if (!row) throw new Error("auth nonce insert returned no row");
  return row;
}

export async function findAuthNonceByHash(db: DbExecutor, nonceHash: string): Promise<AuthNonce | undefined> {
  const [row] = await db.select().from(authNonces).where(eq(authNonces.nonceHash, nonceHash)).limit(1);
  return row;
}

/**
 * Atomically marks a challenge consumed. Succeeds only while it is unconsumed,
 * unexpired and bound to `walletAddress`; concurrent callers cannot both win.
 */
export async function consumeAuthNonce(
  db: DbExecutor,
  { nonceHash, walletAddress, now }: { nonceHash: string; walletAddress: string; now: Date },
): Promise<AuthNonce | undefined> {
  const [row] = await db
    .update(authNonces)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authNonces.nonceHash, nonceHash),
        eq(authNonces.walletAddress, walletAddress),
        isNull(authNonces.consumedAt),
        gt(authNonces.expiresAt, now),
      ),
    )
    .returning();
  return row;
}

/** Housekeeping: expired challenges carry no audit value. */
export async function deleteAuthNoncesExpiredBefore(db: DbExecutor, cutoff: Date): Promise<number> {
  const deleted = await db
    .delete(authNonces)
    .where(lt(authNonces.expiresAt, cutoff))
    .returning({ id: authNonces.id });
  return deleted.length;
}
