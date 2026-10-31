-- Every timestamp becomes timestamptz, so a stored value is an instant whatever the server's time
-- zone. Before, `now()` wrote the wall-clock time of the server's TimeZone into `timestamp`
-- columns, and readers had no way to tell which zone it was in.
--
-- Columns written only by `now()` (Drizzle mode 'string') keep their meaning with the plain cast,
-- which reads them in the server's TimeZone, the one `now()` wrote them in.
ALTER TABLE namespaces ALTER COLUMN created_at TYPE timestamptz;
--> statement-breakpoint
ALTER TABLE libraries ALTER COLUMN created_at TYPE timestamptz;
--> statement-breakpoint
ALTER TABLE versions ALTER COLUMN pushed_at TYPE timestamptz;
--> statement-breakpoint
ALTER TABLE document_links ALTER COLUMN created_at TYPE timestamptz;
--> statement-breakpoint
ALTER TABLE document_images ALTER COLUMN created_at TYPE timestamptz;
--> statement-breakpoint
ALTER TABLE chat_sessions ALTER COLUMN created_at TYPE timestamptz, ALTER COLUMN updated_at TYPE timestamptz;
--> statement-breakpoint
ALTER TABLE chat_messages ALTER COLUMN created_at TYPE timestamptz;
--> statement-breakpoint
-- Columns Drizzle maps to Date (mode 'date') were written and read as UTC by the application, so
-- they are read as UTC here: expiry and revocation instants stay exactly where they were.
ALTER TABLE users
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_login_at TYPE timestamptz USING last_login_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE web_sessions
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_seen_at TYPE timestamptz USING last_seen_at AT TIME ZONE 'UTC',
  ALTER COLUMN absolute_expires_at TYPE timestamptz USING absolute_expires_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE api_tokens
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_used_at TYPE timestamptz USING last_used_at AT TIME ZONE 'UTC',
  ALTER COLUMN revoked_at TYPE timestamptz USING revoked_at AT TIME ZONE 'UTC',
  ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE oidc_pending ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE cli_logins
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE project_keys
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_used_at TYPE timestamptz USING last_used_at AT TIME ZONE 'UTC',
  ALTER COLUMN revoked_at TYPE timestamptz USING revoked_at AT TIME ZONE 'UTC';
