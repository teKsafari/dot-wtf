-- One-time, explicitly requested bootstrap for an existing verified account.
-- Empty/new databases have no matching identity and must remain empty.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
SELECT pg_advisory_xact_lock(hashtextextended('dot-wtf:membership', 0));
--> statement-breakpoint
DO $$
DECLARE
  migration_key constant text := '0013_approve_ignas_admin';
  actor constant text := 'operator:migration:0013';
  match_count integer;
  target_user public.users%ROWTYPE;
  previous_membership public.memberships%ROWTYPE;
  assigned_number integer;
  sequence_next bigint;
  next_number bigint;
BEGIN
  -- Keep the successful grant durable even if a later operator revokes it or
  -- deletes the account. Replaying this SQL must never restore revoked access.
  IF EXISTS (
    SELECT 1 FROM public.member_audit_logs
    WHERE action = 'member.bootstrap' AND details->>'migration' = migration_key
  ) THEN RETURN; END IF;

  SELECT count(*) INTO match_count FROM public.users
    WHERE lower(btrim(email)) = 'ignas@teksafari.org';
  IF match_count = 0 THEN RETURN; END IF;
  IF match_count <> 1 THEN
    RAISE EXCEPTION 'Admin bootstrap requires exactly one matching account';
  END IF;

  SELECT * INTO STRICT target_user FROM public.users
    WHERE lower(btrim(email)) = 'ignas@teksafari.org' FOR UPDATE;
  IF NOT target_user.email_verified THEN
    RAISE EXCEPTION 'Admin bootstrap requires a verified email';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = target_user.id) THEN
    RAISE EXCEPTION 'Admin bootstrap requires an existing local profile';
  END IF;
  SELECT * INTO previous_membership FROM public.memberships
    WHERE user_id = target_user.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin bootstrap requires an existing local membership';
  END IF;
  IF previous_membership.status IN ('rejected', 'suspended') THEN
    RAISE EXCEPTION 'Admin bootstrap cannot override a rejected or suspended membership';
  END IF;

  assigned_number := previous_membership.member_number;
  IF assigned_number IS NULL THEN
    SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END
      INTO sequence_next FROM public.member_number_seq;
    SELECT greatest(sequence_next, coalesce(max(member_number)::bigint + 1, 1))
      INTO next_number FROM public.memberships;
    IF next_number > 2147483646 THEN
      RAISE EXCEPTION 'Automatic member numbers are exhausted';
    END IF;
    IF next_number > sequence_next THEN
      PERFORM setval('public.member_number_seq', next_number, false);
    END IF;
    assigned_number := nextval('public.member_number_seq')::integer;
  END IF;

  IF previous_membership.status <> 'approved' OR previous_membership.role <> 'admin' THEN
    UPDATE public.memberships SET
      status = 'approved', role = 'admin', member_number = assigned_number,
      approved_at = coalesce(approved_at, now()), reviewed_at = now(),
      reviewed_by = actor, updated_at = now()
    WHERE id = previous_membership.id;
  END IF;

  INSERT INTO public.member_audit_logs (actor_id, target_id, action, details)
  VALUES (actor, target_user.tekid_user_id, 'member.bootstrap', jsonb_build_object(
    'migration', migration_key,
    'before', jsonb_build_object('status', previous_membership.status,
      'role', previous_membership.role, 'memberNumber', previous_membership.member_number),
    'after', jsonb_build_object('status', 'approved', 'role', 'admin', 'memberNumber', assigned_number)
  ));
END $$;
