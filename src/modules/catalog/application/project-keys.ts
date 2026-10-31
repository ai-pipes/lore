/** Project keys (`lpk_…`): issued by admins for a namespace, used by CI to push. */
import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { isSystemNamespace, type ProjectCaller, type ProjectKeyRecord } from '../domain/namespace.js';
import type { CatalogDeps } from './ports.js';

export const PROJECT_KEY_PREFIX = 'lpk_';

export type ProjectKeyDeps = Pick<CatalogDeps, 'namespaces' | 'libraries' | 'projectKeys' | 'keySecrets' | 'clock'>;

/** Creates a key; `key` is the only time the secret is seen, only its SHA-256 is stored. */
export async function createProjectKey(
  d: ProjectKeyDeps,
  i: { namespaceId: string; name: string; libraryId?: string; createdBy: string | null },
): Promise<Result<{ key: string; record: ProjectKeyRecord }, 'not_found' | 'system_namespace' | 'library_not_in_namespace'>> {
  const ns = await d.namespaces.get(i.namespaceId);
  if (!ns) return err('not_found');
  if (isSystemNamespace(ns.id)) return err('system_namespace');
  if (i.libraryId !== undefined) {
    const library = await d.libraries.get(i.libraryId);
    if (!library || library.namespace_id !== ns.id) return err('library_not_in_namespace');
  }
  const key = d.keySecrets.random(PROJECT_KEY_PREFIX);
  const record = await d.projectKeys.insert({
    namespaceId: ns.id,
    libraryId: i.libraryId ?? null,
    name: i.name,
    prefix: key.slice(0, PROJECT_KEY_PREFIX.length + 8),
    hash: d.keySecrets.sha256Hex(key),
    createdBy: i.createdBy,
  });
  return ok({ key, record });
}

export function listProjectKeys(d: ProjectKeyDeps, namespaceId?: string): Promise<ProjectKeyRecord[]> {
  return d.projectKeys.list(namespaceId);
}

/** False when there is no such active key. */
export function revokeProjectKey(d: ProjectKeyDeps, id: string): Promise<boolean> {
  return d.projectKeys.revoke(id, d.clock.now());
}

/**
 * The caller of an `lpk_` token: null for any other token and for an unknown or revoked key.
 * Looked up on every request (nothing is cached), so revocation takes effect at once.
 */
export async function authenticateProjectKey(d: ProjectKeyDeps, token: string): Promise<ProjectCaller | null> {
  if (!token.startsWith(PROJECT_KEY_PREFIX)) return null;
  const record = await d.projectKeys.findByHash(d.keySecrets.sha256Hex(token));
  if (!record || record.revokedAt !== null) return null;
  await d.projectKeys.touch(record.id, d.clock.now());
  return { kind: 'project', keyId: record.id, name: record.name, namespaceId: record.namespaceId, libraryId: record.libraryId };
}
