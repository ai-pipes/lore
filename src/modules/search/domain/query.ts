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

/** Web-search connective words, dropped so they do not turn into search terms or operators. */
const CONNECTIVES = new Set(['or', 'and', 'not']);

/**
 * The search terms as a web-search query that matches documents containing ANY of them
 * (`a or b or c`). Plain `a b c` would require all of them, so one extracted term the document
 * does not use ("cost" for a page that says "fee") hides it. Quotes, a leading minus and
 * connective words are dropped; ranking still prefers documents matching more terms.
 */
export function anyTermQuery(terms: string): string {
  return terms
    .split(/\s+/)
    .map((t) => t.replace(/["“”]/g, '').replace(/^-+/, ''))
    .filter((t) => t.length > 0 && !CONNECTIVES.has(t.toLowerCase()))
    .join(' or ');
}

/**
 * Whether the extracted terms are a translation of the question rather than words taken from it:
 * fewer than half of the terms' words occur in the question (case-insensitive). Then the question
 * is in another language than the (English) documents, and its terms embed better than the question.
 */
export function termsAreTranslated(question: string, terms: string): boolean {
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const asked = new Set(words(question));
  const termWords = words(terms);
  if (termWords.length === 0) return false;
  const shared = termWords.filter((w) => asked.has(w)).length;
  return shared / termWords.length < 0.5;
}
