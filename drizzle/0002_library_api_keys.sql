ALTER TABLE "libraries" ADD COLUMN IF NOT EXISTS "api_key_hash" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_libraries_api_key_hash" ON "libraries" USING btree("api_key_hash");
