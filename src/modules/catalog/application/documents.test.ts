import { describe, expect, it, vi } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { DocumentExistsError } from '../domain/document.js';
import {
  cloneVersion,
  deleteDocument,
  existingCurrentDocuments,
  getDocumentBySlug,
  getDocumentsByIds,
  ingestBulk,
  ingestDocument,
  insertDocument,
  listDocuments,
  MAX_LIST_LIMIT,
  versionDocumentHashes,
} from './documents.js';
import { ensureLibraryVersion } from './libraries.js';
import { createEnrichmentScheduler } from './enrichment.js';

async function setup() {
  const fake = createFakeCatalog();
  await fake.deps.libraries.upsert('orders-api', 'Orders');
  await fake.deps.versions.create('v1', 'orders-api');
  await fake.deps.versions.promote('orders-api', 'v1');
  return fake;
}

describe('ingestDocument', () => {
  it('stores the document with metadata extracted from its content', async () => {
    const { deps, state } = await setup();
    const inserted: unknown[] = [];
    const insert = deps.documents.insert;
    deps.documents.insert = (input, opts) => (inserted.push(input), insert(input, opts));
    const doc = await ingestDocument(deps, {
      library_id: 'orders-api', version_id: 'v1', slug: 'orders/create', content: 'Reads FROM orders',
    });
    expect(doc.slug).toBe('orders/create');
    expect(state.documents).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ metadata: [{ key: 'table_name', value: 'orders' }] });
  });
});

describe('ingestBulk', () => {
  it('inserts all documents with extracted metadata and enriches each with every slug of the version', async () => {
    const { deps, state } = await setup();
    await deps.documents.insert({ library_id: 'orders-api', version_id: 'v1', slug: 'existing', content: 'x' });
    state.suggestions = [{ toSlug: 'existing', linkType: 'references', confidence: 0.9 }];
    const batches: unknown[][] = [];
    const insertBatch = deps.documents.insertBatch;
    deps.documents.insertBatch = (inputs) => (batches.push(inputs), insertBatch(inputs));

    const { documents, enrichment } = await ingestBulk(
      deps, 'orders-api', 'v1',
      [{ slug: 'a', content: 'uses IOrderRepository' }, { slug: 'b', content: 'plain', links: [{ slug: 'a', type: 'references' }] }],
      { enrich: true, scheduler: createEnrichmentScheduler(deps, { quietMs: 0 }) },
    );
    await enrichment;

    expect(documents.map((d) => d.slug)).toEqual(['a', 'b']);
    expect(batches[0]).toMatchObject([
      { library_id: 'orders-api', version_id: 'v1', slug: 'a', metadata: [{ key: 'dal_interface', value: 'IOrderRepository' }] },
      { slug: 'b', metadata: [] },
    ]);
    expect(state.suggestCalls.map((c) => c.slug)).toEqual(['a', 'b']);
    expect(state.suggestCalls[0].knownSlugs.sort()).toEqual(['a', 'b', 'existing']);
    const bLinks = await deps.documents.linksOf(documents[1].id);
    expect(bLinks.map((l) => `${l.source}:${l.toSlug}`)).toEqual(['manual:a', 'auto:existing']);
  });

  it('does not enrich when asked not to', async () => {
    const { deps, state } = await setup();
    state.suggestions = [];
    const { enrichment } = await ingestBulk(deps, 'orders-api', 'v1', [{ slug: 'a', content: 'x' }], { enrich: false });
    await enrichment;
    expect(state.suggestCalls).toEqual([]);
  });
});

