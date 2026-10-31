import { describe, expect, it } from 'vitest';
import { groupByDomain } from './grouping.js';

describe('groupByDomain', () => {
  it('groups hits by domain in first-seen order, null domains in one group', () => {
    const hits = [
      { slug: 'a', domain: 'orders' },
      { slug: 'b', domain: null },
      { slug: 'c', domain: 'orders' },
      { slug: 'd', domain: 'pets' },
      { slug: 'e', domain: null },
    ];
    expect(groupByDomain(hits)).toEqual([
      { domain: 'orders', doc_count: 2, results: [hits[0], hits[2]] },
      { domain: null, doc_count: 2, results: [hits[1], hits[4]] },
      { domain: 'pets', doc_count: 1, results: [hits[3]] },
    ]);
  });

  it('returns no groups for no hits', () => {
    expect(groupByDomain([])).toEqual([]);
  });
});
