import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { versionCondition } from '../../modules/catalog/infrastructure/version-filter.js';
import { searchDocs, findByAnyMetadataKey, FIND_BY_METADATA_LIMIT, getLibraryOverview, listServices, vectorSearch } from '../../modules/catalog/infrastructure/pg-document-search.js';
import { getDocumentBySlug, insertDocument, insertDocumentBatch } from '../../modules/catalog/infrastructure/pg-documents.js';
import { createVersion } from '../../modules/catalog/infrastructure/pg-versions.js';
import { getEmbeddingProvider } from '../../modules/catalog/infrastructure/embeddings/EmbeddingProvider.js';
import { versions } from '../../modules/catalog/infrastructure/schema.js';
import { getDb } from '../../platform/db.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
  await createTestVersion();
});

describe('searchDocs (FTS)', () => {
  it('finds documents by content word', async () => {
    await insertDocument({
      library_id: 'test-lib',
      version_id: 'v1',
      slug: 'api/payment',
      content: 'This handler processes payment transactions and refunds.',
      summary: 'Payment processing',
    });
    await insertDocument({
      library_id: 'test-lib',
      version_id: 'v1',
      slug: 'api/shipping',
      content: 'Manages shipment tracking and delivery status.',
      summary: 'Shipping handler',
    });

    const results = await searchDocs({ query: 'payment', library_id: 'test-lib' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].slug).toBe('api/payment');
  });

  it('ranks the page whose slug and summary name the terms above a long page that only mentions them', async () => {
    const filler = 'The delivery is confirmed and the delivery status is stored for the delivery record. '.repeat(40);
    await insertDocument({
      library_id: 'test-lib',
      version_id: 'v1',
      slug: 'notifications/on-delivery-completed',
      content: `${filler} The e-mail shows the estimated time of the next delivery. ${filler}`,
      summary: 'Sends the delivery completed e-mail',
    });
    await insertDocument({
      library_id: 'test-lib',
      version_id: 'v1',
      slug: 'tracking/get-eta',
      content: 'GET /api/v1/orders/{order_id}/eta returns the estimate for an order.',
      summary: 'Returns the estimated delivery time of an order',
    });

    const results = await searchDocs({ query: 'estimated delivery time', library_id: 'test-lib' });
    expect(results.map((r) => r.slug)).toEqual(['tracking/get-eta', 'notifications/on-delivery-completed']);
  });

  it('returns empty array for no matches', async () => {
    await insertDocument({
      library_id: 'test-lib',
      version_id: 'v1',
      slug: 'api/foo',
      content: 'Completely unrelated content about apples.',
    });

    const results = await searchDocs({ query: 'xyznotaword', library_id: 'test-lib' });
    expect(results).toHaveLength(0);
  });

  it('minScore drops hits below the threshold', async () => {
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'api/high', content: 'payment payment payment refunds.' });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'api/low', content: 'One payment among many unrelated words about shipping, tracking, delivery and warehouses.' });

    const all = await searchDocs({ query: 'payment', library_id: 'test-lib', minScore: 0 });
    expect(all).toHaveLength(2);
    const scores = all.map((r) => r.score);
    const top = Math.max(...scores);
    const bottom = Math.min(...scores);
    expect(bottom).toBeLessThan(top);

    expect(await searchDocs({ query: 'payment', library_id: 'test-lib', minScore: top + 0.001 })).toEqual([]);

    const mid = (top + bottom) / 2;
    const some = await searchDocs({ query: 'payment', library_id: 'test-lib', minScore: mid });
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(all.length);
    expect(some.every((r) => r.score >= mid)).toBe(true);
    expect(some.map((r) => r.slug)).toEqual(['api/high']);
  });

  it('filters by domain', async () => {
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'a', content: 'invoice payment', domain: 'billing' });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'b', content: 'invoice payment', domain: 'orders' });

    const results = await searchDocs({ query: 'invoice', library_id: 'test-lib', domain: 'billing' });
    expect(results.every((r) => r.domain === 'billing')).toBe(true);
  });
});

