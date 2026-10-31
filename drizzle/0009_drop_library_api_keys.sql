-- Per-library push keys are gone: pushes are authorized by the route policy (admins, and
-- project keys from migration 0011 on). Old keys stop working.
DROP INDEX IF EXISTS idx_libraries_api_key_hash;
--> statement-breakpoint
ALTER TABLE libraries DROP COLUMN IF EXISTS api_key_hash;
