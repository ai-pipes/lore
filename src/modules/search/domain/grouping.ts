export interface DomainGroup<T> {
  domain: string | null;
  doc_count: number;
  results: T[];
}

/** Groups search hits by their domain, in first-seen order; hits without a domain form one group. */
export function groupByDomain<T extends { domain: string | null }>(hits: T[]): DomainGroup<T>[] {
  const groupMap = new Map<string, T[]>();
  for (const h of hits) {
    const key = h.domain ?? '_ungrouped';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(h);
  }
  return Array.from(groupMap.entries()).map(([domain, results]) => ({
    domain: domain === '_ungrouped' ? null : domain,
    doc_count: results.length,
    results,
  }));
}
