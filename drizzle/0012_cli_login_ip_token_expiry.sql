-- CLI device login: the approval page shows the address that started a request, and the tokens a
-- device login mints expire (LORE_CLI_TOKEN_TTL_DAYS). Pending requests live 10 minutes and carry
-- no address, so they are dropped. Existing cli- tokens get the default lifetime from now.
DELETE FROM cli_logins;
--> statement-breakpoint
ALTER TABLE cli_logins ADD COLUMN request_ip text NOT NULL;
--> statement-breakpoint
ALTER TABLE api_tokens ADD COLUMN expires_at timestamp;
--> statement-breakpoint
UPDATE api_tokens SET expires_at = now() + interval '90 days' WHERE name LIKE 'cli-%' AND revoked_at IS NULL;
