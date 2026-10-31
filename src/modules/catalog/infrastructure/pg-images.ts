import { and, eq, sql } from 'drizzle-orm';
import { asciiLower } from './ascii-fold.js';
import { withIso } from './timestamps.js';
import { getDb, type DbClient } from '../../../platform/db.js';
import { storageOwnerKey } from '../domain/library.js';
import type { ImageRecord } from '../domain/document.js';
import type { ImageRepository } from '../application/ports.js';
import { document_images } from './schema.js';

export type { ImageRecord };

type Tx = Parameters<Parameters<DbClient['transaction']>[0]>[0];

/**
 * Serializes, until the transaction ends, everything that writes or removes the image file of
 * (library, hash): ids that differ only by case share the lock, as they share the directory.
 */
async function lockImageBlob(tx: Tx, library_id: string, image_hash: string): Promise<void> {
  const key = `image-blob:${storageOwnerKey(library_id)}:${image_hash}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

function upsertImageRow(
  db: DbClient | Tx,
  row: { library_id: string; version_id: string; slug: string; filename: string; file_size: number; image_hash: string; mime_type: string },
) {
  const { file_size, image_hash, mime_type } = row;
  return db
    .insert(document_images)
    .values(row)
    .onConflictDoUpdate({
      target: [
        document_images.library_id,
        document_images.version_id,
        document_images.slug,
        document_images.filename,
      ],
      set: { file_size, image_hash, mime_type },
    });
}

/**
 * Inserts or updates an image record. With `storeBlob`, the file is stored first and the record
 * written while holding the (library, hash) lock, so a concurrent release of the same file
 * either finishes before (and the file is written again) or sees this record and keeps the file.
 */
export async function upsertDocumentImage(
  library_id: string,
  version_id: string,
  slug: string,
  filename: string,
  file_size: number,
  image_hash: string,
  mime_type: string = 'image/png',
  storeBlob?: () => Promise<void>,
): Promise<void> {
  const row = { library_id, version_id, slug, filename, file_size, image_hash, mime_type };
  if (!storeBlob) {
    await upsertImageRow(getDb(), row);
    return;
  }
  await getDb().transaction(async (tx) => {
    await lockImageBlob(tx, library_id, image_hash);
    await storeBlob();
    await upsertImageRow(tx, row);
  });
}

export async function getDocumentImages(
  library_id: string,
  version_id: string,
  slug: string,
): Promise<ImageRecord[]> {
  const db = getDb();
  return db
    .select({
      filename: document_images.filename,
      file_size: document_images.file_size,
      image_hash: document_images.image_hash,
      mime_type: document_images.mime_type,
      created_at: document_images.created_at,
    })
    .from(document_images)
    .where(
      and(
        eq(document_images.library_id, library_id),
        eq(document_images.version_id, version_id),
        eq(document_images.slug, slug),
      ),
    )
    .then((rows) => rows.map((r) => withIso(r, 'created_at')));
}

export async function getDocumentImage(
  library_id: string,
  version_id: string,
  slug: string,
  filename: string,
): Promise<{ image_hash: string; mime_type: string } | undefined> {
  const db = getDb();
  return db
    .select({ image_hash: document_images.image_hash, mime_type: document_images.mime_type })
    .from(document_images)
    .where(
      and(
        eq(document_images.library_id, library_id),
        eq(document_images.version_id, version_id),
        eq(document_images.slug, slug),
        eq(document_images.filename, filename),
      ),
    )
    .limit(1)
    .then((r) => r[0] as { image_hash: string; mime_type: string } | undefined);
}

export async function deleteDocumentImage(
  library_id: string,
  version_id: string,
  slug: string,
  filename: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(document_images)
    .where(
      and(
        eq(document_images.library_id, library_id),
        eq(document_images.version_id, version_id),
        eq(document_images.slug, slug),
        eq(document_images.filename, filename),
      ),
    );
}

/** Clone image records to a new version — no file I/O needed, files are addressed by hash. */
export async function cloneVersionImages(
  library_id: string,
  sourceVersionId: string,
  targetVersionId: string,
): Promise<number> {
  const db = getDb();

  const sourceImages = await db
    .select()
    .from(document_images)
    .where(
      and(
        eq(document_images.library_id, library_id),
        eq(document_images.version_id, sourceVersionId),
      ),
    );

  if (sourceImages.length === 0) return 0;

  await db
    .insert(document_images)
    .values(
      sourceImages.map((img) => ({
        library_id,
        version_id: targetVersionId,
        slug: img.slug,
        filename: img.filename,
        file_size: img.file_size,
        image_hash: img.image_hash,
        mime_type: img.mime_type,
      })),
    )
    .onConflictDoNothing();

  return sourceImages.length;
}

/**
 * True if any image record of `library_id` (in any version) still points at `image_hash`. Image
 * files live at `<storage>/<library id>/<hash>`, so only records of the same directory count: the
 * same library, or a legacy one whose id differs only by case (one directory on a case-insensitive
 * file system).
 */
export async function isImageHashReferenced(library_id: string, image_hash: string): Promise<boolean> {
  const remaining = await getDb()
    .select({ id: document_images.id })
    .from(document_images)
    .where(and(eq(asciiLower(document_images.library_id), asciiLower(library_id)), eq(document_images.image_hash, image_hash)))
    .limit(1);
  return remaining.length > 0;
}

/**
 * Calls `deleteBlob` (and returns true) only when no image record of the library's directory
 * still references `image_hash`; the check and the delete hold the (library, hash) lock, so an
 * upload of the same file in progress is waited for.
 */
export async function releaseImageBlob(
  library_id: string,
  image_hash: string,
  deleteBlob: () => Promise<void>,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    await lockImageBlob(tx, library_id, image_hash);
    const remaining = await tx
      .select({ id: document_images.id })
      .from(document_images)
      .where(and(eq(asciiLower(document_images.library_id), asciiLower(library_id)), eq(document_images.image_hash, image_hash)))
      .limit(1);
    if (remaining.length > 0) return false;
    await deleteBlob();
    return true;
  });
}

export const pgImageRepository: ImageRepository = {
  upsert: upsertDocumentImage,
  list: getDocumentImages,
  get: getDocumentImage,
  delete: deleteDocumentImage,
  cloneVersion: cloneVersionImages,
  releaseBlob: releaseImageBlob,
};
