import { createHash } from 'crypto';
import { mkdir, writeFile, readFile, unlink, access } from 'fs/promises';
import { join, dirname, resolve, sep } from 'path';
import { isPathSafeSegment } from '../domain/library.js';
import type { BlobStore } from '../application/ports.js';

/** Image files are named by the SHA-256 of their content (`hashBuffer`). */
const IMAGE_HASH_RE = /^[0-9a-f]{64}$/;

function getStorageRoot(): string {
  return resolve(process.env.LORE_STORAGE_PATH ?? './storage');
}

/** Throws unless `filePath` resolves to a path strictly inside the storage root. */
function assertInsideStorage(filePath: string): string {
  const root = getStorageRoot();
  const resolved = resolve(filePath);
  if (!resolved.startsWith(root + sep)) throw new Error('image path is outside the storage root');
  return resolved;
}

/**
 * `<storage root>/<library id>/<sha-256>`. Both parts are validated and the result is checked to
 * stay inside the storage root, so no id or hash can address a file elsewhere. The library id need
 * not match today's creation pattern (libraries created before it, like `PaymentService`, keep
 * their ids); it must be one plain path segment.
 */
export function getImageFilePath(library_id: string, image_hash: string): string {
  if (!isPathSafeSegment(library_id)) throw new Error(`invalid library id "${library_id}"`);
  if (!IMAGE_HASH_RE.test(image_hash)) throw new Error('invalid image hash');
  return assertInsideStorage(join(getStorageRoot(), library_id, image_hash));
}

export async function saveImageByHash(
  library_id: string,
  image_hash: string,
  buffer: Uint8Array,
): Promise<void> {
  const filePath = getImageFilePath(library_id, image_hash);
  try {
    await access(filePath);
    return; // already exists — same content, skip write
  } catch {
    // file doesn't exist yet
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

export async function readImage(filePath: string): Promise<Buffer> {
  return readFile(assertInsideStorage(filePath));
}

export async function deleteImageFile(filePath: string): Promise<void> {
  await unlink(assertInsideStorage(filePath));
}

export function hashBuffer(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Image files on disk under LORE_STORAGE_PATH, addressed by content hash. */
export const fileBlobStore: BlobStore = {
  hash: hashBuffer,
  path: getImageFilePath,
  save: saveImageByHash,
  delete: deleteImageFile,
};
