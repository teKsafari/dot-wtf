-- A public applicant has no tekID account yet: approval creates it and writes
-- the subject back. Until then users.tekid_user_id is null. The unique index
-- stays, because PostgreSQL does not compare nulls for uniqueness.
ALTER TABLE "users" ALTER COLUMN "tekid_user_id" DROP NOT NULL;