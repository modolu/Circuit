CREATE TYPE "public"."execution_evidence_source" AS ENUM('ONCHAIN', 'SIMULATED');--> statement-breakpoint
CREATE TYPE "public"."mock_provider_order_state" AS ENUM('OPEN', 'FILLED', 'CANCELLED', 'EXPIRED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."policy_event_source" ADD VALUE 'MOCK_PROVIDER';--> statement-breakpoint
CREATE TABLE "mock_provider_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_order_id" text NOT NULL,
	"client_request_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"state" "mock_provider_order_state" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"filled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_provider_orders_provider_order_id_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "mock_provider_orders_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "mock_provider_orders_policy_id_unique" UNIQUE("policy_id"),
	CONSTRAINT "mock_provider_orders_id_prefix" CHECK (left("mock_provider_orders"."provider_order_id", 5) = 'mock_')
);
--> statement-breakpoint
ALTER TABLE "executions" ALTER COLUMN "transaction_signature" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "executions" ALTER COLUMN "output_amount_atomic" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "evidence_source" "execution_evidence_source" DEFAULT 'ONCHAIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_provider_orders" ADD CONSTRAINT "mock_provider_orders_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_evidence_matches_source" CHECK (("executions"."evidence_source" = 'ONCHAIN' AND "executions"."transaction_signature" IS NOT NULL AND "executions"."output_amount_atomic" IS NOT NULL)
        OR ("executions"."evidence_source" = 'SIMULATED' AND "executions"."transaction_signature" IS NULL AND "executions"."output_amount_atomic" IS NULL));