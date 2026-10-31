import { and, asc, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../../../platform/db.js';
import type { KeySecrets, ProjectKeyRepository } from '../application/ports.js';
import type { ProjectKeyRecord } from '../domain/namespace.js';
import { project_keys } from './schema.js';

type Row = typeof project_keys.$inferSelect;

const toRecord = (r: Row): ProjectKeyRecord => ({
  id: r.id,
  namespaceId: r.namespace_id,
  libraryId: r.library_id,
  name: r.name,
  prefix: r.prefix,
  createdBy: r.created_by,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pgProjectKeyRepository: ProjectKeyRepository = {
  async insert(input) {
    const rows = await getDb()
      .insert(project_keys)
      .values({
        namespace_id: input.namespaceId,
        library_id: input.libraryId,
        name: input.name,
        prefix: input.prefix,
        hash: input.hash,
        created_by: input.createdBy,
      })
      .returning();
    return toRecord(rows[0]);
  },
  async list(namespaceId) {
    const rows = await getDb()
      .select()
      .from(project_keys)
      .where(namespaceId === undefined ? undefined : eq(project_keys.namespace_id, namespaceId))
      .orderBy(asc(project_keys.created_at));
    return rows.map(toRecord);
  },
  async findByHash(hash) {
    const rows = await getDb().select().from(project_keys).where(eq(project_keys.hash, hash)).limit(1);
    return rows[0] && toRecord(rows[0]);
  },
  async revoke(id, at) {
    // A malformed id is no key (and must not become a uuid cast error).
    if (!UUID_RE.test(id)) return false;
    const rows = await getDb()
      .update(project_keys)
      .set({ revoked_at: at })
      .where(and(eq(project_keys.id, id), isNull(project_keys.revoked_at)))
      .returning({ id: project_keys.id });
    return rows.length > 0;
  },
  async touch(id, at) {
    await getDb().update(project_keys).set({ last_used_at: at }).where(eq(project_keys.id, id));
  },
};

/** Secrets from `crypto.randomBytes`: `prefix + base64url(32 bytes)`. */
export const nodeKeySecrets: KeySecrets = {
  random: (prefix) => prefix + randomBytes(32).toString('base64url'),
  sha256Hex: (s) => createHash('sha256').update(s).digest('hex'),
};
