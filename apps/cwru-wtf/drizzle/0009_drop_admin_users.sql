-- Admin access moved to tekID organization roles; nothing reads this table.
-- No CASCADE: fail rather than drop anything that unexpectedly depends on it.
DROP TABLE IF EXISTS "admin_users";
