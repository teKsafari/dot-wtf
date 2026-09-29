-- Apply through the transactional Drizzle migrator. This is an expand/cutover
-- migration: the deployed PR47 app keeps its writable view and counter bridge.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
SELECT pg_advisory_xact_lock(hashtextextended('dot-wtf:membership', 0));
--> statement-breakpoint
LOCK TABLE "member_profiles", "member_number_counter" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
-- The checked-in table has no RLS or column-specific grants. Fail closed if an
-- operator added either: their policy cannot be safely inferred across the split.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.member_profiles'::regclass AND (relrowsecurity OR relforcerowsecurity))
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.member_profiles'::regclass)
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.member_profiles'::regclass AND attacl IS NOT NULL)
  THEN RAISE EXCEPTION 'Member split requires review of existing row policies or column grants'; END IF;
END $$;
--> statement-breakpoint
-- Preserve explicit application-role grants when replacing the original table.
CREATE TEMP TABLE "member_split_legacy_grants" ON COMMIT DROP AS
SELECT acl.grantee, acl.privilege_type, acl.is_grantable
FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
WHERE c.oid = 'public.member_profiles'::regclass;
--> statement-breakpoint
CREATE SEQUENCE "public"."member_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"member_number" integer,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "memberships_member_number_unique" UNIQUE("member_number"),
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" in ('draft', 'pending', 'approved', 'rejected', 'suspended')),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('member', 'instance-lead', 'admin')),
	CONSTRAINT "memberships_number_check" CHECK ("memberships"."member_number" is null or "memberships"."member_number" between 1 and 2147483646),
	CONSTRAINT "memberships_approval_check" CHECK ("memberships"."status" <> 'approved' or ("memberships"."member_number" is not null and "memberships"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"picture" text,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"institution" text DEFAULT '' NOT NULL,
	"other_category" text DEFAULT '' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"wtf_idea" text DEFAULT '' NOT NULL,
	"current_project" text DEFAULT '' NOT NULL,
	"youtube_link" text DEFAULT '' NOT NULL,
	"social_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tekid_user_id" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_tekid_user_id_unique" UNIQUE("tekid_user_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_review_idx" ON "memberships" USING btree ("status","submitted_at");
--> statement-breakpoint
INSERT INTO "users" ("tekid_user_id", "email", "email_verified", "created_at", "updated_at")
SELECT "tekid_user_id", "email", "email_verified", "created_at", "updated_at" FROM "member_profiles";
--> statement-breakpoint
INSERT INTO "profiles" ("user_id", "name", "picture", "categories", "institution", "other_category", "whatsapp", "bio", "wtf_idea", "current_project", "youtube_link", "social_links", "created_at", "updated_at")
SELECT u."id", p."name", p."picture", p."categories", p."institution", p."other_category", p."whatsapp", p."bio", p."wtf_idea", p."current_project", p."youtube_link", p."social_links", p."created_at", p."updated_at"
FROM "member_profiles" p JOIN "users" u ON u."tekid_user_id" = p."tekid_user_id";
--> statement-breakpoint
INSERT INTO "memberships" ("user_id", "status", "role", "member_number", "submitted_at", "approved_at", "reviewed_at", "reviewed_by", "created_at", "updated_at")
SELECT u."id", p."status", p."role", p."member_number", p."submitted_at", p."approved_at", p."reviewed_at", p."reviewed_by", p."created_at", p."updated_at"
FROM "member_profiles" p JOIN "users" u ON u."tekid_user_id" = p."tekid_user_id";
--> statement-breakpoint
-- Counter history can exceed MAX(member_number) after custom renumbering.
-- setval(..., false) means the NEXT allocation returns this exact high-water value.
SELECT setval('public.member_number_seq', GREATEST(
  COALESCE((SELECT "next_number"::bigint FROM "member_number_counter" WHERE "id" = 1), 1),
  COALESCE((SELECT MAX("member_number")::bigint + 1 FROM "memberships"), 1)
), false);
--> statement-breakpoint
-- Use an identically shaped temporary view to compare EVERY original field,
-- including drafts, nullable review metadata, timestamps, and JSON answers.
CREATE VIEW "member_profiles_split_check" AS SELECT
  u."tekid_user_id", p."name", u."email", u."email_verified", p."picture",
  p."categories", p."institution", p."other_category", p."whatsapp", p."bio",
  p."wtf_idea", p."current_project", p."youtube_link", p."social_links",
  m."status", m."role", m."member_number", m."submitted_at", m."approved_at",
  m."reviewed_at", m."reviewed_by", u."created_at",
  GREATEST(u."updated_at", p."updated_at", m."updated_at") AS "updated_at"
FROM "users" u JOIN "profiles" p ON p."user_id" = u."id"
JOIN "memberships" m ON m."user_id" = u."id";
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    (SELECT to_jsonb(old_row) FROM "member_profiles" old_row
     EXCEPT SELECT to_jsonb(new_row) FROM "member_profiles_split_check" new_row)
    UNION ALL
    (SELECT to_jsonb(new_row) FROM "member_profiles_split_check" new_row
     EXCEPT SELECT to_jsonb(old_row) FROM "member_profiles" old_row)
  ) THEN RAISE EXCEPTION 'Member split backfill did not preserve every original value'; END IF;
  IF (SELECT count(*) FROM "users") <> (SELECT count(*) FROM "member_profiles")
    OR (SELECT count(*) FROM "profiles") <> (SELECT count(*) FROM "member_profiles")
    OR (SELECT count(*) FROM "memberships") <> (SELECT count(*) FROM "member_profiles")
  THEN RAISE EXCEPTION 'Member split backfill changed row counts'; END IF;
END $$;
--> statement-breakpoint
-- No CASCADE: unexpected foreign dependencies must fail the migration safely.
DROP TABLE "member_profiles";
--> statement-breakpoint
ALTER VIEW "member_profiles_split_check" RENAME TO "member_profiles";
--> statement-breakpoint
-- Defaults are needed because old Drizzle INSERTs omit optional/default columns.
ALTER VIEW "member_profiles" ALTER COLUMN "name" SET DEFAULT '';
ALTER VIEW "member_profiles" ALTER COLUMN "email" SET DEFAULT '';
ALTER VIEW "member_profiles" ALTER COLUMN "email_verified" SET DEFAULT false;
ALTER VIEW "member_profiles" ALTER COLUMN "categories" SET DEFAULT '[]'::jsonb;
ALTER VIEW "member_profiles" ALTER COLUMN "institution" SET DEFAULT '';
ALTER VIEW "member_profiles" ALTER COLUMN "other_category" SET DEFAULT '';
ALTER VIEW "member_profiles" ALTER COLUMN "whatsapp" SET DEFAULT '';
ALTER VIEW "member_profiles" ALTER COLUMN "bio" SET DEFAULT '';
ALTER VIEW "member_profiles" ALTER COLUMN "wtf_idea" SET DEFAULT '';
ALTER VIEW "member_profiles" ALTER COLUMN "current_project" SET DEFAULT '';
ALTER VIEW "member_profiles" ALTER COLUMN "youtube_link" SET DEFAULT '';
ALTER VIEW "member_profiles" ALTER COLUMN "social_links" SET DEFAULT '{}'::jsonb;
ALTER VIEW "member_profiles" ALTER COLUMN "status" SET DEFAULT 'draft';
ALTER VIEW "member_profiles" ALTER COLUMN "role" SET DEFAULT 'member';
ALTER VIEW "member_profiles" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER VIEW "member_profiles" ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint
CREATE FUNCTION "write_legacy_member_profile"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE local_user_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dot-wtf:membership', 0));
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.users (tekid_user_id, email, email_verified, created_at, updated_at)
      VALUES (NEW.tekid_user_id, NEW.email, NEW.email_verified, NEW.created_at, NEW.updated_at)
      RETURNING id INTO local_user_id;
    INSERT INTO public.profiles (user_id, name, picture, categories, institution, other_category,
      whatsapp, bio, wtf_idea, current_project, youtube_link, social_links, created_at, updated_at)
      VALUES (local_user_id, NEW.name, NEW.picture, NEW.categories, NEW.institution, NEW.other_category,
        NEW.whatsapp, NEW.bio, NEW.wtf_idea, NEW.current_project, NEW.youtube_link, NEW.social_links, NEW.created_at, NEW.updated_at);
    INSERT INTO public.memberships (user_id, status, role, member_number, submitted_at, approved_at,
      reviewed_at, reviewed_by, created_at, updated_at)
      VALUES (local_user_id, NEW.status, NEW.role, NEW.member_number, NEW.submitted_at, NEW.approved_at,
        NEW.reviewed_at, NEW.reviewed_by, NEW.created_at, NEW.updated_at);
    RETURN NEW;
  END IF;
  SELECT id INTO STRICT local_user_id FROM public.users WHERE tekid_user_id = OLD.tekid_user_id;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.users WHERE id = local_user_id;
    RETURN OLD;
  END IF;
  UPDATE public.users SET tekid_user_id = NEW.tekid_user_id, email = NEW.email,
    email_verified = NEW.email_verified, created_at = NEW.created_at, updated_at = NEW.updated_at
    WHERE id = local_user_id;
  UPDATE public.profiles SET name = NEW.name, picture = NEW.picture, categories = NEW.categories,
    institution = NEW.institution, other_category = NEW.other_category, whatsapp = NEW.whatsapp,
    bio = NEW.bio, wtf_idea = NEW.wtf_idea, current_project = NEW.current_project,
    youtube_link = NEW.youtube_link, social_links = NEW.social_links,
    created_at = NEW.created_at, updated_at = NEW.updated_at WHERE user_id = local_user_id;
  UPDATE public.memberships SET status = NEW.status, role = NEW.role, member_number = NEW.member_number,
    submitted_at = NEW.submitted_at, approved_at = NEW.approved_at, reviewed_at = NEW.reviewed_at,
    reviewed_by = NEW.reviewed_by, created_at = NEW.created_at, updated_at = NEW.updated_at
    WHERE user_id = local_user_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "member_profiles_compat_write" INSTEAD OF INSERT OR UPDATE OR DELETE
ON "member_profiles" FOR EACH ROW EXECUTE FUNCTION "write_legacy_member_profile"();
--> statement-breakpoint
-- Advances only; no reads/drafts allocate, and no function recurses into its caller.
-- Sequence values are nontransactional, so failed approvals may leave harmless gaps.
CREATE FUNCTION "advance_member_number_high_water"(requested_next bigint) RETURNS bigint
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE sequence_next bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dot-wtf:membership', 0));
  IF requested_next < 1 OR requested_next > 2147483647 THEN
    RAISE EXCEPTION 'Invalid member-number high water' USING ERRCODE = '22003';
  END IF;
  SELECT LEAST(last_value + CASE WHEN is_called THEN 1 ELSE 0 END, 2147483647)
    INTO sequence_next FROM public.member_number_seq;
  IF requested_next > sequence_next THEN
    PERFORM setval('public.member_number_seq', requested_next, false);
    RETURN requested_next;
  END IF;
  RETURN sequence_next;
END $$;
--> statement-breakpoint
CREATE FUNCTION "bridge_legacy_member_counter"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.next_number := public.advance_member_number_high_water(NEW.next_number::bigint)::integer;
  IF TG_OP = 'INSERT' THEN
    -- Old allocators begin with INSERT ... ON CONFLICT DO NOTHING. Refresh the
    -- existing compatibility row before their SELECT, including values consumed
    -- by a rolled-back nextval in the new app. UPDATE takes the other branch of
    -- this trigger, so the bridge has a bounded depth and cannot recurse forever.
    UPDATE public.member_number_counter SET next_number = NEW.next_number
      WHERE id = NEW.id AND next_number < NEW.next_number;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "member_number_counter_sequence_bridge" BEFORE INSERT OR UPDATE
ON "member_number_counter" FOR EACH ROW EXECUTE FUNCTION "bridge_legacy_member_counter"();
--> statement-breakpoint
CREATE FUNCTION "bridge_numbered_membership"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE next_number_value bigint;
BEGIN
  IF NEW.member_number IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.member_number IS DISTINCT FROM OLD.member_number) THEN
    next_number_value := public.advance_member_number_high_water(NEW.member_number::bigint + 1);
    UPDATE public.member_number_counter SET next_number = GREATEST(next_number, next_number_value::integer) WHERE id = 1;
    IF NOT FOUND THEN
      INSERT INTO public.member_number_counter (id, next_number) VALUES (1, next_number_value::integer);
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "memberships_legacy_counter_bridge" BEFORE INSERT OR UPDATE OF member_number
ON "memberships" FOR EACH ROW EXECUTE FUNCTION "bridge_numbered_membership"();
--> statement-breakpoint
-- Bring the compatibility row up to the backfilled sequence's initial high water.
INSERT INTO "member_number_counter" ("id", "next_number")
VALUES (1, (SELECT last_value::integer FROM "member_number_seq"))
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE grant_row record; grantee_name text; grant_option text; target_name text;
BEGIN
  FOR grant_row IN SELECT * FROM "member_split_legacy_grants" LOOP
    grantee_name := CASE WHEN grant_row.grantee = 0 THEN 'PUBLIC'
      ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END;
    grant_option := CASE WHEN grant_row.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END;
    FOREACH target_name IN ARRAY ARRAY['users', 'profiles', 'memberships'] LOOP
      EXECUTE format('GRANT %s ON TABLE public.%I TO %s%s',
        grant_row.privilege_type, target_name, grantee_name, grant_option);
    END LOOP;
    IF grant_row.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') THEN
      EXECUTE format('GRANT %s ON TABLE public.member_profiles TO %s%s',
        grant_row.privilege_type, grantee_name, grant_option);
    END IF;
    IF grant_row.privilege_type IN ('INSERT', 'UPDATE') THEN
      EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.member_number_seq TO %s%s',
        grantee_name, grant_option);
    END IF;
  END LOOP;
END $$;
