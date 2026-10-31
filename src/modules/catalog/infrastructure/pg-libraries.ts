import { and, eq, desc, ne, sql } from 'drizzle-orm';
import { asciiLower } from './ascii-fold.js';
import { DEFAULT_NAMESPACE } from '../domain/namespace.js';
import { getDb } from '../../../platform/db.js';
import { isValidLibraryId, type Library, type LibraryWithStats } from '../domain/library.js';
import type { LibraryRepository } from '../application/ports.js';
import { libraries, versions, documents } from './schema.js';
import { isoTimestamp, withIso } from './timestamps.js';

export type { Library, LibraryWithStats };

/** Defence in depth: library ids name directories in the image store, so no write takes an invalid one. */
function assertValidLibraryId(id: string): void {
  if (!isValidLibraryId(id)) throw new Error(`invalid library id "${id}"`);
}

/** Creates the library in `namespace_id` (default `default`) or renames it; an existing library keeps its namespace. */
export async function upsertLibrary(id: string, display_name: string, namespace_id: string = DEFAULT_NAMESPACE): Promise<Library> {
  assertValidLibraryId(id);
  const db = getDb();
  await db
    .insert(libraries)
    .values({ id, display_name, namespace_id })
    .onConflictDoUpdate({ target: libraries.id, set: { display_name } });
  return db.select().from(libraries).where(eq(libraries.id, id)).limit(1).then((r) => withIso(r[0]!, 'created_at'));
}

/** See LibraryRepository.upsertInNamespace: the conflict update only applies inside `namespace_id`. */
export async function upsertLibraryInNamespace(
  id: string,
  display_name: string,
  namespace_id: string,
): Promise<{ library: Library; created: boolean } | null> {
  assertValidLibraryId(id);
  const rows = await getDb()
    .insert(libraries)
    .values({ id, display_name, namespace_id })
    .onConflictDoUpdate({
      target: libraries.id,
      set: { display_name },
      setWhere: sql`${libraries.namespace_id} = ${namespace_id}`,
    })
    // xmax = 0 only on a freshly inserted row
    .returning({ id: libraries.id, display_name: libraries.display_name, namespace_id: libraries.namespace_id, created_at: libraries.created_at, created: sql<boolean>`(xmax = 0)` });
  const row = rows[0];
  if (!row) return null;
  const { created, ...library } = row;
  return { library: withIso(library, 'created_at'), created };
}

export async function setLibraryNamespace(id: string, namespace_id: string): Promise<boolean> {
  const rows = await getDb().update(libraries).set({ namespace_id }).where(eq(libraries.id, id)).returning({ id: libraries.id });
  return rows.length > 0;
}

export async function getLibrary(id: string): Promise<Library | undefined> {
  const row = await getDb()
    .select({
      id: libraries.id,
      display_name: libraries.display_name,
      namespace_id: libraries.namespace_id,
      created_at: libraries.created_at,
    })
    .from(libraries)
    .where(eq(libraries.id, id))
    .limit(1)
    .then((r) => r[0]);
  return row && withIso(row, 'created_at');
}

/** All libraries, or only those of `namespaceId`, newest first. */
export async function listLibraries(namespaceId?: string): Promise<LibraryWithStats[]> {
  const rows = await getDb()
    .select({
      id: libraries.id,
      display_name: libraries.display_name,
      namespace_id: libraries.namespace_id,
      created_at: libraries.created_at,
      current_version: versions.id,
      document_count: sql<number>`cast(count(${documents.id}) as int)`,
    })
    .from(libraries)
    .leftJoin(versions, sql`${versions.library_id} = ${libraries.id} AND ${versions.is_current} = true`)
    .leftJoin(documents, sql`${documents.library_id} = ${libraries.id} AND ${documents.version_id} = ${versions.id}`)
    .where(namespaceId === undefined ? undefined : eq(libraries.namespace_id, namespaceId))
    .groupBy(libraries.id, libraries.display_name, libraries.namespace_id, libraries.created_at, versions.id)
    .orderBy(desc(libraries.created_at));

  return rows.map((r) => ({
    id: r.id,
    display_name: r.display_name,
    namespace_id: r.namespace_id,
    created_at: isoTimestamp(r.created_at),
    current_version: r.current_version ?? null,
    document_count: r.document_count ?? 0,
  }));
}

/** See LibraryRepository.caseVariantOf. */
export async function findLibraryCaseVariant(id: string): Promise<string | undefined> {
  const rows = await getDb()
    .select({ id: libraries.id })
    .from(libraries)
    .where(and(eq(asciiLower(libraries.id), asciiLower(id)), ne(libraries.id, id)))
    .limit(1);
  return rows[0]?.id;
}

export const pgLibraryRepository: LibraryRepository = {
  upsert: upsertLibrary,
  upsertInNamespace: upsertLibraryInNamespace,
  get: getLibrary,
  caseVariantOf: findLibraryCaseVariant,
  list: (namespaceId) => listLibraries(namespaceId),
  setNamespace: setLibraryNamespace,
};
