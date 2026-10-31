/** Drizzle tables of the chat module: sessions and their messages. */
import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, timestamp, serial, index, jsonb, uuid } from 'drizzle-orm/pg-core';

/* ── Chat History ────────────────────────────────────────── */

export const chat_sessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // The owner. FK to users(id) ON DELETE CASCADE (identity) exists in the SQL migrations only.
    user_id: uuid('user_id').notNull(),
    title: text('title').notNull().default('New chat'),
    pinned_docs: jsonb('pinned_docs').default([]),
    scope_filters: jsonb('scope_filters').default([]),
    is_published: boolean('is_published').notNull().default(false),
    // FK to documents(id) ON DELETE SET NULL (catalog) exists in the SQL migrations only.
    published_doc_id: text('published_doc_id'),
    created_at: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_chat_sessions_updated').on(t.updated_at),
    index('idx_chat_sessions_user_updated').on(t.user_id, t.updated_at),
  ],
);

export const chat_messages = pgTable(
  'chat_messages',
  {
    id: serial('id').primaryKey(),
    session_id: uuid('session_id')
      .notNull()
      .references(() => chat_sessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant' | 'search'
    content: text('content').notNull(),
    metadata: jsonb('metadata'), // search results, tool calls, etc.
    created_at: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_chat_messages_session').on(t.session_id, t.created_at),
  ],
);
