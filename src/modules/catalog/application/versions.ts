import { isValidBranch, isValidVersionId, type Version } from '../domain/version.js';
import type { CatalogDeps } from './ports.js';
import { releaseBlobFile } from './images.js';

export type LibraryNotFound = 'library_not_found';

export async function listVersions(d: CatalogDeps, libraryId: string): Promise<Version[] | LibraryNotFound> {
  if (!(await d.libraries.get(libraryId))) return 'library_not_found';
  return d.versions.list(libraryId);
}

/**
 * Creates a version of a library. An invalid id or branch is refused before anything is written.
 * Creating an existing version again returns it; given another branch, the version moves there
 * and becomes that branch's newest version (the same commit pushed again after a fast-forward
 * merge), while without a branch it keeps the one it has.
 */
export async function createVersion(
  d: CatalogDeps,
  libraryId: string,
  input: { id: string; branch?: string },
): Promise<Version | LibraryNotFound | 'invalid_version_id' | 'invalid_branch'> {
  if (!isValidVersionId(input.id)) return 'invalid_version_id';
  if (input.branch !== undefined && !isValidBranch(input.branch)) return 'invalid_branch';
  if (!(await d.libraries.get(libraryId))) return 'library_not_found';
  return d.versions.create(input.id, libraryId, input.branch);
}

/** Makes `versionId` the library's only current version; an unknown version changes nothing. */
export async function promoteVersion(
  d: CatalogDeps,
  libraryId: string,
  versionId: string,
): Promise<'ok' | LibraryNotFound | 'version_not_found'> {
  if (!(await d.libraries.get(libraryId))) return 'library_not_found';
  return (await d.versions.promote(libraryId, versionId)) ? 'ok' : 'version_not_found';
}

/**
 * Deletes a version with its documents and images. The current version cannot be deleted.
 * Image files go too once no image record of the library references their hash any more.
 */
export async function deleteVersion(
  d: CatalogDeps,
  libraryId: string,
  versionId: string,
): Promise<'ok' | 'not_found' | 'is_current'> {
  const result = await d.versions.delete(libraryId, versionId);
  if (typeof result === 'string') return result;
  for (const hash of result.imageHashes) await releaseBlobFile(d, libraryId, hash);
  return 'ok';
}

export function getCurrentVersion(d: CatalogDeps, libraryId: string): Promise<Version | undefined> {
  return d.versions.current(libraryId);
}
