import { describe, expect, it } from 'vitest';
import type { Document, LibraryScope, LinkedDoc, SearchResult, VectorSearchResult } from '../../catalog/index.js';
import type { DocumentIndex, SearchDeps, VectorQuery } from './ports.js';
import { expandLinks, extractSearchTerms, lookupBySlug, searchDocuments } from './pipeline.js';
import type { SearchOptions } from '../../catalog/index.js';

function hit(library_id: string, slug: string, score: number, domain: string | null = null): SearchResult {
  return { slug, library_id, domain, entry_type: null, http_method: null, route: null, summary: slug, score };
}

function vhit(library_id: string, slug: string, score: number): VectorSearchResult {
  return { documentId: `${library_id}/${slug}`, ...hit(library_id, slug, score) };
}

interface FakeIndex extends DocumentIndex {
  ftsCalls: SearchOptions[];
  vectorCalls: VectorQuery[];
  embedCalls: string[];
  linkScopes: (LibraryScope[] | undefined)[];
}

function fakeIndex(o: {
  fts?: (q: SearchOptions) => SearchResult[];
  vector?: (q: VectorQuery) => VectorSearchResult[];
  embedding?: number[] | null | 'throw';
  docs?: Record<string, Document>;
  links?: LinkedDoc[];
} = {}): FakeIndex {
  const index: FakeIndex = {
    ftsCalls: [],
    vectorCalls: [],
    embedCalls: [],
    linkScopes: [],
    async fullText(query, opts) {
      const q = { query, ...opts };
      index.ftsCalls.push(q);
      return o.fts?.(q) ?? [];
    },
    async vector(_e, q) {
      index.vectorCalls.push(q);
      return o.vector?.(q) ?? [];
    },
    async embed(q) {
      index.embedCalls.push(q);
      if (o.embedding === 'throw') throw new Error('embedding failed');
      return o.embedding === undefined ? null : o.embedding;
    },
    async bySlug(libraryId, slug) {
      return o.docs?.[`${libraryId}/${slug}`] ?? null;
    },
    async linksFrom(_hits, max, scopes) {
      index.linkScopes.push(scopes);
      return (o.links ?? []).slice(0, max);
    },
  };
  return index;
}

function deps(index: DocumentIndex, terms: (q: string) => Promise<string> = async (q) => q): SearchDeps {
  return { index, terms: { extract: terms } };
}

// The fixture of search-pipeline.test.ts: internal (best), external, then a weak match.
const transfers = [hit('service-a', 'transfers/internal', 0.9), hit('service-b', 'transfers/external', 0.8), hit('service-a', 'unrelated/doc', 0.1)];

