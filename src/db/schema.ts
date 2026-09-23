import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DEFAULT_EXECUTION_PROVIDER,
  MAX_SLIPPAGE_BPS_CEILING,
  POLICY_EVENT_SOURCES,
  POLICY_SIDES,
  POLICY_STATUSES,
  PROVIDER_BACKED_STATUSES,
  SOURCE_EXPRESSION_TYPES,
  TRIGGER_DIRECTIONS,
} from "../domain/policy.ts";

/*
 * CIRCUIT_ARCHITECTURE.md §5. Money rules (§18):
 * - token quantities: numeric(78,0), surfaced to TypeScript as bigint;
 * - USD values: unconstrained numeric, surfaced as exact decimal strings.
 * Neither is ever converted to a JS number.
 */

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const atomicAmount = (name: string) => numeric(name, { precision: 78, scale: 0, mode: "bigint" });
const usdDecimal = (name: string) => numeric(name, { mode: "string" });

export const policySide = pgEnum("policy_side", POLICY_SIDES);
export const triggerDirection = pgEnum("trigger_direction", TRIGGER_DIRECTIONS);
export const sourceExpressionType = pgEnum("source_expression_type", SOURCE_EXPRESSION_TYPES);
export const policyStatus = pgEnum("policy_status", POLICY_STATUSES);
export const policyEventSource = pgEnum("policy_event_source", POLICY_EVENT_SOURCES);

export const wallets = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").notNull().unique(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
});

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    displayName: text("display_name").notNull(),
    issuer: text("issuer").notNull(),
    underlyingSymbol: text("underlying_symbol").notNull(),
    mintAddress: text("mint_address").notNull().unique(),
    decimals: smallint("decimals").notNull(),
    pythFeedId: text("pyth_feed_id").notNull(),
    inputEnabled: boolean("input_enabled").notNull().default(true),
    outputEnabled: boolean("output_enabled").notNull().default(true),
    active: boolean("active").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("assets_decimals_range", sql`${t.decimals} BETWEEN 0 AND 255`)],
);

const providerBackedList = sql.raw(PROVIDER_BACKED_STATUSES.map((status) => `'${status}'`).join(", "));

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),

    side: policySide("side").notNull(),
    triggerDirection: triggerDirection("trigger_direction").notNull(),

    sourceExpressionType: sourceExpressionType("source_expression_type").notNull(),
    sourceExpressionValue: usdDecimal("source_expression_value").notNull(),

    compiledTriggerUsd: usdDecimal("compiled_trigger_usd").notNull(),
    amountAtomic: atomicAmount("amount_atomic").notNull(),
    inputMint: text("input_mint").notNull(),
    outputMint: text("output_mint").notNull(),
    maxSlippageBps: integer("max_slippage_bps").notNull(),

    expiresAt: timestamptz("expires_at").notNull(),

    status: policyStatus("status").notNull().default("DRAFT"),

    pythReferenceUsd: usdDecimal("pyth_reference_usd").notNull(),
    pythFeedTimestamp: timestamptz("pyth_feed_timestamp").notNull(),
    pythSnapshotJson: jsonb("pyth_snapshot_json").$type<Record<string, unknown>>().notNull(),

    provider: text("provider").notNull().default(DEFAULT_EXECUTION_PROVIDER),
    providerOrderId: text("provider_order_id"),

    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),

    createdAt: timestamptz("created_at").notNull().defaultNow(),
    armedAt: timestamptz("armed_at"),
    executedAt: timestamptz("executed_at"),
    cancelledAt: timestamptz("cancelled_at"),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("policies_wallet_created_idx").on(t.walletId, t.createdAt.desc()),
    index("policies_status_expires_idx").on(t.status, t.expiresAt),
    uniqueIndex("policies_provider_order_id_key")
      .on(t.providerOrderId)
      .where(sql`${t.providerOrderId} IS NOT NULL`),
    check("policies_amount_atomic_positive", sql`${t.amountAtomic} > 0`),
    check(
      "policies_max_slippage_bps_range",
      sql`${t.maxSlippageBps} >= 0 AND ${t.maxSlippageBps} <= ${sql.raw(String(MAX_SLIPPAGE_BPS_CEILING))}`,
    ),
    check("policies_expires_after_created", sql`${t.expiresAt} > ${t.createdAt}`),
    check("policies_compiled_trigger_positive", sql`${t.compiledTriggerUsd} > 0`),
    check(
      "policies_provider_backed_has_order_id",
      sql`${t.status} NOT IN (${providerBackedList}) OR ${t.providerOrderId} IS NOT NULL`,
    ),
  ],
);

/** Append-only audit trail. A database trigger rejects UPDATE and DELETE (see migrations). */
export const policyEvents = pgTable(
  "policy_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Database-assigned append order. Breaks created_at ties so the trail never reorders.
    sequenceNumber: bigint("sequence_number", { mode: "bigint" }).notNull().generatedAlwaysAsIdentity(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    eventType: text("event_type").notNull(),
    source: policyEventSource("source").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    // clock_timestamp(), not now(): events appended in one transaction must keep their order.
    createdAt: timestamptz("created_at").notNull().default(sql`clock_timestamp()`),
  },
  (t) => [index("policy_events_policy_created_idx").on(t.policyId, t.createdAt.asc())],
);

export const executions = pgTable(
  "executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .unique()
      .references(() => policies.id),
    providerOrderId: text("provider_order_id").notNull(),
    transactionSignature: text("transaction_signature").notNull(),
    inputAmountAtomic: atomicAmount("input_amount_atomic").notNull(),
    outputAmountAtomic: atomicAmount("output_amount_atomic").notNull(),
    effectivePriceUsd: usdDecimal("effective_price_usd"),
    fillJson: jsonb("fill_json").$type<Record<string, unknown>>().notNull(),
    executedAt: timestamptz("executed_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("executions_input_amount_non_negative", sql`${t.inputAmountAtomic} >= 0`),
    check("executions_output_amount_non_negative", sql`${t.outputAmountAtomic} >= 0`),
  ],
);

/** Single-use Circuit login challenges (CIRCUIT_ARCHITECTURE.md §5.7). Stores a hash, never the raw nonce. */
export const authNonces = pgTable(
  "auth_nonces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nonceHash: text("nonce_hash").notNull().unique(),
    walletAddress: text("wallet_address").notNull(),
    appOrigin: text("app_origin").notNull(),
    cluster: text("cluster").notNull(),
    issuedAt: timestamptz("issued_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    consumedAt: timestamptz("consumed_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("auth_nonces_expires_idx").on(t.expiresAt),
    check("auth_nonces_expires_after_issued", sql`${t.expiresAt} > ${t.issuedAt}`),
  ],
);

export type Wallet = typeof wallets.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;
export type PolicyEvent = typeof policyEvents.$inferSelect;
export type NewPolicyEvent = typeof policyEvents.$inferInsert;
export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
export type AuthNonce = typeof authNonces.$inferSelect;
export type NewAuthNonce = typeof authNonces.$inferInsert;
