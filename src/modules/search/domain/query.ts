/** A namespaced document reference typed as a query: `<library>.<slug parts>`. */
export const SLUG_PATTERN = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9\-./]+)$/i;

/**
 * Parses a dot-notation slug like "store.accesscontrol-group-list" into
 * `{ library_id: "store", query: "accesscontrol group list" }` for a targeted single-library search.
 * Returns null if the input doesn't look like a namespaced slug.
 */
export function parseDotSlug(text: string): { library_id: string; query: string } | null {
  const match = text.trim().match(SLUG_PATTERN);
  if (!match) return null;
  return { library_id: match[1], query: match[2].replace(/[.\-/]+/g, ' ') };
}

/**
 * The library and the slugs to try, in order, when the text names a document directly
 * (`orders.create-order.something`). Null when the text is not a dotted slug.
 */
export function slugCandidates(text: string): { library_id: string; slugs: string[] } | null {
  const match = text.trim().match(SLUG_PATTERN);
  if (!match) return null;
  const slugPart = match[2].toLowerCase();
  const parts = slugPart.split('.');
  const slugs = new Set([slugPart.replace(/\./g, '/'), parts[0] + '/' + parts.slice(1).join('-'), slugPart]);
  return { library_id: match[1].toLowerCase(), slugs: [...slugs] };
}
