CREATE TABLE "member_profiles" (
	"tekid_user_id" text PRIMARY KEY NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"wtf_idea" text DEFAULT '' NOT NULL,
	"current_project" text DEFAULT '' NOT NULL,
	"youtube_link" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
