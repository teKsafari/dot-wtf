CREATE TABLE "member_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_number_counter" (
	"id" integer PRIMARY KEY NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "member_number_counter_singleton" CHECK ("member_number_counter"."id" = 1),
	CONSTRAINT "member_number_counter_positive" CHECK ("member_number_counter"."next_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "picture" text;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "categories" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "institution" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "other_category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "whatsapp" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "member_number" integer;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
CREATE INDEX "member_profiles_review_idx" ON "member_profiles" USING btree ("status","submitted_at");--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_member_number_unique" UNIQUE("member_number");--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_status_check" CHECK ("member_profiles"."status" in ('draft', 'pending', 'approved', 'rejected', 'suspended'));--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_role_check" CHECK ("member_profiles"."role" in ('member', 'instance-lead', 'admin'));--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_number_check" CHECK ("member_profiles"."member_number" is null or "member_profiles"."member_number" between 1 and 2147483646);--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_approval_check" CHECK ("member_profiles"."status" <> 'approved' or ("member_profiles"."member_number" is not null and "member_profiles"."approved_at" is not null));
--> statement-breakpoint
INSERT INTO "member_number_counter" ("id", "next_number") VALUES (1, 1);
