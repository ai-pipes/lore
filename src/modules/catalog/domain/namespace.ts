/**
 * Namespaces: admin-defined groups of libraries. `default` holds libraries nobody assigned;
 * `insights` is the system namespace of published chats (no assignment, no project-key push).
 */
export const DEFAULT_NAMESPACE = 'default';
export const INSIGHTS_NAMESPACE = 'insights';

/** Namespace ids are lowercase slugs of 1–63 characters: a letter or digit, then letters, digits, `_` or `-`. */
export const NAMESPACE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export interface Namespace {
  id: string;
  display_name: string;
  /** A system namespace (`insights`) is managed by Lore itself. */
  system: boolean;
  created_at: string;
}

export function isValidNamespaceId(id: string): boolean {
  return NAMESPACE_ID_RE.test(id);
}

export function isSystemNamespace(id: string): boolean {
  return id === INSIGHTS_NAMESPACE;
}

/** A project key (`lpk_…`) as stored: only the SHA-256 of the key is kept, never the key. */
export interface ProjectKeyRecord {
  id: string;
  namespaceId: string;
  /** Restricts the key to one library of its namespace; null = the whole namespace. */
  libraryId: string | null;
  name: string;
  /** The first characters of the key, to recognise it in lists. */
  prefix: string;
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** A request authenticated with a project key. */
export type ProjectCaller = { kind: 'project'; keyId: string; name: string; namespaceId: string; libraryId: string | null };
