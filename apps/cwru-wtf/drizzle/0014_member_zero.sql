-- Allow an explicitly assigned member #0. Automatic numbering still starts at 1.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
SELECT pg_advisory_xact_lock(hashtextextended('dot-wtf:membership', 0));
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_number_check";
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_number_check" CHECK ("memberships"."member_number" is null or "memberships"."member_number" between 0 and 2147483646);
--> statement-breakpoint
DO $$
DECLARE
  migration_key constant text := '0014_member_zero';
  match_count integer;
  target_user public.users%ROWTYPE;
  previous_membership public.memberships%ROWTYPE;
BEGIN
  -- A later renumbering or revocation must survive replay of this migration.
  IF EXISTS (
    SELECT 1 FROM public.member_audit_logs
    WHERE action = 'member.set-number' AND details->>'migration' = migration_key
  ) THEN RETURN; END IF;

  SELECT count(*) INTO match_count FROM public.users
    WHERE lower(btrim(email)) = 'ignas@teksafari.org';
  IF match_count = 0 THEN RETURN; END IF;
  IF match_count <> 1 THEN
    RAISE EXCEPTION 'Member zero assignment requires exactly one matching account';
  END IF;
  SELECT * INTO STRICT target_user FROM public.users
    WHERE lower(btrim(email)) = 'ignas@teksafari.org' FOR UPDATE;
  IF NOT target_user.email_verified THEN
    RAISE EXCEPTION 'Member zero assignment requires a verified email';
  END IF;
  SELECT * INTO previous_membership FROM public.memberships
    WHERE user_id = target_user.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member zero assignment requires an existing local membership';
  END IF;
  IF previous_membership.status <> 'approved' OR previous_membership.role <> 'admin' THEN
    RAISE EXCEPTION 'Member zero assignment requires the approved administrator';
  END IF;
  IF EXISTS (SELECT 1 FROM public.memberships WHERE member_number = 0 AND id <> previous_membership.id) THEN
    RAISE EXCEPTION 'Member number zero is already assigned';
  END IF;

  -- The existing bridge only advances allocation; no nextval/setval is needed.
  IF previous_membership.member_number IS DISTINCT FROM 0 THEN
    UPDATE public.memberships SET member_number = 0, updated_at = now()
      WHERE id = previous_membership.id;
  END IF;
  INSERT INTO public.member_audit_logs (actor_id, target_id, action, details)
  VALUES ('operator:migration:0014', target_user.tekid_user_id, 'member.set-number', jsonb_build_object(
    'migration', migration_key,
    'before', jsonb_build_object('status', previous_membership.status,
      'role', previous_membership.role, 'memberNumber', previous_membership.member_number),
    'after', jsonb_build_object('status', previous_membership.status,
      'role', previous_membership.role, 'memberNumber', 0)
  ));
END $$;
