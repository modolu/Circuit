CREATE TYPE "public"."jupiter_deposit_preparation_status" AS ENUM('PREPARING', 'CRAFTED', 'CONSUMED', 'INVALIDATED');--> statement-breakpoint
CREATE TABLE "jupiter_deposit_preparations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"status" "jupiter_deposit_preparation_status" NOT NULL,
	"deposit_request_id" text,
	"unsigned_transaction" text,
	"receiver_address" text,
	"input_mint" text NOT NULL,
	"output_mint" text NOT NULL,
	"input_amount_atomic" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jupiter_deposit_preparations_deposit_request_id_unique" UNIQUE("deposit_request_id"),
	CONSTRAINT "jupiter_deposit_preparations_amount_positive" CHECK ("jupiter_deposit_preparations"."input_amount_atomic" > 0),
	CONSTRAINT "jupiter_deposit_preparations_crafted_has_request" CHECK ("jupiter_deposit_preparations"."status" NOT IN ('CRAFTED', 'CONSUMED') OR ("jupiter_deposit_preparations"."deposit_request_id" IS NOT NULL AND "jupiter_deposit_preparations"."unsigned_transaction" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "jupiter_deposit_preparations" ADD CONSTRAINT "jupiter_deposit_preparations_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jupiter_deposit_preparations" ADD CONSTRAINT "jupiter_deposit_preparations_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jupiter_deposit_preparations_one_active_per_policy" ON "jupiter_deposit_preparations" USING btree ("policy_id") WHERE "jupiter_deposit_preparations"."status" IN ('PREPARING', 'CRAFTED');