import { describe, expect, it } from 'vitest';
import type { AnswerCheck, ChatRun } from './answer-checks.js';
import {
  aggregate,
  compareReports,
  formatComparison,
  formatSummary,
  scoreQuestion,
  type AnswerRunRecord,
  type QuestionResult,
  type Report,
  type RunConfig,
  type SearchRunRecord,
} from './report.js';

const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  kind: 'answers',
  label: 'x',
  startedAt: '2026-11-01T00:00:00Z',
  gitSha: 'abc',
  gitDirty: false,
  loreUrl: 'http://localhost:3000',
  answerModel: 'qwen2.5:7b',
  termModel: 'qwen2.5:7b',
  embeddingProvider: 'hash',
  embeddingModel: 'm',
  runs: 3,
  goldenHash: 'h',
  goldenCount: 2,
  checkerVersion: 2,
  ...over,
});

const run = (error?: string): ChatRun => ({ text: '', toolSlugs: [], sources: [], durationMs: 1, ...(error ? { error } : {}) });
const ans = (facts: Record<string, boolean>, o: Partial<AnswerCheck> = {}, error?: string): AnswerRunRecord => {
  const allPass = Object.values(facts).every(Boolean) && !(o.forbiddenHit?.length);
  return {
    run: run(error),
    check: { facts, forbiddenHit: [], cited: [], citationRecall: 1, contextRecall: 0.5, allPass, ...o },
  };
};
const srch = (ndcg10: number, o: Partial<SearchRunRecord> = {}): SearchRunRecord => ({
  terms: 't',
  fallback: false,
  hits: [],
  metrics: { recall2: ndcg10, recall5: ndcg10, mrr: ndcg10, ndcg10 },
  ...o,
});
const qa = (id: string, answers: AnswerRunRecord[], tags: string[] = []): QuestionResult =>
  scoreQuestion({ id, tags, answers });
const report = (qs: QuestionResult[], config = cfg(), partial = false): Report => ({
  config,
  partial,
  questions: qs,
  aggregate: aggregate(qs),
});

/** Three answer runs, the first n of them passing. */
const three = (n: number): AnswerRunRecord[] => [0, 1, 2].map((i) => ans({ a: i < n }));

describe('scoreQuestion', () => {
  it('averages answer runs', () => {
    const q = qa('q', [ans({ a: true, b: false }), ans({ a: true, b: true })]);
    expect(q.score.factRecall).toBeCloseTo(0.75);
    expect(q.score.allPassRate).toBeCloseTo(0.5);
    expect(q.score.forbiddenRate).toBe(0);
  });

  it('counts an errored answer run as failed regardless of its check', () => {
    const errored: AnswerRunRecord = {
      run: run('timeout'),
      check: { facts: {}, forbiddenHit: [], cited: [], citationRecall: 1, contextRecall: 1, allPass: true },
    };
    const q = qa('q', [errored]);
    expect(q.score.allPassRate).toBe(0);
    expect(q.score.factRecall).toBe(0);
    expect(q.score.citationRecall).toBe(0);
  });

  it('computes forbiddenRate as share of runs with a forbidden hit', () => {
    const q = qa('q', [ans({ a: true }, { forbiddenHit: ['x'] }), ans({ a: true })]);
    expect(q.score.forbiddenRate).toBeCloseTo(0.5);
  });

  it('computes forbiddenRate over non-errored runs only', () => {
    const q = qa('q', [ans({ a: true }, { forbiddenHit: ['x'] }), ans({ a: false }, {}, 'timeout')]);
    expect(q.score.forbiddenRate).toBe(1);
    const clean = qa('c', [ans({ a: true }), ans({ a: false }, {}, 'timeout')]);
    expect(clean.score.forbiddenRate).toBe(0);
  });

  it('sets forbiddenRate to 1 when every answer run errored', () => {
    const q = qa('q', [ans({ a: false }, {}, 'timeout'), ans({ a: false }, {}, 'boom')]);
    expect(q.score.forbiddenRate).toBe(1);
  });

  it('averages search runs and skips errored ones', () => {
    const q = scoreQuestion({
      id: 's',
      tags: [],
      search: [srch(1), srch(0.5), srch(0, { error: 'boom' })],
    });
    expect(q.score.ndcg10).toBeCloseTo(0.75);
  });

  it('yields an empty score when every search run errored', () => {
    const q = scoreQuestion({ id: 's', tags: [], search: [srch(0, { error: 'boom' })] });
    expect(q.score).toEqual({});
  });
});

