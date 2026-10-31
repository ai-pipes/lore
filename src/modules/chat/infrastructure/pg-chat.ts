import { and, eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { ChatRepository } from '../application/ports.js';
import type { ChatMessage, ChatSession, ChatSessionListItem } from '../domain/session.js';
import { chat_sessions, chat_messages } from './schema.js';

/** The owner's session `id`: every statement below filters by `user_id`. */
const owned = (ownerId: string, id: string) => and(eq(chat_sessions.id, id), eq(chat_sessions.user_id, ownerId));

/** Postgres prints timestamptz as `2026-10-31 09:53:31.418641+00`; browsers get ISO-8601 UTC. */
const iso = (timestamp: string) => new Date(timestamp).toISOString();

const sessionOut = (row: ChatSession): ChatSession => ({ ...row, created_at: iso(row.created_at), updated_at: iso(row.updated_at) });
const sessionOrNull = (row: ChatSession | undefined): ChatSession | null => (row ? sessionOut(row) : null);
const messageOut = (row: ChatMessage): ChatMessage => ({ ...row, created_at: iso(row.created_at) });

/** Chat sessions and messages in Postgres, scoped to their owner. */
export const pgChatRepository: ChatRepository = {
  async create(ownerId, o) {
    const rows = await getDb()
      .insert(chat_sessions)
      .values({
        user_id: ownerId,
        title: o.title ?? 'New chat',
        pinned_docs: o.pinned_docs ?? [],
        scope_filters: o.scope_filters ?? [],
      })
      .returning();
    return sessionOut(rows[0] as ChatSession);
  },

  async list(ownerId, limit) {
    const rows = await getDb()
      .select({
        id: chat_sessions.id,
        title: chat_sessions.title,
        is_published: chat_sessions.is_published,
        updated_at: chat_sessions.updated_at,
        message_count: sql<number>`(SELECT count(*) FROM chat_messages cm WHERE cm.session_id = chat_sessions.id)`.as('message_count'),
      })
      .from(chat_sessions)
      .where(eq(chat_sessions.user_id, ownerId))
      .orderBy(desc(chat_sessions.updated_at))
      .limit(limit);
    return (rows as ChatSessionListItem[]).map((row) => ({ ...row, updated_at: iso(row.updated_at) }));
  },

  async get(ownerId, id) {
    const rows = await getDb().select().from(chat_sessions).where(owned(ownerId, id)).limit(1);
    return sessionOrNull(rows[0] as ChatSession | undefined);
  },

  async update(ownerId, id, data) {
    const rows = await getDb()
      .update(chat_sessions)
      .set({ ...data, updated_at: sql`now()` })
      .where(owned(ownerId, id))
      .returning();
    return sessionOrNull(rows[0] as ChatSession | undefined);
  },

  async delete(ownerId, id) {
    const result = await getDb().delete(chat_sessions).where(owned(ownerId, id)).returning({ id: chat_sessions.id });
    return result.length > 0;
  },

  async addMessage(ownerId, sessionId, role, content, metadata) {
    return getDb().transaction(async (tx) => {
      // Touching the session first both checks ownership and locks the row against a concurrent delete.
      const touched = await tx
        .update(chat_sessions)
        .set({ updated_at: sql`now()` })
        .where(owned(ownerId, sessionId))
        .returning({ id: chat_sessions.id });
      if (touched.length === 0) return null;
      const rows = await tx
        .insert(chat_messages)
        .values({ session_id: sessionId, role, content, metadata: metadata ?? null })
        .returning();
      return messageOut(rows[0] as ChatMessage);
    });
  },

  async messages(ownerId, sessionId) {
    const db = getDb();
    const session = await db.select({ id: chat_sessions.id }).from(chat_sessions).where(owned(ownerId, sessionId)).limit(1);
    if (session.length === 0) return null;
    const rows = await db
      .select({ message: chat_messages })
      .from(chat_messages)
      .innerJoin(chat_sessions, eq(chat_sessions.id, chat_messages.session_id))
      .where(and(eq(chat_messages.session_id, sessionId), eq(chat_sessions.user_id, ownerId)))
      .orderBy(chat_messages.created_at, chat_messages.id);
    return rows.map((r) => messageOut(r.message as ChatMessage));
  },

  async setTitle(ownerId, id, title) {
    await getDb().update(chat_sessions).set({ title, updated_at: sql`now()` }).where(owned(ownerId, id));
  },
};
