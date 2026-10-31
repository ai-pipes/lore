import { eq } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { SessionRepository } from '../application/ports.js';
import { web_sessions } from './schema.js';

/** Web sessions in Postgres, keyed by the SHA-256 hex of the session id (the id itself is never stored). */
export const pgSessionRepository: SessionRepository = {
  async insert(r) {
    await getDb().insert(web_sessions).values({
      id_hash: r.idHash,
      user_id: r.userId,
      expires_at: r.expiresAt,
      sign_in_method: r.method,
      absolute_expires_at: r.deadline,
    });
  },

  async find(idHash) {
    const rows = await getDb()
      .select({ userId: web_sessions.user_id, expiresAt: web_sessions.expires_at, deadline: web_sessions.absolute_expires_at })
      .from(web_sessions)
      .where(eq(web_sessions.id_hash, idHash))
      .limit(1);
    return rows[0] ?? null;
  },

  async extend(idHash, expiresAt, seenAt) {
    await getDb()
      .update(web_sessions)
      .set({ expires_at: expiresAt, last_seen_at: seenAt })
      .where(eq(web_sessions.id_hash, idHash));
  },

  async delete(idHash) {
    await getDb().delete(web_sessions).where(eq(web_sessions.id_hash, idHash));
  },

  async deleteByUser(userId) {
    await getDb().delete(web_sessions).where(eq(web_sessions.user_id, userId));
  },
};