describe('aggregate', () => {
  it('computes means per tag and counts errors and fallbacks', () => {
    const q1 = scoreQuestion({ id: 'a', tags: ['t1', 't2'], search: [srch(1, { fallback: true })] });
    const q2 = scoreQuestion({ id: 'b', tags: ['t1'], search: [srch(0.5), srch(0, { error: 'x' })] });
    const agg = aggregate([q1, q2]);
    expect(agg.overall.ndcg10).toBeCloseTo(0.75);
    expect(agg.byTag.t1.ndcg10).toBeCloseTo(0.75);
    expect(agg.byTag.t2.ndcg10).toBe(1);
    expect(agg.errors).toBe(1);
    expect(agg.fallbacks).toBe(1);
  });

  it('counts errored answer runs', () => {
    const agg = aggregate([qa('a', [ans({ a: false }, {}, 'timeout'), ans({ a: true })])]);
    expect(agg.errors).toBe(1);
  });

  it('counts term-extraction fallbacks seen by the answer runs probe', () => {
    const agg = aggregate([qa('a', [{ ...ans({ a: true }), termFallback: true }, ans({ a: true })])]);
    expect(agg.fallbacks).toBe(1);
  });
});

describe('noisy runs', () => {
  it('warns in compare when either report has fallbacks or errors', () => {
    const clean = report([qa('q', [ans({ a: true })])]);
    const noisy = report([qa('q', [{ ...ans({ a: true }), termFallback: true }, ans({ a: false }, {}, 'timeout')])]);
    const c = compareReports(clean, noisy);
    expect(c.noise).toEqual(['B: 1 term-extraction fallback(s), 1 error(s)']);
    const text = formatComparison(c);
    expect(text.startsWith('WARNING')).toBe(true);
    expect(text).toContain('B: 1 term-extraction fallback(s), 1 error(s)');
    expect(compareReports(clean, clean).noise).toEqual([]);
  });

  it('prints fallbacks in the summary of answer reports too', () => {
    const r = report([qa('q', [{ ...ans({ a: true }), termFallback: true }])]);
    expect(formatSummary(r)).toContain('fallbacks: 1');
  });
});

