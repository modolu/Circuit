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
  LIVE_PROVIDER_STATES,
  MAX_SLIPPAGE_BPS_CEILING,
  POLICY_EVENT_SOURCES,
  POLICY_SIDES,
  POLICY_STATUSES,
  PROVIDER_BACKED_STATUSES,
  PROVIDER_ORDER_STATES,
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
export const executionEvidenceSource = pgEnum("execution_evidence_source", ["ONCHAIN", "SIMULATED"]);
export const mockProviderOrderState = pgEnum("mock_provider_order_state", PROVIDER_ORDER_STATES);
/** Live Jupiter order display state (Task 9), stored beside the coarser Circuit status. */
export const liveProviderState = pgEnum("live_provider_state", LIVE_PROVIDER_STATES);
export const jupiterCancelPreparationStatus = pgEnum("jupiter_cancel_preparation_status", [
  "PREPARED",
  "SUBMITTING",
  "CONFIRMED",
  "INVALIDATED",
]);
export const jupiterCancelPurpose = pgEnum("jupiter_cancel_purpose", ["CANCEL", "WITHDRAW_EXPIRED"]);
export const jupiterDepositPreparationStatus = pgEnum("jupiter_deposit_preparation_status", [
  "PREPARING",
  "CRAFTED",
  "CONSUMED",
  "INVALIDATED",
]);

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
    /**
     * Live Jupiter display state (e.g. EXECUTING, PENDING_WITHDRAW) that the coarse Circuit
     * status cannot express. Null for drafts and simulated policies.
     */
    providerState: liveProviderState("provider_state"),
    providerStateUpdatedAt: timestamptz("provider_state_updated_at"),
    /** Provider-reported progress only (inputUsed, outputAmount, fillPercent as strings). Never computed. */
    providerProgressJson: jsonb("provider_progress_json").$type<Record<string, unknown>>(),

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
    /**
     * ONCHAIN: real settlement; signature and output amount are required.
     * SIMULATED: mock provider fill; there is no Solana transaction, so both must be null.
     */
    evidenceSource: executionEvidenceSource("evidence_source").notNull().default("ONCHAIN"),
    transactionSignature: text("transaction_signature"),
    inputAmountAtomic: atomicAmount("input_amount_atomic").notNull(),
    outputAmountAtomic: atomicAmount("output_amount_atomic"),
    effectivePriceUsd: usdDecimal("effective_price_usd"),
    fillJson: jsonb("fill_json").$type<Record<string, unknown>>().notNull(),
    executedAt: timestamptz("executed_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("executions_input_amount_non_negative", sql`${t.inputAmountAtomic} >= 0`),
    check("executions_output_amount_non_negative", sql`${t.outputAmountAtomic} >= 0`),
    check(
      "executions_evidence_matches_source",
      sql`(${t.evidenceSource} = 'ONCHAIN' AND ${t.transactionSignature} IS NOT NULL AND ${t.outputAmountAtomic} IS NOT NULL)
        OR (${t.evidenceSource} = 'SIMULATED' AND ${t.transactionSignature} IS NULL AND ${t.outputAmountAtomic} IS NULL)`,
    ),
  ],
);

/**
 * HACKATHON/DEMO INFRASTRUCTURE (CIRCUIT_ARCHITECTURE.md §5.8). The durable state
 * of the simulated execution provider, used only when CIRCUIT_JUPITER_MODE=mock.
 * It stands in for Jupiter's own records and is never real Jupiter or Solana state.
 * Removable once live execution is the only supported mode.
 */
