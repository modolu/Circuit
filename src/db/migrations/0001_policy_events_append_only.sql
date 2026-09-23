-- policy_events is an append-only audit trail (CIRCUIT_ARCHITECTURE.md §5.4).
-- Corrections are appended as new events; existing rows are never rewritten or removed.
CREATE FUNCTION "public"."circuit_reject_policy_event_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'policy_events is append-only: % is not allowed', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "policy_events_append_only"
	BEFORE UPDATE OR DELETE ON "public"."policy_events"
	FOR EACH ROW EXECUTE FUNCTION "public"."circuit_reject_policy_event_mutation"();
--> statement-breakpoint
CREATE TRIGGER "policy_events_no_truncate"
	BEFORE TRUNCATE ON "public"."policy_events"
	FOR EACH STATEMENT EXECUTE FUNCTION "public"."circuit_reject_policy_event_mutation"();
