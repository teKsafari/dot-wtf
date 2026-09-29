-- The deployed application now uses only users/profiles/memberships and the
-- sequence. Run with the transactional migrator; the pre-split app cannot use
-- this schema after cleanup. No original member or audit rows are changed.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
SELECT pg_advisory_xact_lock(hashtextextended('dot-wtf:membership', 0));
--> statement-breakpoint
LOCK TABLE public.member_number_counter, public.memberships IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE
  sequence_next bigint;
  retained_next bigint;
BEGIN
  -- Keep the counter's historical high water even if its highest number was
  -- subsequently changed/deleted. An exhausted sequence may already be one
  -- past its sentinel; preserve that state instead of resetting it.
  SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END
    INTO sequence_next FROM public.member_number_seq;
  SELECT GREATEST(sequence_next,
    COALESCE((SELECT MAX(next_number)::bigint FROM public.member_number_counter), 1),
    COALESCE((SELECT MAX(member_number)::bigint + 1 FROM public.memberships), 1))
    INTO retained_next;

  DROP TRIGGER member_profiles_compat_write ON public.member_profiles;
  DROP TRIGGER member_number_counter_sequence_bridge ON public.member_number_counter;
  DROP TRIGGER memberships_legacy_counter_bridge ON public.memberships;
  DROP VIEW public.member_profiles;
  DROP TABLE public.member_number_counter;
  DROP FUNCTION public.write_legacy_member_profile();
  DROP FUNCTION public.bridge_legacy_member_counter();
  DROP FUNCTION public.bridge_numbered_membership();
  DROP FUNCTION public.advance_member_number_high_water(bigint);

  -- No CASCADE above: an unexpected dependency aborts before touching the
  -- nontransactional sequence. Its next value changes only when provably behind.
  IF retained_next > sequence_next THEN
    PERFORM setval('public.member_number_seq', retained_next, false);
  END IF;
END $$;
