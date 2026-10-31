import { asc, eq } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { NamespaceRepository } from '../application/ports.js';
import type { Namespace } from '../domain/namespace.js';
import { namespaces } from './schema.js';
import { withIso } from './timestamps.js';

export const pgNamespaceRepository: NamespaceRepository = {
  async insert({ id, displayName }): Promise<Namespace | null> {
    const rows = await getDb()
      .insert(namespaces)
      .values({ id, display_name: displayName })
      .onConflictDoNothing({ target: namespaces.id })
      .returning();
    return rows[0] ? withIso(rows[0], 'created_at') : null;
  },
  async get(id) {
    const rows = await getDb().select().from(namespaces).where(eq(namespaces.id, id)).limit(1);
    return rows[0] && withIso(rows[0], 'created_at');
  },
  async rename(id, displayName) {
    const rows = await getDb().update(namespaces).set({ display_name: displayName }).where(eq(namespaces.id, id)).returning();
    return rows[0] && withIso(rows[0], 'created_at');
  },
  async list() {
    const rows = await getDb().select().from(namespaces).orderBy(asc(namespaces.id));
    return rows.map((r) => withIso(r, 'created_at'));
  },
};
