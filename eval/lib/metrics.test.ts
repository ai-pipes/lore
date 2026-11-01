import { describe, expect, it } from 'vitest';
import {
  flattenHits,
  isTermFallback,
  ndcgAt,
  recallAt,
  reciprocalRank,
  searchMetrics,
  type RankedHit,
  type SearchResponse,
} from './metrics.js';

const hit = (library_id: string, slug: string, score = 0): RankedHit => ({ library_id, slug, score });

describe('flattenHits', () => {
  it('sorts by score desc, with group order breaking ties', () => {
    const r: SearchResponse = {
      terms: 't',
      total: 3,
      groups: [
        { domain: 'a', results: [hit('l', 'x', 0.9), hit('l', 'y', 0.5)] },
        { domain: 'b', results: [hit('l', 'z', 0.7)] },
      ],
    };
    expect(flattenHits(r).map((h) => h.slug)).toEqual(['x', 'z', 'y']);
    const tie: SearchResponse = {
      terms: 't',
      total: 2,
      groups: [
        { domain: 'a', results: [hit('l', 'a1', 0.5)] },
        { domain: 'b', results: [hit('l', 'b1', 0.5)] },
      ],
    };
    expect(flattenHits(tie).map((h) => h.slug)).toEqual(['a1', 'b1']);
  });

  it('keeps the highest-score occurrence of a duplicate key', () => {
    const r: SearchResponse = {
      terms: 't',
      total: 3,
      groups: [
        { domain: 'a', results: [hit('l', 'x', 0.2)] },
        { domain: null, results: [hit('l', 'x', 0.8), hit('l', 'y', 0.5)] },
      ],
    };
    const flat = flattenHits(r);
    expect(flat.map((h) => h.slug)).toEqual(['x', 'y']);
    expect(flat[0]?.score).toBe(0.8);
  });
});

describe('metrics', () => {
  const expected = [
    { library_id: 'l', slug: 'p', grade: 2 as const },
    { library_id: 'l', slug: 's', grade: 1 as const },
  ];
  const hits = [hit('l', 'q'), hit('l', 'p'), hit('l', 's')];

  it('computes recall, reciprocal rank and nDCG', () => {
    expect(recallAt(hits, expected, 2)).toBe(1);
    expect(recallAt(hits, expected, 1)).toBe(0);
    expect(reciprocalRank(hits, expected)).toBe(0.5);
    const ideal = 2 / Math.log2(2) + 1 / Math.log2(3);
    const actual = 2 / Math.log2(3) + 1 / Math.log2(4);
    expect(ndcgAt(hits, expected, 10)).toBeCloseTo(actual / ideal, 6);
  });

  it('treats missing positions as misses and empty hits as zero', () => {
    expect(recallAt([hit('l', 'q')], expected, 5)).toBe(0);
    expect(searchMetrics([], expected)).toEqual({ recall2: 0, recall5: 0, mrr: 0, ndcg10: 0 });
  });

  it('recall is 1 without grade-2 docs; nDCG is 1 without relevant docs', () => {
    expect(recallAt(hits, [{ library_id: 'l', slug: 's', grade: 1 }], 2)).toBe(1);
    expect(ndcgAt(hits, [], 10)).toBe(1);
  });

  it('searchMetrics bundles all four', () => {
    const m = searchMetrics(hits, expected);
    expect(m.recall2).toBe(1);
    expect(m.recall5).toBe(1);
    expect(m.mrr).toBe(0.5);
  });
});

describe('isTermFallback', () => {
  it('is true when the extractor returned the query itself (case and padding ignored)', () => {
    expect(isTermFallback(' How is the price calculated? ', 'how is the price calculated?')).toBe(true);
  });
  it('is false for extracted terms', () => {
    expect(isTermFallback('delivery price calculation', 'How is the delivery price calculated?')).toBe(false);
  });
});
