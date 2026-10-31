import { and, eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { Version } from '../domain/version.js';
import type { VersionRepository } from '../application/ports.js';
import { versions, documents, document_images } from './schema.js';
import { withIso } from './timestamps.js';

export type { Version };

/**
 * Inserts a version, or returns the existing one. Given another branch, an existing version moves
 * there with a fresh `pushed_at`, so it is that branch's head; without a branch it keeps its own.
 */
export async function createVersion(id: string, library_id: string, branch?: string): Promise<Version> {
  const db = getDb();
  const insert = db.insert(versions).values({ id, library_id, branch: branch ?? null });
  await (branch === undefined
    ? insert.onConflictDoNothing()
    : insert.onConflictDoUpdate({
        target: [versions.id, versions.library_id],
        set: { branch, pushed_at: sql`now()` },
        where: sql`${versions.branch} IS DISTINCT FROM ${branch}`,
      }));
  return db
    .select()
    .from(versions)
    .where(and(eq(versions.id, id), eq(versions.library_id, library_id)))
    .limit(1)
    .then((r) => withIso(r[0]!, 'pushed_at'));
}

/**
 * Makes `version_id` the library's only current version. Returns false, changing nothing, when
 * the library has no such version.
 */
export async function promoteVersion(library_id: string, version_id: string): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Lock the target first: a concurrent delete cannot remove it before it is marked current.
    const target = await tx
      .select({ id: versions.id })
      .from(versions)
      .where(and(eq(versions.id, version_id), eq(versions.library_id, library_id)))
      .for('update');
    if (target.length === 0) return false;
    await tx.update(versions).set({ is_current: false }).where(eq(versions.library_id, library_id));
    await tx
      .update(versions)
      .set({ is_current: true })
      .where(and(eq(versions.id, version_id), eq(versions.library_id, library_id)));
    return true;
  });
}

export async function getCurrentVersion(library_id: string): Promise<Version | undefined> {
  return getDb()
    .select()
    .from(versions)
    .where(and(eq(versions.library_id, library_id), eq(versions.is_current, true)))
    .limit(1)
    .then((r) => r[0] && withIso(r[0], 'pushed_at'));
}

export async function listVersions(library_id: string): Promise<Version[]> {
  return getDb()
    .select()
    .from(versions)
    .where(eq(versions.library_id, library_id))
    .orderBy(desc(versions.pushed_at))
    .then((rows) => rows.map((r) => withIso(r, 'pushed_at')));
}

/**
 * Deletes a non-current version with its documents and image records in one transaction.
 * Returns the distinct hashes of the removed image records: their files may now be unreferenced.
 * The version row is locked before `is_current` is checked, so a concurrent promote either
 * finishes first (and the delete is refused) or waits until the version is gone.
 */
export async function deleteVersion(
  library_id: string,
  version_id: string,
): Promise<{ imageHashes: string[] } | 'not_found' | 'is_current'> {
  return getDb().transaction(async (tx) => {
    const version = await tx
      .select({ is_current: versions.is_current })
      .from(versions)
      .where(and(eq(versions.id, version_id), eq(versions.library_id, library_id)))
      .for('update')
      .then((r) => r[0]);
    if (!version) return 'not_found';
    if (version.is_current) return 'is_current';

    const images = await tx
      .delete(document_images)
      .where(and(eq(document_images.library_id, library_id), eq(document_images.version_id, version_id)))
      .returning({ image_hash: document_images.image_hash });
    await tx
      .delete(documents)
      .where(and(eq(documents.library_id, library_id), eq(documents.version_id, version_id)));
    await tx
      .delete(versions)
      .where(and(eq(versions.id, version_id), eq(versions.library_id, library_id)));
    const hashes = new Set(images.map((i) => i.image_hash).filter((h): h is string => !!h));
    return { imageHashes: [...hashes] };
  });
}

export const pgVersionRepository: VersionRepository = {
  create: createVersion,
  promote: promoteVersion,
  current: getCurrentVersion,
  list: listVersions,
  delete: deleteVersion,
};
