import type { SearchHit, VectorHit } from './ports.js';

/** Reciprocal-rank contribution of a 1-based rank. */
export function rrfRank(rank: number, k = 60): number {
  return 1 / (k + rank);
}

/**
 * Reciprocal Rank Fusion of full-text and vector hits. A hit missing from one list ranks just
 * after that list's last hit. Metadata comes from the FTS hit when both have it.
 */
export function rrfFusion(ftsResults: SearchHit[], vectorResults: VectorHit[]): SearchHit[] {
  const ftsRankMap = new Map<string, number>();
  ftsResults.forEach((r, i) => ftsRankMap.set(`${r.library_id}::${r.slug}`, i + 1));

  const vectorRankMap = new Map<string, { rank: number; result: VectorHit }>();
  vectorResults.forEach((r, i) => vectorRankMap.set(`${r.library_id}::${r.slug}`, { rank: i + 1, result: r }));

  const allKeys = new Set([...ftsRankMap.keys(), ...vectorRankMap.keys()]);
  const ftsMetaMap = new Map(ftsResults.map((r) => [`${r.library_id}::${r.slug}`, r]));

  const fused = [...allKeys].map((key) => {
    const ftsRank = ftsRankMap.get(key) ?? ftsResults.length + 1;
    const vecEntry = vectorRankMap.get(key);
    const vecRank = vecEntry?.rank ?? vectorResults.length + 1;
    const rrfScore = rrfRank(ftsRank) + rrfRank(vecRank);

    const ftsMeta = ftsMetaMap.get(key);
    const vecMeta = vecEntry?.result;

    return {
      slug: ftsMeta?.slug ?? vecMeta!.slug,
      library_id: ftsMeta?.library_id ?? vecMeta!.library_id,
      domain: ftsMeta?.domain ?? vecMeta?.domain ?? null,
      entry_type: ftsMeta?.entry_type ?? vecMeta?.entry_type ?? null,
      http_method: ftsMeta?.http_method ?? vecMeta?.http_method ?? null,
      route: ftsMeta?.route ?? vecMeta?.route ?? null,
      summary: ftsMeta?.summary ?? vecMeta?.summary ?? null,
      score: rrfScore,
    };
  });

  return fused.sort((a, b) => b.score - a.score);
}
