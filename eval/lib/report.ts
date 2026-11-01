import type { AnswerCheck, ChatRun } from './answer-checks.js';
import type { RankedHit, SearchMetrics } from './metrics.js';

export interface RunConfig {
  kind: 'search' | 'answers';
  label: string;
  startedAt: string;
  gitSha: string;
  gitDirty: boolean;
  loreUrl: string;
  answerModel: string;
  termModel: string;
  embeddingProvider: string;
  embeddingModel: string;
  runs: number;
  goldenHash: string;
  goldenCount: number;
  /** CHECKER_VERSION of the scoring code; reports written before it existed count as 1. */
  checkerVersion: number;
}

export interface SearchRunRecord {
  terms: string;
  fallback: boolean;
  hits: RankedHit[];
  metrics: SearchMetrics;
  error?: string;
}

export interface AnswerRunRecord {
  run: ChatRun;
  check: AnswerCheck;
  /** The probe search before the chat fell back to the raw question (term extraction timed out). */
  termFallback?: boolean;
}

export interface QuestionResult {
  id: string;
  tags: string[];
  search?: SearchRunRecord[];
  answers?: AnswerRunRecord[];
  /** Per-question means: ndcg10 etc. for search, factRecall etc. for answers. */
  score: Record<string, number>;
}

export interface Aggregate {
  overall: Record<string, number>;
  byTag: Record<string, Record<string, number>>;
  errors: number;
  fallbacks: number;
}

export interface Report {
  config: RunConfig;
  partial: boolean;
  questions: QuestionResult[];
  aggregate: Aggregate;
}

export interface QDelta {
  id: string;
  metric: string;
  a: number;
  b: number;
  delta: number;
}

export interface Comparison {
  configDiffs: string[];
  /** One line per report whose runs had term-extraction fallbacks or errors (noisy numbers). */
  noise: string[];
  partial: { a: boolean; b: boolean };
  overall: { metric: string; a: number; b: number; delta: number }[];
  regressions: QDelta[];
  improvements: QDelta[];
  onlyInA: string[];
  onlyInB: string[];
}

const EPS = 1e-9;
const SEARCH_KEYS = ['recall2', 'recall5', 'mrr', 'ndcg10'] as const;
const LOWER_IS_BETTER = new Set(['forbiddenRate']);

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function scoreQuestion(r: Omit<QuestionResult, 'score'>): QuestionResult {
  const score: Record<string, number> = {};
  if (r.search) {
    const ok = r.search.filter((s) => !s.error);
    if (ok.length > 0) {
      for (const k of SEARCH_KEYS) score[k] = mean(ok.map((s) => s.metrics[k]));
    }
  }
  if (r.answers && r.answers.length > 0) {
    // An errored run counts as failed whatever its AnswerCheck says.
    const runs = r.answers.map((a) => ({ c: a.check, failed: Boolean(a.run.error) }));
    score.factRecall = mean(
      runs.map(({ c, failed }) => {
        if (failed) return 0;
        const v = Object.values(c.facts);
        return v.length === 0 ? 1 : v.filter(Boolean).length / v.length;
      }),
    );
    // Over answered runs only: an errored run has no text to flag, and must not make the rate look better.
    // When every run errored the question gets the worst rate, not the best.
    const answered = runs.filter(({ failed }) => !failed);
    score.forbiddenRate =
      answered.length === 0 ? 1 : mean(answered.map(({ c }) => (c.forbiddenHit.length > 0 ? 1 : 0)));
    score.citationRecall = mean(runs.map(({ c, failed }) => (failed ? 0 : c.citationRecall)));
    score.allPassRate = mean(runs.map(({ c, failed }) => (!failed && c.allPass ? 1 : 0)));
  }
  return { ...r, score };
}

function meanScores(qs: QuestionResult[]): Record<string, number> {
  const sums = new Map<string, number[]>();
  for (const q of qs) {
    for (const [k, v] of Object.entries(q.score)) {
      const list = sums.get(k) ?? [];
      list.push(v);
      sums.set(k, list);
    }
  }
  return Object.fromEntries([...sums].map(([k, v]) => [k, mean(v)]));
}

