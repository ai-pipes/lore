import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { ApiTokenRecord, TokenRepository } from '../application/ports.js';
import { api_tokens } from './schema.js';

const record = {
  id: api_tokens.id,
  userId: api_tokens.user_id,
  name: api_tokens.name,
  prefix: api_tokens.prefix,
  createdAt: api_tokens.created_at,
  lastUsedAt: api_tokens.last_used_at,
  revokedAt: api_tokens.revoked_at,
  expiresAt: api_tokens.expires_at,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Personal `sk_` tokens in Postgres, keyed by the SHA-256 hex of the token. The hash is never returned. */
export const pgTokenRepository: TokenRepository = {
  async insert(t) {
    const rows = await getDb()
      .insert(api_tokens)
      .values({ user_id: t.userId, name: t.name, prefix: t.prefix, hash: t.hash, expires_at: t.expiresAt ?? null })
      .returning(record);
    return rows[0] as ApiTokenRecord;
  },

  async findByHash(hash) {
    const rows = await getDb().select(record).from(api_tokens).where(eq(api_tokens.hash, hash)).limit(1);
    return rows[0] ?? null;
  },

  async listByUser(userId) {
    return getDb()
      .select(record)
      .from(api_tokens)
      .where(eq(api_tokens.user_id, userId))
      .orderBy(asc(api_tokens.created_at), asc(api_tokens.name));
  },

  async revoke(userId, id, at) {
    // Ids come from URLs: anything that is not a UUID is simply unknown (not a Postgres cast error)
    if (!UUID_RE.test(id)) return false;
    const rows = await getDb()
      .update(api_tokens)
      .set({ revoked_at: at })
      .where(and(eq(api_tokens.id, id), eq(api_tokens.user_id, userId), isNull(api_tokens.revoked_at)))
      .returning({ id: api_tokens.id });
    return rows.length > 0;
  },

  async revokeAllByUser(userId, at) {
    await getDb()
      .update(api_tokens)
      .set({ revoked_at: at })
      .where(and(eq(api_tokens.user_id, userId), isNull(api_tokens.revoked_at)));
  },

  async touch(id, at) {
    await getDb().update(api_tokens).set({ last_used_at: at }).where(eq(api_tokens.id, id));
  },
};
