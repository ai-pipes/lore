-- Web sessions remember how the person signed in and, for single sign-on, an absolute deadline
-- (LORE_SSO_SESSION_MAX_HOURS, default 24 h) on top of the 7-day sliding expiry. Existing sessions
-- are password sessions (single sign-on sessions made before this change get a deadline of 24 hours
-- after their creation, so they cannot outlive the new rule).
ALTER TABLE web_sessions ADD COLUMN sign_in_method text NOT NULL DEFAULT 'password';
--> statement-breakpoint
ALTER TABLE web_sessions ADD COLUMN absolute_expires_at timestamp;
--> statement-breakpoint
UPDATE web_sessions SET sign_in_method = 'sso', absolute_expires_at = created_at + interval '24 hours'
  WHERE user_id IN (SELECT id FROM users WHERE oidc_sub IS NOT NULL);
