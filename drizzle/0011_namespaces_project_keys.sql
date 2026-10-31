-- Namespaces group libraries; project keys (lpk_) push only to libraries of their namespace.
-- `default` holds every existing library; `insights` is the system namespace of published chats.
CREATE TABLE IF NOT EXISTS "namespaces" (
  "id" text PRIMARY KEY,
  "display_name" text NOT NULL,
  "system" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "namespaces" ("id", "display_name", "system") VALUES ('default', 'Default', false), ('insights', 'Insights', true)
  ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "libraries" ADD COLUMN IF NOT EXISTS "namespace_id" text NOT NULL DEFAULT 'default' REFERENCES "namespaces"("id");
--> statement-breakpoint
UPDATE "libraries" SET "namespace_id" = 'insights' WHERE "id" = 'insights';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_libraries_namespace" ON "libraries" ("namespace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "namespace_id" text NOT NULL REFERENCES "namespaces"("id"),
  "library_id" text REFERENCES "libraries"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "hash" text NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp,
  "revoked_at" timestamp,
  CONSTRAINT "project_keys_hash_unique" UNIQUE ("hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_keys_namespace" ON "project_keys" ("namespace_id");
