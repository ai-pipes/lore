/** Who may push to which library: the rule behind every push route. */
import { DEFAULT_NAMESPACE, INSIGHTS_NAMESPACE } from './namespace.js';

/** The pushing side of a caller: the admin (user or admin key), a project key, or anyone else. */
export type PushActor =
  | { kind: 'admin' }
  | { kind: 'project'; keyId: string; namespaceId: string; libraryId: string | null }
  | { kind: 'none' };

export type PushDecision = { ok: true; namespaceId: string } | { ok: false; status: 403 | 404; error: string };

const deny = (error: string): PushDecision => ({ ok: false, status: 403, error });

/**
 * Decides a push to `target.libraryId`; `target.namespaceId` is the library's namespace, or null
 * when the library does not exist yet (the push creates it). On success `namespaceId` is the
 * namespace the library is (or will be) in.
 *
 * - The `insights` namespace is written only by the chat module: 403 for everyone. So is a
 *   reserved library id (the configured insights library), whatever namespace it is (or would be) in.
 * - A project key pushes only to libraries of its namespace (and only to its library when it is
 *   restricted to one), creates new libraries in its namespace, and may not ask for another one.
 * - The admin pushes anywhere and creates new libraries in `requestedNamespace` (default `default`).
 */
export function decidePush(
  actor: PushActor,
  target: { libraryId: string; namespaceId: string | null },
  requestedNamespace?: string,
  reservedLibraryIds: ReadonlySet<string> = new Set(),
): PushDecision {
  if (reservedLibraryIds.has(target.libraryId)) return deny('this library id is reserved for insights');
  if (target.namespaceId === INSIGHTS_NAMESPACE) return deny('the insights namespace is read-only');
  if (target.namespaceId === null && requestedNamespace === INSIGHTS_NAMESPACE) return deny('the insights namespace is read-only');
  switch (actor.kind) {
    case 'none':
      return deny('push requires an admin or a project key');
    case 'admin':
      return { ok: true, namespaceId: target.namespaceId ?? requestedNamespace ?? DEFAULT_NAMESPACE };
    case 'project':
      if (actor.libraryId !== null && actor.libraryId !== target.libraryId) return deny('this project key is restricted to another library');
      if (requestedNamespace !== undefined && requestedNamespace !== actor.namespaceId) return deny('a project key pushes only to its own namespace');
      if (target.namespaceId !== null && target.namespaceId !== actor.namespaceId) return deny('the library belongs to another namespace');
      return { ok: true, namespaceId: actor.namespaceId };
  }
}