export function aggregate(qs: QuestionResult[]): Aggregate {
  const tags = new Set(qs.flatMap((q) => q.tags));
  const byTag: Record<string, Record<string, number>> = {};
  for (const t of tags) byTag[t] = meanScores(qs.filter((q) => q.tags.includes(t)));
  let errors = 0;
  let fallbacks = 0;
  for (const q of qs) {
    for (const s of q.search ?? []) {
      if (s.error) errors++;
      if (s.fallback) fallbacks++;
    }
    for (const a of q.answers ?? []) {
      if (a.run.error) errors++;
      if (a.termFallback) fallbacks++;
    }
  }
  return { overall: meanScores(qs), byTag, errors, fallbacks };
}

function noiseOf(name: string, r: Report): string | undefined {
  const { fallbacks, errors } = r.aggregate;
  if (fallbacks === 0 && errors === 0) return undefined;
  return `${name}: ${fallbacks} term-extraction fallback(s), ${errors} error(s)`;
}

const IGNORED_CONFIG = new Set(['label', 'startedAt', 'gitSha', 'gitDirty']);

/** Fills fields that older reports lack. */
function withDefaults(c: RunConfig): Record<string, unknown> {
  return { ...c, checkerVersion: (c as Partial<RunConfig>).checkerVersion ?? 1 };
}

function configDiffs(ca: RunConfig, cb: RunConfig): string[] {
  const a = withDefaults(ca);
  const b = withDefaults(cb);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    if (IGNORED_CONFIG.has(k)) continue;
    const av = a[k];
    const bv = b[k];
    if (av !== bv) out.push(`${k}: ${String(av)} → ${String(bv)}`);
  }
  return out;
}

export function compareReports(a: Report, b: Report, threshold = 0.1): Comparison {
  const metrics = Object.keys(a.aggregate.overall).filter((m) => m in b.aggregate.overall);
  const overall = metrics.map((metric) => {
    const av = a.aggregate.overall[metric];
    const bv = b.aggregate.overall[metric];
    return { metric, a: av, b: bv, delta: bv - av };
  });
  const bById = new Map(b.questions.map((q) => [q.id, q]));
  const aIds = new Set(a.questions.map((q) => q.id));
  // Each delta with its signed change for the better (negative = worse), for filtering and sorting.
  const regressions: { d: QDelta; better: number }[] = [];
  const improvements: { d: QDelta; better: number }[] = [];
  for (const qa of a.questions) {
    const qb = bById.get(qa.id);
    if (!qb) continue;
    for (const metric of Object.keys(qa.score)) {
      const av = qa.score[metric];
      // A metric B could not produce (e.g. every run errored) counts as 0.
      const bv = qb.score[metric] ?? 0;
      const delta = bv - av;
      const better = LOWER_IS_BETTER.has(metric) ? -delta : delta;
      const d = { id: qa.id, metric, a: av, b: bv, delta };
      if (better <= -threshold + EPS) regressions.push({ d, better });
      else if (better >= threshold - EPS) improvements.push({ d, better });
    }
  }
  return {
    configDiffs: configDiffs(a.config, b.config),
    noise: [noiseOf('A', a), noiseOf('B', b)].filter((x): x is string => x !== undefined),
    partial: { a: a.partial, b: b.partial },
    overall,
    // Worst regression first, biggest improvement first (sort is stable, so ties keep question order).
    // oxlint-disable-next-line unicorn/no-array-sort -- toSorted is ES2023, not in the tsconfig lib; local array
    regressions: regressions.sort((x, y) => x.better - y.better).map((r) => r.d),
    // oxlint-disable-next-line unicorn/no-array-sort -- toSorted is ES2023, not in the tsconfig lib; local array
    improvements: improvements.sort((x, y) => y.better - x.better).map((r) => r.d),
    onlyInA: a.questions.filter((q) => !bById.has(q.id)).map((q) => q.id),
    onlyInB: b.questions.filter((q) => !aIds.has(q.id)).map((q) => q.id),
  };
}