export const mockProviderOrders = pgTable(
  "mock_provider_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerOrderId: text("provider_order_id").notNull().unique(),
    clientRequestId: text("client_request_id").notNull().unique(),
    policyId: uuid("policy_id")
      .notNull()
      .unique()
      .references(() => policies.id),
    state: mockProviderOrderState("state").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    filledAt: timestamptz("filled_at"),
    cancelledAt: timestamptz("cancelled_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("mock_provider_orders_id_prefix", sql`left(${t.providerOrderId}, 5) = 'mock_'`)],
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
export type MockProviderOrder = typeof mockProviderOrders.$inferSelect;

/**
 * Pre-signing Jupiter Trigger deposit state (CIRCUIT_ARCHITECTURE.md §5.9), live mode only.
 * - PREPARING: a reservation made before calling /deposit/craft (no DB transaction is held over HTTP).
 * - CRAFTED: Jupiter's single-use deposit requestId and the UNSIGNED transaction, committed
 *   before the transaction is ever returned for signing.
 * - CONSUMED: the requestId was used by a confirmed order creation (Task 9).
 * - INVALIDATED: released (craft failed, stale reservation, definitive rejection).
 * Submission (Task 9) is CRAFTED with `submission_started_at` set: the wallet's public
 * deposit signature is committed BEFORE POST /orders/price, as the recovery anchor.
 * `signed_transaction` is held only while submission is unresolved (for Jupiter's
 * documented idempotent create retry without a second wallet signature) and is cleared
 * on CONSUMED/INVALIDATED. Never stores private keys or the Jupiter JWT.
 */
export const jupiterDepositPreparations = pgTable(
  "jupiter_deposit_preparations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    status: jupiterDepositPreparationStatus("status").notNull(),
    depositRequestId: text("deposit_request_id").unique(),
    /** Base64 UNSIGNED provider transaction exactly as Jupiter returned it. */
    unsignedTransaction: text("unsigned_transaction"),
    receiverAddress: text("receiver_address"),
    inputMint: text("input_mint").notNull(),
    outputMint: text("output_mint").notNull(),
    inputAmountAtomic: atomicAmount("input_amount_atomic").notNull(),
    /** Public transaction id of the wallet-signed deposit (base58). The ARMING recovery anchor. */
    depositTxSignature: text("deposit_tx_signature").unique(),
    signedTransaction: text("signed_transaction"),
    submissionStartedAt: timestamptz("submission_started_at"),
    consumedAt: timestamptz("consumed_at"),
    providerOrderId: text("provider_order_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "jupiter_deposit_preparations_submission_has_signature",
      sql`${t.submissionStartedAt} IS NULL OR ${t.depositTxSignature} IS NOT NULL`,
    ),
    uniqueIndex("jupiter_deposit_preparations_one_active_per_policy")
      .on(t.policyId)
      .where(sql`${t.status} IN ('PREPARING', 'CRAFTED')`),
    check("jupiter_deposit_preparations_amount_positive", sql`${t.inputAmountAtomic} > 0`),
    check(
      "jupiter_deposit_preparations_crafted_has_request",
      sql`${t.status} NOT IN ('CRAFTED', 'CONSUMED') OR (${t.depositRequestId} IS NOT NULL AND ${t.unsignedTransaction} IS NOT NULL)`,
    ),
  ],
);

export type JupiterDepositPreparation = typeof jupiterDepositPreparations.$inferSelect;

/**
 * Two-step Jupiter cancellation / withdrawal state (Task 9). Jupiter's cancel call stops
 * fills and returns an UNSIGNED withdrawal transaction plus a cancelRequestId; Circuit
 * persists both so the wallet's signed transaction can be verified against exactly what
 * was prepared. The verified signed transaction (and its public transaction id, when the
 * wallet is the fee payer) is committed before confirm-cancel; otherwise the withdrawal
 * signature is recorded from Jupiter's confirm response. `signed_transaction` is held only
 * while confirmation is unresolved and cleared after.
 * Calling cancel again re-crafts (documented as idempotent): the previous row is invalidated.
 */
export const jupiterCancelPreparations = pgTable(
  "jupiter_cancel_preparations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    providerOrderId: text("provider_order_id").notNull(),
    purpose: jupiterCancelPurpose("purpose").notNull(),
    status: jupiterCancelPreparationStatus("status").notNull(),
    cancelRequestId: text("cancel_request_id").notNull(),
    /** Base64 UNSIGNED withdrawal transaction exactly as Jupiter returned it. */
    unsignedTransaction: text("unsigned_transaction").notNull(),
    withdrawalTxSignature: text("withdrawal_tx_signature"),
    signedTransaction: text("signed_transaction"),
    submissionStartedAt: timestamptz("submission_started_at"),
    confirmedAt: timestamptz("confirmed_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("jupiter_cancel_preparations_one_active_per_policy")
      .on(t.policyId)
      .where(sql`${t.status} IN ('PREPARED', 'SUBMITTING')`),
    check(
      "jupiter_cancel_preparations_submitting_has_signed_tx",
      sql`${t.status} <> 'SUBMITTING' OR ${t.signedTransaction} IS NOT NULL`,
    ),
  ],
);

export type JupiterCancelPreparation = typeof jupiterCancelPreparations.$inferSelect;
