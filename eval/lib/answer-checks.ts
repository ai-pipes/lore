import { docKey, mustCite, type GoldenQuestion, type PatternCheck } from './golden.js';

/** Version of the answer scoring logic, recorded in every report. Bump when scoring logic changes. */
export const CHECKER_VERSION = 3;

export interface ChatRun {
  text: string;
  /** Bare slugs from get_document tool events. */
  toolSlugs: string[];
  /** "library_id/slug" keys of the retrieved context. */
  sources: string[];
  durationMs: number;
  error?: string;
}

export interface AnswerCheck {
  facts: Record<string, boolean>;
  forbiddenHit: string[];
  cited: string[];
  citationRecall: number;
  /** Diagnostic only: share of grade-2 docs present in run.sources. */
  contextRecall: number;
  allPass: boolean;
}

/** Strips bold/italic asterisks and code backticks, keeps `_` (snake_case identifiers), collapses whitespace. */
export function normalizeAnswer(text: string): string {
  return text.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
}

export function extractCitations(text: string): string[] {
  const re = /\[ref:([a-z0-9][a-z0-9-]*)\/([^\]\s]+)\]/gi;
  const out = new Set<string>();
  for (const m of text.matchAll(re)) out.add(`${m[1]}/${m[2]}`);
  return [...out];
}

function matches(check: PatternCheck, text: string): boolean {
  return check.patterns.some((p) => {
    p.lastIndex = 0;
    const hit = p.test(text);
    p.lastIndex = 0;
    return hit;
  });
}

const slugOf = (key: string): string => key.slice(key.indexOf('/') + 1);

export function checkAnswer(q: GoldenQuestion, run: ChatRun): AnswerCheck {
  const text = normalizeAnswer(run.text);
  const facts: Record<string, boolean> = {};
  for (const f of q.required_facts) facts[f.id] = !run.error && matches(f, text);
  const forbiddenHit = run.error
    ? []
    : (q.forbidden ?? []).filter((f) => matches(f, text)).map((f) => f.id);

  // Models sometimes change the case of a [ref:] marker; library ids and slugs are lower-case anyway.
  const markers = new Set(extractCitations(run.text).map((k) => k.toLowerCase()));
  const tools = new Set(run.toolSlugs);
  const required = mustCite(q);
  // An entry "a|b" is cited when any of its alternatives is.
  const isCited = (k: string) => markers.has(k.toLowerCase()) || tools.has(slugOf(k));
  const cited = required.filter((entry) => entry.split('|').some(isCited));
  const citationRecall = required.length === 0 ? 1 : cited.length / required.length;

  const grade2 = q.expected_docs.filter((d) => d.grade === 2).map(docKey);
  const sources = new Set(run.sources);
  const contextRecall =
    grade2.length === 0 ? 1 : grade2.filter((k) => sources.has(k)).length / grade2.length;

  const allPass =
    !run.error &&
    Object.values(facts).every(Boolean) &&
    forbiddenHit.length === 0 &&
    citationRecall === 1;
  return { facts, forbiddenHit, cited, citationRecall, contextRecall, allPass };
}
