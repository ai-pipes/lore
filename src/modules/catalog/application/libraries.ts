import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { isValidLibraryId, type Library, type LibraryWithStats } from '../domain/library.js';
import { decidePush, type PushActor } from '../domain/push-policy.js';
import type { CatalogDeps } from './ports.js';

const INVALID_LIBRARY_ID = 'invalid library id: use lowercase letters, digits, "_" and "-", starting with a letter or digit';

/** Library ids name directories in the image store: never create a library with an invalid id. */
function assertValidLibraryId(id: string): void {
  if (!isValidLibraryId(id)) throw new Error(`${INVALID_LIBRARY_ID} (got "${id}")`);
}

/**
 * Why a new library `id` may not be created, or null: an existing (legacy) library whose id differs
 * only by letter case would share its image directory on a case-insensitive file system.
 */
async function caseConflict(d: CatalogDeps, id: string): Promise<string | null> {
  const variant = await d.libraries.caseVariantOf(id);
  return variant === undefined
    ? null
    : `library id "${id}" differs from the existing library "${variant}" only by letter case; use another id`;
}

async function assertNoCaseConflict(d: CatalogDeps, id: string): Promise<void> {
  const conflict = await caseConflict(d, id);
  if (conflict) throw new Error(conflict);
}

/**
 * Registers a library in `namespaceId` (default `default`), or updates the display name of an
 * existing one (e.g. on every `lore push`; its namespace is kept). `created` tells the two apart.
 */
export async function registerLibrary(
  d: CatalogDeps,
  input: { id: string; displayName: string; namespaceId?: string },
): Promise<{ library: Library; created: boolean }> {
  assertValidLibraryId(input.id);
  const existed = (await d.libraries.get(input.id)) !== undefined;
  if (!existed) await assertNoCaseConflict(d, input.id);
  const library = await d.libraries.upsert(input.id, input.displayName, input.namespaceId);
  return { library, created: !existed };
}

/**
 * `POST /api/libraries` on behalf of `actor`: the push policy decides whether the actor may
 * register (or rename) the library and in which namespace a new one is created.
 */
export async function pushLibrary(
  d: CatalogDeps,
  actor: PushActor,
  input: { id: string; displayName: string; namespaceId?: string },
): Promise<Result<{ library: Library; created: boolean }, { status: 400 | 403 | 404 | 409; error: string }>> {
  if (!isValidLibraryId(input.id)) return err({ status: 400, error: INVALID_LIBRARY_ID });
  const existing = await d.libraries.get(input.id);
  const decision = decidePush(
    actor,
    { libraryId: input.id, namespaceId: existing?.namespace_id ?? null },
    input.namespaceId,
    d.reservedLibraryIds,
  );
  if (!decision.ok) return err({ status: decision.status, error: decision.error });
  if (!existing && !(await d.namespaces.get(decision.namespaceId))) return err({ status: 404, error: 'namespace not found' });
  const conflict = existing ? null : await caseConflict(d, input.id);
  if (conflict) return err({ status: 409, error: conflict });
  // The write re-checks the namespace atomically: a library another namespace created since the
  // check above is refused, not renamed.
  const written = await d.libraries.upsertInNamespace(input.id, input.displayName, decision.namespaceId);
  if (!written) return err({ status: 403, error: 'library belongs to another namespace' });
  return ok(written);
}

export function getLibrary(d: CatalogDeps, id: string): Promise<Library | undefined> {
  return d.libraries.get(id);
}

/** All libraries, or only those of `namespaceId`. */
export function listLibraries(d: CatalogDeps, namespaceId?: string): Promise<LibraryWithStats[]> {
  return d.libraries.list(namespaceId);
}

/**
 * Makes sure a library and a current version exist, creating the library (with `displayName`,
 * in `namespaceId` when given) and promoting `versionId` on first use. An existing library of
 * another namespace is never adopted: that throws. An existing current version is returned unchanged.
 */
export async function ensureLibraryVersion(
  d: CatalogDeps,
  libraryId: string,
  displayName: string,
  versionId: string,
  namespaceId?: string,
): Promise<{ library_id: string; version_id: string }> {
  assertValidLibraryId(libraryId);
  const library = await d.libraries.get(libraryId);
  if (!library) {
    await assertNoCaseConflict(d, libraryId);
    await d.libraries.upsert(libraryId, displayName, namespaceId);
  } else if (namespaceId !== undefined && library.namespace_id !== namespaceId) {
    throw new Error(`library "${libraryId}" belongs to namespace "${library.namespace_id}", not "${namespaceId}"`);
  }
  const current = await d.versions.current(libraryId);
  if (current) return { library_id: libraryId, version_id: current.id };
  await d.versions.create(versionId, libraryId);
  await d.versions.promote(libraryId, versionId);
  return { library_id: libraryId, version_id: versionId };
}

/**
 * At startup: makes sure the system library `libraryId` (the configured insights library) exists
 * in `namespaceId`, creating it or moving it there. The configuration names the id, so the
 * operator decides; no push can create or write it (it is reserved in the push policy).
 */
export async function ensureSystemLibrary(
  d: CatalogDeps,
  libraryId: string,
  displayName: string,
  namespaceId: string,
): Promise<'created' | 'moved' | 'ok'> {
  assertValidLibraryId(libraryId);
  const library = await d.libraries.get(libraryId);
  if (!library) {
    await assertNoCaseConflict(d, libraryId);
    await d.libraries.upsert(libraryId, displayName, namespaceId);
    return 'created';
  }
  if (library.namespace_id === namespaceId) return 'ok';
  await d.libraries.setNamespace(libraryId, namespaceId);
  return 'moved';
}
