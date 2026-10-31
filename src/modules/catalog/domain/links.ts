/** A link from a document to a known slug, suggested by an LLM (stored with source 'auto'). */
export interface SuggestedLink {
  toSlug: string;
  linkType: string;
  confidence: number;
}

/** Link types an LLM may suggest. */
export const VALID_LINK_TYPES = [
  'uses-dal', 'calls-service', 'reads-table', 'writes-table',
  'emits-event', 'consumes-event', 'enqueues', 'processes-queue',
  'references', 'triggers', 'depends-on',
];

/** Minimum confidence for a suggested link to be kept. */
export const MIN_LINK_CONFIDENCE = 0.5;

/**
 * The items of an LLM JSON answer: a bare array, or the array under `links` or `results`.
 * Anything else (invalid JSON, no array) yields [].
 */
export function parseSuggestedLinks(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>).links ?? (parsed as Record<string, unknown>).results ?? [];
  return Array.isArray(arr) ? arr : [];
}

/** Keeps well-formed suggestions to known slugs, with a valid type and enough confidence. */
export function acceptSuggestedLinks(raw: unknown[], knownSlugs: string[]): SuggestedLink[] {
  const knownSet = new Set(knownSlugs);
  return raw
    .filter((item): item is SuggestedLink =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).toSlug === 'string' &&
      VALID_LINK_TYPES.includes((item as Record<string, unknown>).linkType as string) &&
      knownSet.has((item as Record<string, unknown>).toSlug as string) &&
      typeof (item as Record<string, unknown>).confidence === 'number'
    )
    .filter((item) => item.confidence >= MIN_LINK_CONFIDENCE);
}