describe('searchDocuments', () => {
  it('without embeddings runs FTS across all libraries and cuts below topScore × dropFactor', async () => {
    const index = fakeIndex({ fts: () => transfers });
    const results = await searchDocuments(deps(index), 'internal transfer', { dropFactor: 0.8 });
    expect(results.map((r) => r.slug)).toEqual(['transfers/internal', 'transfers/external']);
    expect(index.ftsCalls).toEqual([{ query: 'internal transfer', limit: 50 }]);
    expect(index.vectorCalls).toEqual([]);
  });

  it('the default drop factor comes from the deps (configured by the composition), else 0.80', async () => {
    const index = () => fakeIndex({ fts: () => transfers });
    expect(await searchDocuments(deps(index()), 'internal transfer')).toHaveLength(2);
    expect(await searchDocuments({ ...deps(index()), dropFactor: 0 }, 'internal transfer')).toHaveLength(3);
    expect(await searchDocuments({ ...deps(index()), dropFactor: 0 }, 'internal transfer', { dropFactor: 0.8 })).toHaveLength(2);
  });

  it('a vector query carries only the scope and the size', () => {
    const q: VectorQuery = { library_id: 'a', version_id: 'v', branch: 'main', limit: 5 };
    // @ts-expect-error the vector index ignores full-text filters, so they are not accepted
    const bad: VectorQuery = { domain: 'pets' };
    expect([q, bad]).toHaveLength(2);
  });

  it('dropFactor 0 keeps every FTS hit', async () => {
    const results = await searchDocuments(deps(fakeIndex({ fts: () => transfers })), 'internal transfer', { dropFactor: 0 });
    expect(results).toHaveLength(3);
  });

  it('searches each service with its version filter and merges by score', async () => {
    const index = fakeIndex({
      fts: (q) => (q.library_id === 'service-a' ? [transfers[0], transfers[2]] : [transfers[1]]),
    });
    const results = await searchDocuments(deps(index), 'transfer', {
      services: [{ library_id: 'service-a', version_id: 'v2', branch: 'ignored' }, { library_id: 'service-b', branch: 'dev' }],
      dropFactor: 0,
    });
    expect(results.map((r) => r.slug)).toEqual(['transfers/internal', 'transfers/external', 'unrelated/doc']);
    expect(index.ftsCalls).toEqual([
      { query: 'transfer', library_id: 'service-a', version_id: 'v2', limit: 20 },
      { query: 'transfer', library_id: 'service-b', branch: 'dev', limit: 20 },
    ]);
  });

  it('an empty services list is a cross-library search', async () => {
    const index = fakeIndex({ fts: () => transfers });
    await searchDocuments(deps(index), 'q', { services: [] });
    expect(index.ftsCalls[0]).toEqual({ query: 'q', limit: 50 });
  });

  it('embeds the translated terms when the question is in another language', async () => {
    const index = fakeIndex({ fts: () => transfers, embedding: [1, 0] });
    await searchDocuments(deps(index, async () => 'inventory transfer'), '¿transferencias?');
    expect(index.ftsCalls.map((c) => c.query)).toEqual(['inventory transfer']);
    expect(index.embedCalls).toEqual(['inventory transfer']);
  });

  it('embeds the question when the terms are taken from it', async () => {
    const index = fakeIndex({ fts: () => transfers, embedding: [1, 0] });
    await searchDocuments(deps(index, async () => 'inventory transfer'), 'How do I make an inventory transfer?');
    expect(index.embedCalls).toEqual(['How do I make an inventory transfer?']);
  });

  it('retries FTS with any of the terms when all of them together match nothing', async () => {
    const index = fakeIndex({ fts: (q) => (q.query.includes(' or ') ? transfers : []) });
    const results = await searchDocuments(deps(index, async () => 'cancellation cost'), 'q', { dropFactor: 0 });
    expect(index.ftsCalls.map((c) => c.query)).toEqual(['cancellation cost', 'cancellation or cost']);
    expect(results).toHaveLength(3);
  });

  it('does not retry FTS for a single term or when all terms matched', async () => {
    const single = fakeIndex({ fts: () => [] });
    await searchDocuments(deps(single, async () => 'refund'), 'q');
    expect(single.ftsCalls.map((c) => c.query)).toEqual(['refund']);
    const matched = fakeIndex({ fts: () => transfers });
    await searchDocuments(deps(matched, async () => 'internal transfer'), 'q');
    expect(matched.ftsCalls).toHaveLength(1);
  });

  it('retries per service with the same scope', async () => {
    const index = fakeIndex({ fts: (q) => (q.query.includes(' or ') ? [hit(q.library_id ?? '', 'x', 1)] : []) });
    await searchDocuments(deps(index, async () => 'a b'), 'q', { services: [{ library_id: 'svc', branch: 'main' }] });
    expect(index.ftsCalls).toEqual([
      { query: 'a b', library_id: 'svc', branch: 'main', limit: 20 },
      { query: 'a or b', library_id: 'svc', branch: 'main', limit: 20 },
    ]);
  });

  it('falls back to the query when term extraction throws, and skips it given pre-extracted terms', async () => {
    const index = fakeIndex({ fts: () => transfers });
    await searchDocuments(deps(index, async () => { throw new Error('llm down'); }), 'payment');
    expect(index.ftsCalls[0].query).toBe('payment');
    let called = false;
    await searchDocuments(deps(index, async () => { called = true; return 'x'; }), 'payment', { _preExtractedTerms: 'pre' });
    expect(called).toBe(false);
    expect(index.ftsCalls[1].query).toBe('pre');
  });

  it('fuses FTS and vector hits with RRF (k = 60) and applies no drop factor in hybrid mode', async () => {
    const index = fakeIndex({
      fts: () => [hit('l', 'a', 5), hit('l', 'b', 4)],
      vector: () => [vhit('l', 'c', 0.9), vhit('l', 'a', 0.8)],
      embedding: [1],
    });
    const results = await searchDocuments(deps(index), 'q', { dropFactor: 0.99 });
    expect(results.map((r) => r.slug)).toEqual(['a', 'c', 'b']);
    expect(results[0].score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(results[1].score).toBeCloseTo(1 / 63 + 1 / 61);
    expect(results[2].score).toBeCloseTo(1 / 62 + 1 / 63);
    expect(results[1]).toEqual({ slug: 'c', library_id: 'l', domain: null, entry_type: null, http_method: null, route: null, summary: 'c', score: results[1].score });
    expect(index.vectorCalls).toEqual([{ limit: 50 }]);
  });

  it('hybrid with vector hits only returns them as plain results without a cut', async () => {
    const index = fakeIndex({ vector: () => [vhit('l', 'c', 0.9), vhit('l', 'd', 0.1)], embedding: [1] });
    const results = await searchDocuments(deps(index), 'q');
    expect(results.map((r) => [r.slug, r.score])).toEqual([['c', 0.9], ['d', 0.1]]);
    expect(results[0]).not.toHaveProperty('documentId');
  });

  it('vector mode skips FTS and applies the drop factor', async () => {
    const index = fakeIndex({ fts: () => transfers, vector: () => [vhit('l', 'c', 0.9), vhit('l', 'd', 0.1)], embedding: [1] });
    const results = await searchDocuments(deps(index), 'q', { searchMode: 'vector', dropFactor: 0.5 });
    expect(results.map((r) => r.slug)).toEqual(['c']);
    expect(index.ftsCalls).toEqual([]);
  });

  it('vector search per service uses limit 20 and the service filter', async () => {
    const index = fakeIndex({ vector: (q) => [vhit(q.library_id!, 'x', q.library_id === 'a' ? 0.2 : 0.7)], embedding: [1] });
    const results = await searchDocuments(deps(index), 'q', { services: [{ library_id: 'a' }, { library_id: 'b', branch: 'dev' }] });
    expect(index.vectorCalls).toEqual([{ library_id: 'a', limit: 20 }, { library_id: 'b', branch: 'dev', limit: 20 }]);
    expect(results.map((r) => r.library_id)).toEqual(['b', 'a']);
  });

  it('fts mode never embeds', async () => {
    const index = fakeIndex({ fts: () => transfers, embedding: [1] });
    await searchDocuments(deps(index), 'q', { searchMode: 'fts' });
    expect(index.embedCalls).toEqual([]);
    expect(index.vectorCalls).toEqual([]);
  });

  it('an embedding failure falls back to FTS only, drop factor included', async () => {
    const index = fakeIndex({ fts: () => transfers, embedding: 'throw' });
    const results = await searchDocuments(deps(index), 'q', { dropFactor: 0.8 });
    expect(results.map((r) => r.slug)).toEqual(['transfers/internal', 'transfers/external']);
    expect(index.vectorCalls).toEqual([]);
  });

  it('requested hybrid without a query embedding (failure or no provider) is FTS only', async () => {
    for (const embedding of ['throw', null] as const) {
      const index = fakeIndex({ fts: () => transfers, embedding });
      const results = await searchDocuments(deps(index), 'q', { searchMode: 'hybrid', dropFactor: 0.8 });
      expect(results).toHaveLength(2);
      expect(index.vectorCalls).toEqual([]);
    }
  });

  it('returns [] when nothing matches', async () => {
    expect(await searchDocuments(deps(fakeIndex()), 'xyzzy')).toEqual([]);
  });
});

describe('lookupBySlug', () => {
  const doc = { id: '1', library_id: 'orders', slug: 'create-order/something' } as Document;

  it('finds the document through the first matching slug variant', async () => {
    const index = fakeIndex({ docs: { 'orders/create-order/something': doc } });
    expect(await lookupBySlug(deps(index), 'orders.create-order.something')).toBe(doc);
  });

  it('library_id overrides the one in the text', async () => {
    const index = fakeIndex({ docs: { 'orders/create-order/something': doc } });
    expect(await lookupBySlug(deps(index), 'other.create-order.something', { library_id: 'orders' })).toBe(doc);
    expect(await lookupBySlug(deps(index), 'other.create-order.something')).toBeNull();
  });

  it('returns null for free text', async () => {
    expect(await lookupBySlug(deps(fakeIndex()), 'how do I refund?')).toBeNull();
  });
});

describe('extractSearchTerms and expandLinks', () => {
  it('delegate to the ports', async () => {
    expect(await extractSearchTerms(deps(fakeIndex(), async (q) => `${q}!`), 'q')).toBe('q!');
    const link = { ...hit('l', 'x', 0), link_type: 'calls', from_slug: 'a' } as unknown as LinkedDoc;
    const index = fakeIndex({ links: [link, link] });
    expect(await expandLinks(deps(index), [], { maxLinked: 1 })).toEqual([link]);
    expect(await expandLinks(deps(index), [])).toEqual([link, link]);
    expect(index.linkScopes).toEqual([undefined, undefined]);
  });

  it('expandLinks follows links in the version of each searched service', async () => {
    const index = fakeIndex();
    await expandLinks(deps(index), [], {
      services: [{ library_id: 'a', version_id: 'v2', branch: 'ignored' }, { library_id: 'b', branch: 'dev' }, { library_id: 'c' }],
    });
    expect(index.linkScopes).toEqual([[{ library_id: 'a', version_id: 'v2' }, { library_id: 'b', branch: 'dev' }, { library_id: 'c' }]]);
  });
});