describe('compareReports', () => {
  it('flags config differences and warns', () => {
    const a = report([qa('q', [ans({ a: true })])]);
    const b = report([qa('q', [ans({ a: true })])], cfg({ answerModel: 'other-model', label: 'other' }));
    const c = compareReports(a, b);
    expect(c.configDiffs).toEqual(['answerModel: qwen2.5:7b → other-model']);
    expect(formatComparison(c).startsWith('WARNING')).toBe(true);
  });

  it('flags a checkerVersion difference and treats a missing one as 1', () => {
    const a = report([qa('q', [ans({ a: true })])], cfg({ checkerVersion: 2 }));
    const b = report([qa('q', [ans({ a: true })])], cfg({ checkerVersion: 3 }));
    expect(compareReports(a, b).configDiffs).toEqual(['checkerVersion: 2 → 3']);
    const { checkerVersion: _omit, ...legacy } = cfg();
    const old = report([qa('q', [ans({ a: true })])], legacy as RunConfig);
    expect(compareReports(old, a).configDiffs).toEqual(['checkerVersion: 1 → 2']);
    expect(compareReports(old, report([qa('q', [ans({ a: true })])], cfg({ checkerVersion: 1 }))).configDiffs).toEqual([]);
  });

  it('sorts regressions worst first and improvements best first', () => {
    const a = report([qa('small', three(3)), qa('big', three(3)), qa('upSmall', three(0)), qa('upBig', three(0))]);
    const b = report([qa('small', three(2)), qa('big', three(0)), qa('upSmall', three(1)), qa('upBig', three(3))]);
    const c = compareReports(a, b);
    const reg = c.regressions.filter((d) => d.metric === 'allPassRate').map((d) => d.id);
    const imp = c.improvements.filter((d) => d.metric === 'allPassRate').map((d) => d.id);
    expect(reg).toEqual(['big', 'small']);
    expect(imp).toEqual(['upBig', 'upSmall']);
  });

  it('separates questions present on one side only', () => {
    const a = report([qa('q', [ans({ a: true })]), qa('onlyA', [ans({ a: true })])]);
    const b = report([qa('q', [ans({ a: true })]), qa('onlyB', [ans({ a: false })])]);
    const c = compareReports(a, b);
    expect(c.onlyInA).toEqual(['onlyA']);
    expect(c.onlyInB).toEqual(['onlyB']);
    expect(c.regressions.map((r) => r.id)).not.toContain('onlyB');
  });

  it('lists regressions and improvements, treating forbiddenRate as lower-is-better', () => {
    const a = report([
      qa('drop', [ans({ a: true }), ans({ a: true }), ans({ a: true })]),
      qa('forb', [ans({ a: true }), ans({ a: true }), ans({ a: true })]),
      qa('up', [ans({ a: false })]),
    ]);
    const b = report([
      qa('drop', [ans({ a: true }), ans({ a: false }), ans({ a: false })]),
      qa('forb', [
        ans({ a: true }, { forbiddenHit: ['x'] }),
        ans({ a: true }, { forbiddenHit: ['x'] }),
        ans({ a: true }),
      ]),
      qa('up', [ans({ a: true })]),
    ]);
    const c = compareReports(a, b);
    const drop = c.regressions.find((r) => r.id === 'drop' && r.metric === 'allPassRate');
    expect(drop?.a).toBe(1);
    expect(drop?.b).toBeCloseTo(0.333, 2);
    expect(c.regressions.find((r) => r.id === 'forb' && r.metric === 'forbiddenRate')?.delta).toBeCloseTo(0.667, 2);
    expect(c.improvements.some((r) => r.id === 'up' && r.metric === 'allPassRate')).toBe(true);
    expect(c.improvements.some((r) => r.metric === 'forbiddenRate')).toBe(false);
  });

  it('treats a metric missing in B as 0', () => {
    const a = report([scoreQuestion({ id: 's', tags: [], search: [srch(0.8)] })], cfg({ kind: 'search' }));
    const b = report(
      [scoreQuestion({ id: 's', tags: [], search: [srch(0, { error: 'boom' })] })],
      cfg({ kind: 'search' }),
    );
    const c = compareReports(a, b);
    const r = c.regressions.find((d) => d.id === 's' && d.metric === 'ndcg10');
    expect(r?.b).toBe(0);
    expect(r?.delta).toBeCloseTo(-0.8);
  });

  it('respects the threshold', () => {
    const a = report([qa('q', [ans({ a: true }), ans({ a: true }), ans({ a: true }), ans({ a: true })])]);
    const b = report([qa('q', [ans({ a: true }), ans({ a: true }), ans({ a: true }), ans({ a: false })])]);
    expect(compareReports(a, b).regressions.length).toBeGreaterThan(0);
    expect(compareReports(a, b, 0.5).regressions).toEqual([]);
  });

  it('accepts partial reports and mentions it', () => {
    const a = report([qa('q', [ans({ a: true })])]);
    const b = report([qa('q', [ans({ a: true })])], cfg(), true);
    const text = formatComparison(compareReports(a, b));
    expect(text).toContain('partial');
  });

  it('prints a clean comparison without a warning', () => {
    const a = report([qa('q', [ans({ a: true })])]);
    const text = formatComparison(compareReports(a, a));
    expect(text.startsWith('WARNING')).toBe(false);
    expect(text).toContain('allPassRate');
  });
});

describe('formatSummary', () => {
  it('shows config, overall, tags and the worst questions with contextRecall', () => {
    const r = report(
      [
        qa('good', [ans({ a: true })], ['t1']),
        qa('bad', [ans({ a: false }, { contextRecall: 0.25 })], ['t1']),
      ],
      cfg({ label: 'mylabel' }),
      true,
    );
    const text = formatSummary(r);
    expect(text).toContain('mylabel');
    expect(text).toContain('qwen2.5:7b');
    expect(text).toContain('partial');
    expect(text).toContain('t1');
    const bad = text.split('\n').find((l) => l.includes('bad'));
    expect(bad).toContain('0.25');
    expect(text.indexOf('bad')).toBeLessThan(text.indexOf('good'));
  });

  it('formats search reports', () => {
    const r = report(
      [scoreQuestion({ id: 's', tags: [], search: [srch(0.5, { fallback: true })] })],
      cfg({ kind: 'search' }),
    );
    const text = formatSummary(r);
    expect(text).toContain('ndcg10');
    expect(text).toContain('fallbacks');
  });
});