describe('findByAnyMetadataKey', () => {
  it('finds documents by metadata key/value', async () => {
    await insertDocument({
      library_id: 'test-lib',
      version_id: 'v1',
      slug: 'handler/order',
      content: '# Order handler',
      metadata: [{ key: 'dal_interface', value: 'IOrderDal' }],
    });
    await insertDocument({
      library_id: 'test-lib',
      version_id: 'v1',
      slug: 'handler/product',
      content: '# Product handler',
      metadata: [{ key: 'dal_interface', value: 'IProductDal' }],
    });

    const docs = await findByAnyMetadataKey({ dal_interface: 'IOrderDal' }, 'test-lib');
    expect(docs).toHaveLength(1);
    expect(docs[0].slug).toBe('handler/order');
  });

  it('returns empty array when no keys provided', async () => {
    const docs = await findByAnyMetadataKey({}, 'test-lib');
    expect(docs).toHaveLength(0);
  });

  it('matches any of multiple keys (OR logic)', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'h/a', content: 'a',
      metadata: [{ key: 'table_name', value: 'orders' }],
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'h/b', content: 'b',
      metadata: [{ key: 'table_name', value: 'products' }],
    });

    const docs = await findByAnyMetadataKey({ table_name: 'orders' }, 'test-lib');
    expect(docs).toHaveLength(1);
  });

  it('returns each document once, as a summary without its content', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'h/both', content: 'big body', summary: 'S', domain: 'orders',
      metadata: [{ key: 'table_name', value: 'orders' }, { key: 'dal_interface', value: 'IOrderDal' }],
    });
    const docs = await findByAnyMetadataKey({ table_name: 'orders', dal_interface: 'IOrderDal' }, 'test-lib');
    expect(docs).toEqual([{
      id: expect.any(String), slug: 'h/both', library_id: 'test-lib', domain: 'orders', entry_type: null, summary: 'S',
    }]);
  });

  it('caps the number of results', async () => {
    await insertDocumentBatch(Array.from({ length: FIND_BY_METADATA_LIMIT + 5 }, (_, i) => ({
      library_id: 'test-lib', version_id: 'v1', slug: `t/${String(i).padStart(4, '0')}`, content: 'x',
      metadata: [{ key: 'table_name' as const, value: 'orders' }],
    })));
    const docs = await findByAnyMetadataKey({ table_name: 'orders' }, 'test-lib');
    expect(docs).toHaveLength(FIND_BY_METADATA_LIMIT);
    expect(docs[0].slug).toBe('t/0000');
  });
});

describe('getLibraryOverview', () => {
  it('returns domain/entry_type breakdown', async () => {
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'a', content: 'x', domain: 'billing', entry_type: 'handler' });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'b', content: 'x', domain: 'billing', entry_type: 'handler' });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'c', content: 'x', domain: 'orders', entry_type: 'event' });

    const overview = await getLibraryOverview('test-lib');
    const billing = overview.find((r) => r.domain === 'billing' && r.entry_type === 'handler');
    expect(billing?.count).toBe(2);
    expect(overview).toHaveLength(2);
  });
});

