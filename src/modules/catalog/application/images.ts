import { detectImageType, extensionMatchesType } from '../domain/image-type.js';
import type { ImageRecord } from '../domain/document.js';
import type { CatalogDeps } from './ports.js';

export interface ImageUpload {
  libraryId: string;
  versionId: string;
  slug: string;
  filename: string;
  data: Uint8Array;
}

/**
 * Stores an uploaded image of a document. The type is detected from the bytes (never the
 * client's Content-Type) and the filename extension must match it (`extension_mismatch`); the
 * file is stored once per content hash. A library whose id cannot
 * name a storage directory (a legacy id with a slash, say) answers `invalid_library_id`.
 */
export async function uploadImage(
  d: CatalogDeps,
  u: ImageUpload,
): Promise<
  { filename: string; url: string } | 'unsupported_type' | 'extension_mismatch' | 'library_not_found' | 'invalid_library_id'
> {
  const mimeType = detectImageType(u.data);
  if (!mimeType) return 'unsupported_type';
  if (!extensionMatchesType(u.filename, mimeType)) return 'extension_mismatch';
  if (!(await d.libraries.get(u.libraryId))) return 'library_not_found';
  const imageHash = d.blobs.hash(u.data);
  if (!blobPath(d, u.libraryId, imageHash)) return 'invalid_library_id';
  // File and record are one step: a concurrent release of the same file cannot remove it in between.
  await d.images.upsert(u.libraryId, u.versionId, u.slug, u.filename, u.data.length, imageHash, mimeType, () =>
    d.blobs.save(u.libraryId, imageHash, u.data),
  );
  return {
    filename: u.filename,
    url: `/api/libraries/${u.libraryId}/versions/${u.versionId}/images/${u.slug}/${u.filename}`,
  };
}

export function listImages(d: CatalogDeps, libraryId: string, versionId: string, slug: string): Promise<ImageRecord[]> {
  return d.images.list(libraryId, versionId, slug);
}

/**
 * The stored file of an image, or null when the blob store refuses to address it: records written
 * before library ids were validated may carry an id or hash that maps to no path inside storage.
 */
export function blobPath(d: CatalogDeps, libraryId: string, imageHash: string): string | null {
  try {
    return d.blobs.path(libraryId, imageHash);
  } catch {
    return null;
  }
}

/**
 * Where the image file is stored and its MIME type, or null if there is no such image or its
 * file cannot be addressed.
 */
export async function findImage(
  d: CatalogDeps,
  libraryId: string,
  versionId: string,
  slug: string,
  filename: string,
): Promise<{ path: string; mimeType: string } | null> {
  const img = await d.images.get(libraryId, versionId, slug, filename);
  if (!img?.image_hash) return null;
  const path = blobPath(d, libraryId, img.image_hash);
  return path ? { path, mimeType: img.mime_type } : null;
}

/**
 * Deletes an image record; the file goes too once no other record of the library references its
 * hash. A file that cannot be addressed (a legacy library id or hash) is left alone; the record
 * still goes.
 */
export async function deleteImage(
  d: CatalogDeps,
  libraryId: string,
  versionId: string,
  slug: string,
  filename: string,
): Promise<void> {
  const img = await d.images.get(libraryId, versionId, slug, filename);
  await d.images.delete(libraryId, versionId, slug, filename);
  if (img?.image_hash) await releaseBlobFile(d, libraryId, img.image_hash);
}

/**
 * Deletes the stored file of (library, hash) unless an image record of the library still
 * references it. A file that cannot be addressed (a legacy library id or hash) is left alone; a
 * file that is already gone is not an error.
 */
export async function releaseBlobFile(d: CatalogDeps, libraryId: string, imageHash: string): Promise<void> {
  const path = blobPath(d, libraryId, imageHash);
  if (!path) return;
  await d.images.releaseBlob(libraryId, imageHash, async () => {
    try {
      await d.blobs.delete(path);
    } catch {
      // already gone — not an error
    }
  });
}
