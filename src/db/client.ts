import "server-only";
import { Pool } from "@neondatabase/serverless";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { getDatabaseUrl } from "../config/env.ts";
import * as schema from "./schema.ts";

export type Schema = typeof schema;

/** Any Drizzle Postgres database for this schema (Neon in the app, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export type DbTransaction = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** What repositories accept: the database or an open transaction, so services control transaction scope. */
export type DbExecutor = Database | DbTransaction;

let pool: Pool | undefined;
let db: NeonDatabase<Schema> | undefined;

/**
 * Lazily connects on first use, so importing this module never contacts Neon
 * (keeps `next build` and unit tests offline). Uses the WebSocket `Pool`
 * driver because policy flows need interactive transactions and row locks;
 * Node 22 provides the global `WebSocket` it relies on.
 */
export function getDb(): NeonDatabase<Schema> {
  if (!db) {
    pool = new Pool({ connectionString: getDatabaseUrl() });
    db = drizzle({ client: pool, schema });
  }
  return db;
}

/** Closes the pool. For scripts (migrate, seed) that must exit cleanly. */
export async function closeDb(): Promise<void> {
  const current = pool;
  pool = undefined;
  db = undefined;
  await current?.end();
}
