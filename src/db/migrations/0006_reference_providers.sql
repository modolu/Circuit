CREATE TYPE "public"."reference_provider" AS ENUM('PYTH', 'PRESTOCKS');--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "pyth_feed_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "reference_provider" "reference_provider" NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "reference_provider" "reference_provider" NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "reference_usd" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "reference_timestamp" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "reference_snapshot_json" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_pyth_feed_matches_provider" CHECK (("assets"."reference_provider" = 'PYTH') = ("assets"."pyth_feed_id" IS NOT NULL));