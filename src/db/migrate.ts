import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { closeDb, getDb } from "./client.ts";

/*
 * Applies committed migrations from src/db/migrations with the same Neon
 * WebSocket driver the app uses. Additive only: never resets or drops.
 * Prints the database name and table list, never the connection string.
 *
 * Run with `pnpm db:migrate`.
 */

const EXPECTED_TABLES = ["assets", "auth_nonces", "executions", "policies", "policy_events", "wallets"];

async function run(): Promise<void> {
  const db = getDb();

  const reach = await db.execute<{ database: string; version: string }>(
    sql`select current_database() as database, split_part(version(), ' ', 2) as version`,
  );
  const info = reach.rows[0];
  console.log(`migrate: connected to database "${info?.database}" (PostgreSQL ${info?.version})`);

  await migrate(db, { migrationsFolder: "src/db/migrations" });
  console.log("migrate: migrations applied");

  const tables = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  );
  const present = tables.rows.map((row) => row.table_name);
  const missing = EXPECTED_TABLES.filter((name) => !present.includes(name));
  console.log(`migrate: public tables: ${present.join(", ") || "(none)"}`);
  if (missing.length > 0) throw new Error(`expected tables missing: ${missing.join(", ")}`);
}

try {
  await run();
} catch (error) {
  console.error(`migrate failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
