CREATE TABLE "auth_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce_hash" text NOT NULL,
	"wallet_address" text NOT NULL,
	"app_origin" text NOT NULL,
	"cluster" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_nonces_nonce_hash_unique" UNIQUE("nonce_hash"),
	CONSTRAINT "auth_nonces_expires_after_issued" CHECK ("auth_nonces"."expires_at" > "auth_nonces"."issued_at")
);
--> statement-breakpoint
CREATE INDEX "auth_nonces_expires_idx" ON "auth_nonces" USING btree ("expires_at");