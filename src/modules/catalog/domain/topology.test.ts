import { describe, expect, it } from 'vitest';
import { assembleTopology, linkedSlugsToFetch } from './topology.js';

const doc = (id: string, slug: string, extra: Partial<{ domain: string }> = {}) => ({
  id, slug, summary: `${slug} summary`, entry_type: 'endpoint', domain: extra.domain ?? 'orders', category: null,
});
const link = (from: string, to: string, to_library_id: string | null = null) => ({
  from_document_id: from, to_slug: to, to_library_id, link_type: 'calls', source: 'manual', confidence: null,
});

describe('linkedSlugsToFetch', () => {
  it('returns distinct same-library targets that are not service docs', () => {
    const links = [link('1', 'shared/a'), link('1', 'shared/a'), link('2', 'orders/b'), link('1', 'x/y', 'other-lib'), link('1', 'own/z', 'lib')];
    expect(linkedSlugsToFetch(links, new Set(['orders/b']), 'lib')).toEqual(['shared/a', 'own/z']);
  });
});

describe('assembleTopology', () => {
  it('builds edges inside the graph and keeps only linked docs that have edges', () => {
    const service = [doc('1', 'orders/a'), doc('2', 'orders/b')];
    const linked = [doc('3', 'shared/c', { domain: 'shared' }), doc('4', 'shared/unused', { domain: 'shared' })];
    const links = [link('1', 'orders/b'), link('2', 'shared/c'), link('1', 'missing/x'), link('99', 'orders/a')];
    const t = assembleTopology('orders', 'lib', 'v1', service, links, linked);
    expect(t.service).toBe('orders');
    expect(t.versionId).toBe('v1');
    expect(t.links).toEqual([
      { fromSlug: 'orders/a', toSlug: 'orders/b', linkType: 'calls', source: 'manual', confidence: null },
      { fromSlug: 'orders/b', toSlug: 'shared/c', linkType: 'calls', source: 'manual', confidence: null },
    ]);
    expect(t.documents.map((d) => d.slug)).toEqual(['orders/a', 'orders/b', 'shared/c']);
    expect(t.documents[0]).toEqual({
      slug: 'orders/a', summary: 'orders/a summary', entryType: 'endpoint', domain: 'orders', category: null, libraryId: 'lib',
    });
  });

  it('draws no edge for a link into another library, even when a document of the graph has that slug', () => {
    const service = [doc('1', 'orders/a'), doc('2', 'orders/b')];
    const links = [link('1', 'orders/b', 'other-lib'), link('2', 'orders/a', 'lib')];
    const t = assembleTopology('orders', 'lib', 'v1', service, links, []);
    expect(t.links).toEqual([
      { fromSlug: 'orders/b', toSlug: 'orders/a', linkType: 'calls', source: 'manual', confidence: null },
    ]);
  });
});
