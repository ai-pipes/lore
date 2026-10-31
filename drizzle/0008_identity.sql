-- Identity: users, web sessions, personal API tokens, pending SSO logins and CLI device logins.
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "login" text NOT NULL,
  "display_name" text NOT NULL,
  "role" text NOT NULL,
  "disabled" boolean NOT NULL DEFAULT false,
  "password_hash" text,
  "oidc_iss" text,
  "oidc_sub" text,
  "email" text,
  "groups" text[] NOT NULL DEFAULT '{}',
  "last_login_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "users_login_unique" UNIQUE ("login"),
  CONSTRAINT "users_oidc_subject_unique" UNIQUE ("oidc_iss", "oidc_sub"),
  CONSTRAINT "users_role_check" CHECK ("role" IN ('admin', 'member')),
  CONSTRAINT "users_oidc_subject_check" CHECK (("oidc_iss" IS NULL) = ("oidc_sub" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "web_sessions" (
  "id_hash" text PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_web_sessions_user" ON "web_sessions" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "hash" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp,
  "revoked_at" timestamp,
  CONSTRAINT "api_tokens_hash_unique" UNIQUE ("hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_tokens_user" ON "api_tokens" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_pending" (
  "state" text PRIMARY KEY,
  "code_verifier" text NOT NULL,
  "nonce" text NOT NULL,
  "return_to" text NOT NULL,
  "expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cli_logins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_code_hash" text NOT NULL,
  "user_code" text NOT NULL,
  "hostname" text NOT NULL,
  "status" text NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  CONSTRAINT "cli_logins_device_code_hash_unique" UNIQUE ("device_code_hash"),
  CONSTRAINT "cli_logins_user_code_unique" UNIQUE ("user_code"),
  CONSTRAINT "cli_logins_status_check" CHECK ("status" IN ('pending', 'approved', 'denied', 'consumed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cli_logins_user" ON "cli_logins" ("user_id");