const fmt = (n: number): string => n.toFixed(2);
const signed = (n: number): string => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}`;

function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
}

function headline(kind: RunConfig['kind']): string {
  return kind === 'search' ? 'ndcg10' : 'allPassRate';
}

export function formatSummary(r: Report): string {
  const c = r.config;
  const lines: string[] = [];
  lines.push(
    `${c.kind} "${c.label}" ${c.gitSha}${c.gitDirty ? '+dirty' : ''}${r.partial ? ' (partial)' : ''}`,
  );
  lines.push(
    `answerModel=${c.answerModel} termModel=${c.termModel} embedding=${c.embeddingProvider}/${c.embeddingModel} runs=${c.runs}`,
  );
  const keys = Object.keys(r.aggregate.overall);
  lines.push('');
  lines.push(
    ...table([
      ['', ...keys],
      ['overall', ...keys.map((k) => fmt(r.aggregate.overall[k]))],
      ...Object.entries(r.aggregate.byTag).map(([t, s]) => [t, ...keys.map((k) => (k in s ? fmt(s[k]) : '-'))]),
    ]),
  );
  lines.push('');
  lines.push(`errors: ${r.aggregate.errors}`);
  lines.push(`fallbacks: ${r.aggregate.fallbacks}`);

  const h = headline(c.kind);
  const worst = r.questions
    .filter((q) => h in q.score)
    // oxlint-disable-next-line unicorn/no-array-sort -- toSorted is ES2023, not in the tsconfig lib; filter() already copied
    .sort((x, y) => x.score[h] - y.score[h])
    .slice(0, 10);
  if (worst.length > 0) {
    lines.push('');
    lines.push(`Worst questions by ${h}:`);
    const withCtx = c.kind === 'answers';
    lines.push(
      ...table([
        ['id', h, ...(withCtx ? ['contextRecall'] : [])],
        ...worst.map((q) => [
          q.id,
          fmt(q.score[h]),
          ...(withCtx ? [q.answers ? fmt(mean(q.answers.map((a) => a.check.contextRecall))) : '–'] : []),
        ]),
      ]),
    );
  }
  return lines.join('\n');
}

export function formatComparison(c: Comparison): string {
  const lines: string[] = [];
  if (c.configDiffs.length > 0) {
    lines.push('WARNING: configurations differ, results may not be comparable:');
    for (const d of c.configDiffs) lines.push(`  ${d}`);
  }
  if (c.noise.length > 0) {
    lines.push(`${lines.length > 0 ? '' : 'WARNING: '}noisy runs (the local LLM is too slow or failing; see eval/README.md), deltas include noise:`);
    for (const n of c.noise) lines.push(`  ${n}`);
  }
  if (c.partial.a || c.partial.b) {
    const which = [c.partial.a ? 'A' : '', c.partial.b ? 'B' : ''].filter(Boolean).join(' and ');
    lines.push(`${lines.length > 0 ? '' : 'WARNING: '}partial report: ${which} did not finish`);
  }
  if (lines.length > 0) lines.push('');
  lines.push(
    ...table([
      ['metric', 'A', 'B', 'delta'],
      ...c.overall.map((o) => [o.metric, fmt(o.a), fmt(o.b), signed(o.delta)]),
    ]),
  );
  const section = (title: string, ds: QDelta[]): void => {
    if (ds.length === 0) return;
    lines.push('', `${title}:`);
    lines.push(
      ...table([
        ['id', 'metric', 'A', 'B', 'delta'],
        ...ds.map((d) => [d.id, d.metric, fmt(d.a), fmt(d.b), signed(d.delta)]),
      ]),
    );
  };
  section('Regressions', c.regressions);
  section('Improvements', c.improvements);
  if (c.onlyInA.length > 0) lines.push('', `Only in A: ${c.onlyInA.join(', ')}`);
  if (c.onlyInB.length > 0) lines.push('', `Only in B: ${c.onlyInB.join(', ')}`);
  return lines.join('\n');
}
