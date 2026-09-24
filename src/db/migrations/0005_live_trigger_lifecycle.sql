CREATE TYPE "public"."jupiter_cancel_preparation_status" AS ENUM('PREPARED', 'SUBMITTING', 'CONFIRMED', 'INVALIDATED');--> statement-breakpoint
CREATE TYPE "public"."jupiter_cancel_purpose" AS ENUM('CANCEL', 'WITHDRAW_EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."live_provider_state" AS ENUM('PENDING', 'OPEN', 'EXECUTING', 'FILLED', 'PENDING_WITHDRAW', 'CANCELLED', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TABLE "jupiter_cancel_preparations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"provider_order_id" text NOT NULL,
	"purpose" "jupiter_cancel_purpose" NOT NULL,
	"status" "jupiter_cancel_preparation_status" NOT NULL,
	"cancel_request_id" text NOT NULL,
	"unsigned_transaction" text NOT NULL,
	"withdrawal_tx_signature" text,
	"signed_transaction" text,
	"submission_started_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jupiter_cancel_preparations_submitting_has_signed_tx" CHECK ("jupiter_cancel_preparations"."status" <> 'SUBMITTING' OR "jupiter_cancel_preparations"."signed_transaction" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "jupiter_deposit_preparations" ADD COLUMN "deposit_tx_signature" text;--> statement-breakpoint
ALTER TABLE "jupiter_deposit_preparations" ADD COLUMN "signed_transaction" text;--> statement-breakpoint
ALTER TABLE "jupiter_deposit_preparations" ADD COLUMN "submission_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jupiter_deposit_preparations" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jupiter_deposit_preparations" ADD COLUMN "provider_order_id" text;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "provider_state" "live_provider_state";--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "provider_state_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "provider_progress_json" jsonb;--> statement-breakpoint
ALTER TABLE "jupiter_cancel_preparations" ADD CONSTRAINT "jupiter_cancel_preparations_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jupiter_cancel_preparations" ADD CONSTRAINT "jupiter_cancel_preparations_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jupiter_cancel_preparations_one_active_per_policy" ON "jupiter_cancel_preparations" USING btree ("policy_id") WHERE "jupiter_cancel_preparations"."status" IN ('PREPARED', 'SUBMITTING');--> statement-breakpoint
ALTER TABLE "jupiter_deposit_preparations" ADD CONSTRAINT "jupiter_deposit_preparations_deposit_tx_signature_unique" UNIQUE("deposit_tx_signature");--> statement-breakpoint
ALTER TABLE "jupiter_deposit_preparations" ADD CONSTRAINT "jupiter_deposit_preparations_submission_has_signature" CHECK ("jupiter_deposit_preparations"."submission_started_at" IS NULL OR "jupiter_deposit_preparations"."deposit_tx_signature" IS NOT NULL);