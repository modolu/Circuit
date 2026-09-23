import "server-only";
import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { wallets, type Wallet } from "../schema.ts";

export async function findWalletById(db: DbExecutor, id: string): Promise<Wallet | undefined> {
  const [row] = await db.select().from(wallets).where(eq(wallets.id, id)).limit(1);
  return row;
}

export async function findWalletByAddress(db: DbExecutor, address: string): Promise<Wallet | undefined> {
  const [row] = await db.select().from(wallets).where(eq(wallets.address, address)).limit(1);
  return row;
}

/** Creates the wallet on first sight, otherwise refreshes `last_seen_at`. One row per address. */
export async function upsertWalletSeen(
  db: DbExecutor,
  address: string,
  seenAt: Date = new Date(),
): Promise<Wallet> {
  const [row] = await db
    .insert(wallets)
    .values({ address, createdAt: seenAt, lastSeenAt: seenAt })
    .onConflictDoUpdate({ target: wallets.address, set: { lastSeenAt: seenAt } })
    .returning();
  if (!row) throw new Error("wallet upsert returned no row");
  return row;
}
