/** Namespaces: create, rename, list with their libraries, and move libraries between them. */
import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { isSystemNamespace, isValidNamespaceId, type Namespace } from '../domain/namespace.js';
import type { CatalogDeps } from './ports.js';

export type NamespaceDeps = Pick<CatalogDeps, 'namespaces' | 'libraries'>;

export async function createNamespace(
  d: NamespaceDeps,
  i: { id: string; displayName: string },
): Promise<Result<Namespace, 'invalid_id' | 'exists'>> {
  const displayName = i.displayName.trim();
  if (!isValidNamespaceId(i.id) || displayName === '') return err('invalid_id');
  const ns = await d.namespaces.insert({ id: i.id, displayName });
  return ns ? ok(ns) : err('exists');
}

export async function renameNamespace(d: NamespaceDeps, id: string, displayName: string): Promise<Result<Namespace, 'not_found'>> {
  const ns = await d.namespaces.rename(id, displayName.trim());
  return ns ? ok(ns) : err('not_found');
}

/** Every namespace with the ids of its libraries. */
export async function listNamespaces(d: NamespaceDeps): Promise<Array<Namespace & { libraries: string[] }>> {
  const [namespaces, libraries] = await Promise.all([d.namespaces.list(), d.libraries.list()]);
  return namespaces.map((ns) => ({
    ...ns,
    libraries: libraries.filter((l) => l.namespace_id === ns.id).map((l) => l.id).sort(),
  }));
}

/** Moves a library into a namespace. Nothing moves into or out of the system namespace. */
export async function assignLibrary(
  d: NamespaceDeps,
  libraryId: string,
  namespaceId: string,
): Promise<Result<void, 'not_found' | 'system_namespace'>> {
  const [library, ns] = await Promise.all([d.libraries.get(libraryId), d.namespaces.get(namespaceId)]);
  if (!library || !ns) return err('not_found');
  if (isSystemNamespace(namespaceId) || isSystemNamespace(library.namespace_id)) return err('system_namespace');
  await d.libraries.setNamespace(libraryId, namespaceId);
  return ok(undefined);
}
