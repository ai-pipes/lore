/** A library: one service's documentation, identified by a slug-like id (`petstore-api`). */
export interface Library {
  id: string;
  display_name: string;
  /** The namespace the library belongs to (`default` unless an admin assigned another). */
  namespace_id: string;
  created_at: string;
}

/** A library with the id of its current version and the number of documents in it. */
export interface LibraryWithStats extends Library {
  current_version: string | null;
  document_count: number;
}

/** Library ids are lowercase slugs: a letter or digit, then letters, digits, `_` or `-`. */
export const LIBRARY_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidLibraryId(id: string): boolean {
  return LIBRARY_ID_RE.test(id);
}

/** Windows device names: a file named like one (with any extension) addresses the device. */
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * True when `segment` is one plain path segment that names the same file everywhere: not empty,
 * not `.` or `..`, only printable ASCII (file systems fold case and normalize non-ASCII names in
 * different ways), free of `/`, `\` and `:`, not ending in a dot or space, and not a Windows
 * device name. Libraries created before ids were validated (such as `PaymentService`) fail
 * `isValidLibraryId` yet are safe to use as a storage directory name.
 */
export function isPathSafeSegment(segment: string): boolean {
  if (segment === '' || segment === '.' || segment === '..') return false;
  if (segment.endsWith('.') || segment.endsWith(' ')) return false;
  for (let i = 0; i < segment.length; i++) {
    const code = segment.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
    const ch = segment[i];
    if (ch === '/' || ch === '\\' || ch === ':') return false;
  }
  return !WINDOWS_DEVICE_RE.test(segment.split('.')[0]!.trimEnd());
}

/**
 * The key under which library ids share one image directory: on case-insensitive file systems
 * `PaymentService` and `paymentservice` are the same directory. Only ASCII letters are folded
 * (storable ids are ASCII), independent of locale; the database folds the same way.
 */
export function storageOwnerKey(libraryId: string): string {
  return libraryId.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}
