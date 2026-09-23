CREATE TYPE "public"."policy_event_source" AS ENUM('USER', 'CIRCUIT', 'JUPITER', 'SOLANA', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."policy_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('DRAFT', 'ARMING', 'ARMED', 'EXECUTED', 'CANCELLED', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."source_expression_type" AS ENUM('ABSOLUTE_PRICE', 'RELATIVE_PERCENT');--> statement-breakpoint
CREATE TYPE "public"."trigger_direction" AS ENUM('ABOVE', 'BELOW');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"display_name" text NOT NULL,
	"issuer" text NOT NULL,
	"underlying_symbol" text NOT NULL,
	"mint_address" text NOT NULL,
	"decimals" smallint NOT NULL,
	"pyth_feed_id" text NOT NULL,
	"input_enabled" boolean DEFAULT true NOT NULL,
	"output_enabled" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_mint_address_unique" UNIQUE("mint_address"),
	CONSTRAINT "assets_decimals_range" CHECK ("assets"."decimals" BETWEEN 0 AND 255)
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"provider_order_id" text NOT NULL,
	"transaction_signature" text NOT NULL,
	"input_amount_atomic" numeric(78, 0) NOT NULL,
	"output_amount_atomic" numeric(78, 0) NOT NULL,
	"effective_price_usd" numeric,
	"fill_json" jsonb NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executions_policy_id_unique" UNIQUE("policy_id"),
	CONSTRAINT "executions_input_amount_non_negative" CHECK ("executions"."input_amount_atomic" >= 0),
	CONSTRAINT "executions_output_amount_non_negative" CHECK ("executions"."output_amount_atomic" >= 0)
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"side" "policy_side" NOT NULL,
	"trigger_direction" "trigger_direction" NOT NULL,
	"source_expression_type" "source_expression_type" NOT NULL,
	"source_expression_value" numeric NOT NULL,
	"compiled_trigger_usd" numeric NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"input_mint" text NOT NULL,
	"output_mint" text NOT NULL,
	"max_slippage_bps" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "policy_status" DEFAULT 'DRAFT' NOT NULL,
	"pyth_reference_usd" numeric NOT NULL,
	"pyth_feed_timestamp" timestamp with time zone NOT NULL,
	"pyth_snapshot_json" jsonb NOT NULL,
	"provider" text DEFAULT 'jupiter_trigger_v2' NOT NULL,
	"provider_order_id" text,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"armed_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_amount_atomic_positive" CHECK ("policies"."amount_atomic" > 0),
	CONSTRAINT "policies_max_slippage_bps_range" CHECK ("policies"."max_slippage_bps" >= 0 AND "policies"."max_slippage_bps" <= 10000),
	CONSTRAINT "policies_expires_after_created" CHECK ("policies"."expires_at" > "policies"."created_at"),
	CONSTRAINT "policies_compiled_trigger_positive" CHECK ("policies"."compiled_trigger_usd" > 0),
	CONSTRAINT "policies_provider_backed_has_order_id" CHECK ("policies"."status" NOT IN ('ARMED', 'EXECUTED', 'EXPIRED') OR "policies"."provider_order_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "policy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "policy_events_sequence_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"policy_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source" "policy_event_source" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_events" ADD CONSTRAINT "policy_events_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policies_wallet_created_idx" ON "policies" USING btree ("wallet_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "policies_status_expires_idx" ON "policies" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_provider_order_id_key" ON "policies" USING btree ("provider_order_id") WHERE "policies"."provider_order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "policy_events_policy_created_idx" ON "policy_events" USING btree ("policy_id","created_at");