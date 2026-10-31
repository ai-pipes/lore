-- Chat sessions table
CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL DEFAULT 'New chat',
  "pinned_docs" jsonb DEFAULT '[]'::jsonb,
  "scope_filters" jsonb DEFAULT '[]'::jsonb,
  "is_published" boolean NOT NULL DEFAULT false,
  "published_doc_id" text REFERENCES "documents"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_chat_sessions_updated" ON "chat_sessions" ("updated_at");

-- Chat messages table
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" serial PRIMARY KEY,
  "session_id" uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_chat_messages_session" ON "chat_messages" ("session_id", "created_at");