describe('ingestBulk enrichment across batches', () => {
  it('lets a document of an early batch link to documents of later batches of the same push', async () => {
    const { deps, state } = await setup();
    state.suggestions = [{ toSlug: 'b/later', linkType: 'references', confidence: 0.9 }];
    const scheduler = createEnrichmentScheduler(deps, { quietMs: 30 });
    const first = await ingestBulk(deps, 'orders-api', 'v1', [{ slug: 'a/early', content: 'x' }], { enrich: true, scheduler });
    const second = await ingestBulk(deps, 'orders-api', 'v1', [{ slug: 'b/later', content: 'y' }], { enrich: true, scheduler });
    await Promise.all([first.enrichment, second.enrichment]);

    const early = state.suggestCalls.find((c) => c.slug === 'a/early')!;
    expect(early.knownSlugs.sort()).toEqual(['a/early', 'b/later']);
    const links = await deps.documents.linksOf(first.documents[0].id);
    expect(links.map((l) => `${l.source}:${l.toSlug}`)).toEqual(['auto:b/later']);
  });

  it('runs at most `concurrency` link suggestions at a time', async () => {
    const { deps, state } = await setup();
    state.suggestions = [];
    let running = 0;
    let peak = 0;
    deps.links.suggest = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return [];
    };
    const scheduler = createEnrichmentScheduler(deps, { quietMs: 0, concurrency: 4 });
    const items = Array.from({ length: 20 }, (_, i) => ({ slug: `d/${i}`, content: 'x' }));
    const { enrichment } = await ingestBulk(deps, 'orders-api', 'v1', items, { enrich: true, scheduler });
    await enrichment;
    expect(peak).toBe(4);
  });

  it('settles and logs when the slugs of the version cannot be read', async () => {
    const { deps, state } = await setup();
    state.suggestions = [];
    deps.documents.hashes = () => Promise.reject(new Error('db down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scheduler = createEnrichmentScheduler(deps, { quietMs: 0 });
    const { enrichment } = await ingestBulk(deps, 'orders-api', 'v1', [{ slug: 'a', content: 'x' }], { enrich: true, scheduler });
    await enrichment;
    expect(state.suggestCalls).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not schedule anything when no link suggester is configured', async () => {
    const { deps, state } = await setup();
    const { enrichment } = await ingestBulk(deps, 'orders-api', 'v1', [{ slug: 'a', content: 'x' }], { enrich: true });
    await enrichment;
    expect(state.suggestCalls).toEqual([]);
  });
});

describe('insertDocument / getDocumentBySlug / listDocuments / deleteDocument', () => {
  it('passes onConflict through and reports an existing slug', async () => {
    const { deps } = await setup();
    const input = { library_id: 'orders-api', version_id: 'v1', slug: 's', content: 'one' };
    await insertDocument(deps, input);
    await expect(insertDocument(deps, { ...input, content: 'two' }, { onConflict: 'error' })).rejects.toBeInstanceOf(
      DocumentExistsError,
    );
    expect((await insertDocument(deps, { ...input, content: 'three' })).content).toBe('three');
  });

  it('returns null for a missing slug and the document otherwise', async () => {
    const { deps } = await setup();
    expect(await getDocumentBySlug(deps, 'orders-api', 'nope')).toBeNull();
    const doc = await insertDocument(deps, { library_id: 'orders-api', version_id: 'v1', slug: 's', content: 'c' });
    expect((await getDocumentBySlug(deps, 'orders-api', 's'))?.id).toBe(doc.id);
    expect((await getDocumentsByIds(deps, [doc.id])).map((d) => d.slug)).toEqual(['s']);
    expect(await listDocuments(deps, { library_id: 'orders-api' })).toHaveLength(1);
    expect(await deleteDocument(deps, 'orders-api', 'v1', 's')).toBe(true);
    expect(await deleteDocument(deps, 'orders-api', 'v1', 's')).toBe(false);
  });
});

describe('listDocuments paging', () => {
  it('clamps the limit to MAX_LIST_LIMIT and passes a smaller one through', async () => {
    const { deps } = await setup();
    const seen: (number | undefined)[] = [];
    const list = deps.documents.list;
    deps.documents.list = (opts) => (seen.push(opts.limit), list(opts));
    await listDocuments(deps, { library_id: 'orders-api', limit: MAX_LIST_LIMIT * 10 });
    await listDocuments(deps, { library_id: 'orders-api', limit: 5 });
    await listDocuments(deps, { library_id: 'orders-api' });
    expect(seen).toEqual([MAX_LIST_LIMIT, 5, undefined]);
  });
});

describe('versionDocumentHashes', () => {
  it('returns every slug and content hash of exactly that version', async () => {
    const { deps } = await setup();
    await deps.versions.create('v2', 'orders-api');
    for (let i = 0; i < 150; i++) await insertDocument(deps, { library_id: 'orders-api', version_id: 'v1', slug: `s${i}`, content: 'c' });
    await insertDocument(deps, { library_id: 'orders-api', version_id: 'v2', slug: 'other', content: 'c' });
    const hashes = await versionDocumentHashes(deps, 'orders-api', 'v1');
    expect(hashes).toHaveLength(150);
    expect(hashes[0]).toEqual({ slug: 's0', content_hash: expect.any(String) });
  });
});

describe('existingCurrentDocuments', () => {
  it('returns the library/slug keys present in current versions, and skips the lookup for no refs', async () => {
    const { deps } = await setup();
    await insertDocument(deps, { library_id: 'orders-api', version_id: 'v1', slug: 'a', content: 'c' });
    const found = await existingCurrentDocuments(deps, [
      { library: 'orders-api', slug: 'a' },
      { library: 'orders-api', slug: 'missing' },
    ]);
    expect([...found]).toEqual(['orders-api/a']);
    deps.documents.existingCurrent = () => Promise.reject(new Error('must not be called'));
    expect([...(await existingCurrentDocuments(deps, []))]).toEqual([]);
  });
});

describe('cloneVersion', () => {
  it('copies documents and images of the source version', async () => {
    const { deps, state } = await setup();
    await deps.versions.create('v2', 'orders-api');
    await insertDocument(deps, { library_id: 'orders-api', version_id: 'v1', slug: 'a', content: 'c' });
    await insertDocument(deps, { library_id: 'orders-api', version_id: 'v1', slug: 'b', content: 'c' });
    await insertDocument(deps, { library_id: 'orders-api', version_id: 'v2', slug: 'b', content: 'new' });
    await deps.images.upsert('orders-api', 'v1', 'a', 'x.png', 3, 'h', 'image/png');
    expect(await cloneVersion(deps, 'orders-api', 'v2', 'v1')).toEqual({ cloned: 1 });
    expect(state.documents.filter((d) => d.version_id === 'v2').map((d) => d.slug).sort()).toEqual(['a', 'b']);
    expect(state.documents.find((d) => d.version_id === 'v2' && d.slug === 'b')?.content).toBe('new');
    expect(state.images.filter((i) => i.version_id === 'v2')).toHaveLength(1);
  });

  it('reports an unknown library', async () => {
    const { deps } = await setup();
    expect(await cloneVersion(deps, 'nope', 'v2', 'v1')).toBe('library_not_found');
  });
});

describe('ensureLibraryVersion', () => {
  it('creates the library and promotes the version on first use', async () => {
    const { deps, state } = createFakeCatalog();
    expect(await ensureLibraryVersion(deps, 'insights', 'Insights', 'insights')).toEqual({
      library_id: 'insights', version_id: 'insights',
    });
    expect(state.libraries.get('insights')?.display_name).toBe('Insights');
    expect(state.versions).toMatchObject([{ id: 'insights', library_id: 'insights', is_current: true }]);
  });

  it('returns the current version of an existing library unchanged', async () => {
    const { deps, state } = await setup();
    expect(await ensureLibraryVersion(deps, 'orders-api', 'Other name', 'insights')).toEqual({
      library_id: 'orders-api', version_id: 'v1',
    });
    expect(state.libraries.get('orders-api')?.display_name).toBe('Orders');
    expect(state.versions).toHaveLength(1);
  });

  it('creates the version for an existing library without a current one', async () => {
    const { deps } = createFakeCatalog();
    await deps.libraries.upsert('insights', 'Mine');
    expect(await ensureLibraryVersion(deps, 'insights', 'Insights', 'insights')).toEqual({
      library_id: 'insights', version_id: 'insights',
    });
    expect((await deps.libraries.get('insights'))?.display_name).toBe('Mine');
  });
});
