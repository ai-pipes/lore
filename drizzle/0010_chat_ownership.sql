-- Per-user chat history: every chat session belongs to one user. Legacy chats had no owner and
-- are dropped (owner decision: old data does not matter). Insight documents record their author;
-- the name is kept when the user is deleted.
DELETE FROM chat_messages;
--> statement-breakpoint
DELETE FROM chat_sessions;
--> statement-breakpoint
ALTER TABLE chat_sessions ADD COLUMN user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_chat_sessions_user_updated ON chat_sessions(user_id, updated_at);
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN author_user_id uuid REFERENCES users(id) ON DELETE SET NULL, ADD COLUMN author_name text;
