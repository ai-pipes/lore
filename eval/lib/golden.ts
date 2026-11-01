import { createHash } from 'node:crypto';

export interface DocRef {
  library_id: string;
  slug: string;
}
/** grade 2 = primary document, 1 = supporting. */
export interface ExpectedDoc extends DocRef {
  grade: 1 | 2;
}
/** Any pattern matching means the fact is present. */
export interface PatternCheck {
  id: string;
  patterns: RegExp[];
}
export interface GoldenQuestion {
  id: string;
  question: string;
  tags: string[];
  scope?: { library_id?: string; branch?: string };
  /** May be empty only when the question is unanswerable. */
  expected_docs: ExpectedDoc[];
  required_facts: PatternCheck[];
  forbidden?: PatternCheck[];
  /** "library_id/slug" entries that must all be cited; "a/b|c/d" is satisfied by either. Default: the grade-2 docs. */
  must_cite?: string[];
  /** Then required_facts holds the "no documentation" pattern. */
  unanswerable?: boolean;
}

// A bare dotted slug such as "orders.create-order" (whole text) is rejected:
// the search layer treats it as a slug lookup, not a question.
const DOTTED_SLUG = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9\-./]+)$/i;

export function docKey(d: DocRef): string {
  return `${d.library_id}/${d.slug}`;
}

export function mustCite(q: GoldenQuestion): string[] {
  if (q.must_cite) return q.must_cite;
  return q.expected_docs.filter((d) => d.grade === 2).map(docKey);
}

export function validateGolden(qs: GoldenQuestion[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const q of qs) {
    if (seen.has(q.id)) errors.push(`${q.id}: duplicate id`);
    seen.add(q.id);
    if (DOTTED_SLUG.test(q.question.trim())) {
      errors.push(`${q.id}: question looks like a dotted slug lookup, phrase it as a sentence`);
    }
    if (q.scope?.branch && !q.scope.library_id) {
      errors.push(`${q.id}: scope.branch requires scope.library_id`);
    }
    if (q.expected_docs.length === 0 && !q.unanswerable) {
      errors.push(`${q.id}: expected_docs is empty on an answerable question`);
    }
    if (q.required_facts.length === 0) {
      errors.push(`${q.id}: required_facts is empty`);
    }
    for (const c of q.must_cite ?? []) {
      for (const alt of c.split('|')) {
        if (!alt.includes('/')) errors.push(`${q.id}: must_cite entry "${alt}" must be "library_id/slug" (alternatives: "a/b|c/d")`);
      }
    }
  }
  return errors;
}

export function goldenHash(qs: GoldenQuestion[]): string {
  const json = JSON.stringify(qs, (_k, v: unknown) =>
    v instanceof RegExp ? `/${v.source}/${v.flags}` : v,
  );
  return createHash('sha256').update(json).digest('hex');
}

/** Select by id or tag. An `only` list matching nothing returns [] (caller reports it). */
export function selectQuestions(qs: GoldenQuestion[], only?: string[]): GoldenQuestion[] {
  if (!only) return qs;
  return qs.filter((q) => only.some((o) => o === q.id || q.tags.includes(o)));
}
