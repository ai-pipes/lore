import { docKey, type ExpectedDoc } from './golden.js';

export interface RankedHit {
  library_id: string;
  slug: string;
  score: number;
}

export interface SearchResponse {
  terms: string;
  total: number;
  groups: { domain: string | null; results: RankedHit[] }[];
}

/** Lore's term extractor falls back to the raw query on an LLM error or timeout. */
export function isTermFallback(terms: string, query: string): boolean {
  return terms.trim().toLowerCase() === query.trim().toLowerCase();
}

/** All group results by score descending (group order breaks ties), one entry per document. */
export function flattenHits(r: SearchResponse): RankedHit[] {
  const all = r.groups.flatMap((g) => g.results);
  // Array.prototype.sort is stable, so equal scores keep group order.
  all.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: RankedHit[] = [];
  for (const h of all) {
    const key = docKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/** Share of grade-2 documents found in the top k; 1 when there are none. */
export function recallAt(hits: RankedHit[], expected: ExpectedDoc[], k: number): number {
  const wanted = expected.filter((e) => e.grade === 2).map(docKey);
  if (wanted.length === 0) return 1;
  const top = new Set(hits.slice(0, k).map(docKey));
  return wanted.filter((w) => top.has(w)).length / wanted.length;
}

/** 1/rank of the first grade-2 document, 0 when absent. */
export function reciprocalRank(hits: RankedHit[], expected: ExpectedDoc[]): number {
  const wanted = new Set(expected.filter((e) => e.grade === 2).map(docKey));
  const i = hits.findIndex((h) => wanted.has(docKey(h)));
  return i < 0 ? 0 : 1 / (i + 1);
}

function dcg(gains: number[]): number {
  return gains.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0);
}

/** nDCG with gain = grade and a log2(rank + 1) discount; 1 when nothing is relevant. */
export function ndcgAt(hits: RankedHit[], expected: ExpectedDoc[], k: number): number {
  const grades = new Map(expected.map((e) => [docKey(e), e.grade]));
  const actual = dcg(hits.slice(0, k).map((h) => grades.get(docKey(h)) ?? 0));
  const ideal = dcg(
    [2, 1]
      .flatMap((g) => expected.filter((e) => e.grade === g).map(() => g))
      .slice(0, k),
  );
  return ideal === 0 ? 1 : actual / ideal;
}

export interface SearchMetrics {
  recall2: number;
  recall5: number;
  mrr: number;
  ndcg10: number;
}

export function searchMetrics(hits: RankedHit[], expected: ExpectedDoc[]): SearchMetrics {
  return {
    recall2: recallAt(hits, expected, 2),
    recall5: recallAt(hits, expected, 5),
    mrr: reciprocalRank(hits, expected),
    ndcg10: ndcgAt(hits, expected, 10),
  };
}