describe('branch filter resolves to the newest version of the branch', () => {
  async function setPushedAt(lib: string, version: string, at: string) {
    await getDb().update(versions).set({ pushed_at: at }).where(and(eq(versions.library_id, lib), eq(versions.id, version)));
  }

  // `older` holds `a` OLD and `gone`; `newer` (pushed later) holds only `a` NEW.
  async function pushBranch(lib: string, older: string, newer: string) {
    await createVersion(older, lib, 'feat');
    await insertDocument({ library_id: lib, version_id: older, slug: 'a', content: 'Widget handler old.', summary: 'OLD' });
    await insertDocument({ library_id: lib, version_id: older, slug: 'gone', content: 'Widget handler removed.', summary: 'GONE' });
    await createVersion(newer, lib, 'feat');
    await insertDocument({ library_id: lib, version_id: newer, slug: 'a', content: 'Widget handler new.', summary: 'NEW' });
    await setPushedAt(lib, older, '2026-01-01 00:00:00');
    await setPushedAt(lib, newer, '2026-02-01 00:00:00');
  }

  it('full-text search sees only the branch head', async () => {
    await pushBranch('test-lib', 'b1', 'b2');
    const results = await searchDocs({ query: 'widget', library_id: 'test-lib', branch: 'feat' });
    expect(results.map((r) => [r.slug, r.summary])).toEqual([['a', 'NEW']]);
  });

  it('vector search sees only the branch head', async () => {
    await pushBranch('test-lib', 'b1', 'b2');
    const emb = await getEmbeddingProvider()!.embed('Widget handler');
    const results = await vectorSearch(emb, { library_id: 'test-lib', branch: 'feat' }, 10);
    expect(results.map((r) => [r.slug, r.summary])).toEqual([['a', 'NEW']]);
  });

  it('a document lookup by branch returns the head version', async () => {
    await pushBranch('test-lib', 'b1', 'b2');
    expect((await getDocumentBySlug('test-lib', 'a', { branch: 'feat' }))?.summary).toBe('NEW');
    expect(await getDocumentBySlug('test-lib', 'gone', { branch: 'feat' })).toBeUndefined();
  });

  it('breaks a pushed_at tie by the greater version id', async () => {
    await pushBranch('test-lib', 'b1', 'b2');
    await setPushedAt('test-lib', 'b1', '2026-03-01 00:00:00');
    await setPushedAt('test-lib', 'b2', '2026-03-01 00:00:00');
    expect((await getDocumentBySlug('test-lib', 'a', { branch: 'feat' }))?.summary).toBe('NEW');
  });

  it('a newer version of the branch that holds no documents yet (a push in progress or failed) is not the head', async () => {
    await pushBranch('test-lib', 'b1', 'b2');
    await createVersion('b3', 'test-lib', 'feat');
    await setPushedAt('test-lib', 'b3', '2026-03-01 00:00:00');
    expect((await getDocumentBySlug('test-lib', 'a', { branch: 'feat' }))?.summary).toBe('NEW');
    const results = await searchDocs({ query: 'widget', library_id: 'test-lib', branch: 'feat' });
    expect(results.map((r) => [r.slug, r.summary])).toEqual([['a', 'NEW']]);
  });

  it('computes the heads once for all libraries, not once per joined row', async () => {
    const plan = (await getDb().execute(sql`
      EXPLAIN SELECT documents.id FROM documents
      JOIN versions ON versions.id = documents.version_id AND versions.library_id = documents.library_id
      WHERE ${versionCondition({ branch: 'feat' })}`)) as unknown as { 'QUERY PLAN': string }[];
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).not.toMatch(/SubPlan/);
  });

  it('has an index that serves the branch head lookup', async () => {
    const rows = (await getDb().execute(
      sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'versions' AND indexname = 'idx_versions_branch_head'`,
    )) as unknown as { indexdef: string }[];
    expect(rows[0]?.indexdef).toMatch(/\(branch, library_id, pushed_at DESC, id DESC\)/);
  });

  it('each library resolves its own branch head', async () => {
    await createTestLibrary('other-lib', 'Other');
    await pushBranch('test-lib', 'b1', 'b2');
    await pushBranch('other-lib', 'c2', 'c1'); // the head here is c1, by pushed_at
    const results = await searchDocs({ query: 'widget', branch: 'feat' });
    expect(results.map((r) => `${r.library_id}/${r.slug}/${r.summary}`).sort()).toEqual(['other-lib/a/NEW', 'test-lib/a/NEW']);
  });
});

describe('listServices', () => {
  // The chat scope selector lists these and sends the ids as library_ids, so they are libraries, not domains
  it('lists libraries with their display name and document count in the current version', async () => {
    await createTestLibrary('orders-service', 'Orders Service');
    await createTestVersion('orders-service', 'o1');
    await createTestLibrary('empty-lib', 'Empty');
    await createTestVersion('empty-lib', 'e1');
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'a', content: 'a', domain: 'billing' });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'b', content: 'b', domain: 'orders' });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'c', content: 'c' });
    await insertDocument({ library_id: 'orders-service', version_id: 'o1', slug: 'x', content: 'x', domain: 'orders' });

    expect(await listServices()).toEqual([
      { id: 'test-lib', display_name: 'Test Library', doc_count: 3 },
      { id: 'orders-service', display_name: 'Orders Service', doc_count: 1 },
    ]);
    expect(await listServices('orders-service')).toEqual([
      { id: 'orders-service', display_name: 'Orders Service', doc_count: 1 },
    ]);
  });

  it('counts the documents of the requested branch head', async () => {
    await createVersion('f1', 'test-lib', 'feature/x');
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'a', content: 'a' });
    await insertDocument({ library_id: 'test-lib', version_id: 'f1', slug: 'a', content: 'a' });
    await insertDocument({ library_id: 'test-lib', version_id: 'f1', slug: 'b', content: 'b' });

    expect(await listServices(undefined, { branch: 'feature/x' })).toEqual([
      { id: 'test-lib', display_name: 'Test Library', doc_count: 2 },
    ]);
  });
});
