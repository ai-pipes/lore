import { describe, it, expect, beforeEach } from 'vitest';
import {
  insertDocument,
  listDocuments,
  deleteDocument,
  getDocumentBySlug,
  listDocumentHashes,
  cloneVersionDocs,
  computeDocHash,
  insertDocumentBatch,
} from '../../modules/catalog/infrastructure/pg-documents.js';
import { sql } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import { cleanDb, createTestLibrary, createTestVersion, createTestDocument } from '../helpers.js';

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
  await createTestVersion();
});

describe('computeDocHash', () => {
  it('is deterministic', () => {
    const a = computeDocHash({ slug: 'foo', content: 'bar\r\n' });
    const b = computeDocHash({ slug: 'foo', content: 'bar\n' });
    expect(a).toBe(b);
  });

  it('changes when content changes', () => {
    const a = computeDocHash({ slug: 'foo', content: 'aaa' });
    const b = computeDocHash({ slug: 'foo', content: 'bbb' });
    expect(a).not.toBe(b);
  });

  it('changes when category changes', () => {
    const a = computeDocHash({ slug: 'foo', content: 'bar', category: 'architecture' });
    const b = computeDocHash({ slug: 'foo', content: 'bar', category: 'decision' });
    expect(a).not.toBe(b);
  });

  it('changes when links change', () => {
    const a = computeDocHash({ slug: 'foo', content: 'bar', links: [] });
    const b = computeDocHash({ slug: 'foo', content: 'bar', links: [{ slug: 'other/doc', type: 'calls' }] });
    expect(a).not.toBe(b);
  });

  it('hash is stable regardless of link order', () => {
    const a = computeDocHash({ slug: 'foo', content: 'bar', links: [
      { slug: 'a/b', type: 'calls' }, { slug: 'c/d', type: 'references' },
    ] });
    const b = computeDocHash({ slug: 'foo', content: 'bar', links: [
      { slug: 'c/d', type: 'references' }, { slug: 'a/b', type: 'calls' },
    ] });
    expect(a).toBe(b);
  });
});

describe('insertDocument', () => {
  it('creates a document', async () => {
    const doc = await insertDocument({
      library_id: 'test-lib',
      version_id: 'v1',
      slug: 'api/orders',
      content: '# Orders API',
      domain: 'orders',
      entry_type: 'handler',
      summary: 'Manages orders',
    });

    expect(doc.slug).toBe('api/orders');
    expect(doc.domain).toBe('orders');
    expect(doc.content_hash).toBeTruthy();
  });

  it('upserts on (library_id, version_id, slug) conflict', async () => {
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'api/foo', content: 'v1' });
    const updated = await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'api/foo', content: 'v2' });
    expect(updated.content).toBe('v2');

    const docs = await listDocuments({ library_id: 'test-lib' });
    expect(docs).toHaveLength(1);
  });

  it('stores metadata', async () => {
    const doc = await insertDocument({
      library_id: 'test-lib',
      version_id: 'v1',
      slug: 'api/bar',
      content: '# Bar',
      metadata: [
        { key: 'dal_interface', value: 'IBarDal' },
        { key: 'table_name', value: 'bars' },
      ],
    });
    expect(doc.id).toBeTruthy();
  });
});

describe('getDocumentBySlug', () => {
  it('returns document from current version', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'api/slug-test' });
    const doc = await getDocumentBySlug('test-lib', 'api/slug-test');
    expect(doc?.slug).toBe('api/slug-test');
  });

  it('returns undefined for wrong slug', async () => {
    const doc = await getDocumentBySlug('test-lib', 'api/no-such');
    expect(doc).toBeUndefined();
  });
});

describe('listDocuments', () => {
  it('filters by domain', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'a', domain: 'payments' });
    await createTestDocument('test-lib', 'v1', { slug: 'b', domain: 'orders' });
    await createTestDocument('test-lib', 'v1', { slug: 'c', domain: 'payments' });

    const docs = await listDocuments({ library_id: 'test-lib', domain: 'payments' });
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.domain === 'payments')).toBe(true);
  });

  it('filters by entry_type', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'h1', entry_type: 'handler' });
    await createTestDocument('test-lib', 'v1', { slug: 'h2', entry_type: 'handler' });
    await createTestDocument('test-lib', 'v1', { slug: 'e1', entry_type: 'event' });

    const handlers = await listDocuments({ library_id: 'test-lib', entry_type: 'handler' });
    expect(handlers).toHaveLength(2);
  });

  it('respects limit and offset', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'p1' });
    await createTestDocument('test-lib', 'v1', { slug: 'p2' });
    await createTestDocument('test-lib', 'v1', { slug: 'p3' });

    const page1 = await listDocuments({ library_id: 'test-lib', limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = await listDocuments({ library_id: 'test-lib', limit: 2, offset: 2 });
    expect(page2).toHaveLength(1);

    const all = await listDocuments({ library_id: 'test-lib', limit: 100 });
    expect(all).toHaveLength(3);
    expect(page1[0].slug).not.toBe(page2[0].slug);
  });

  it('respects branch filter', async () => {
    // Use createVersion directly — don't promote so v1 stays current
    const { createVersion } = await import('../../modules/catalog/infrastructure/pg-versions.js');
    await createVersion('feature-v', 'test-lib', 'feature/xyz');
    await createTestDocument('test-lib', 'feature-v', { slug: 'branch-only' });

    const main = await listDocuments({ library_id: 'test-lib' });
    expect(main.find((d) => d.slug === 'branch-only')).toBeUndefined();

    const branched = await listDocuments({ library_id: 'test-lib', branch: 'feature/xyz' });
    expect(branched.find((d) => d.slug === 'branch-only')).toBeDefined();
  });
});

describe('deleteDocument', () => {
  it('deletes existing document', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'to-delete' });
    const deleted = await deleteDocument('test-lib', 'v1', 'to-delete');
    expect(deleted).toBe(true);
    const doc = await getDocumentBySlug('test-lib', 'to-delete');
    expect(doc).toBeUndefined();
  });

  it('returns false for non-existent slug', async () => {
    const deleted = await deleteDocument('test-lib', 'v1', 'ghost');
    expect(deleted).toBe(false);
  });
});

describe('listDocumentHashes', () => {
  it('returns slug/content_hash pairs', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'doc/a' });
    await createTestDocument('test-lib', 'v1', { slug: 'doc/b' });

    const hashes = await listDocumentHashes('test-lib', 'v1');
    expect(hashes).toHaveLength(2);
    expect(hashes[0].content_hash).toBeTruthy();
    expect(hashes.map((h) => h.slug)).toEqual(expect.arrayContaining(['doc/a', 'doc/b']));
  });
});

describe('cloneVersionDocs', () => {
  it('clones all docs to a new version', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'clone/a' });
    await createTestDocument('test-lib', 'v1', { slug: 'clone/b' });
    await createTestVersion('test-lib', 'v2');

    const count = await cloneVersionDocs('test-lib', 'v1', 'v2');
    expect(count).toBe(2);

    const v2docs = await listDocuments({ library_id: 'test-lib', version_id: 'v2' });
    expect(v2docs).toHaveLength(2);
    expect(v2docs.map((d) => d.slug)).toEqual(expect.arrayContaining(['clone/a', 'clone/b']));
  });

  it('cloning into a version that already has some of the docs (re-push) does not fail', async () => {
    await createTestDocument('test-lib', 'v1', {
      slug: 'clone/a',
      content: 'Reads table: orders',
      links: [{ slug: 'clone/b', type: 'references' }],
    });
    await createTestDocument('test-lib', 'v1', { slug: 'clone/b' });
    await createTestVersion('test-lib', 'v2');
    await createTestDocument('test-lib', 'v2', { slug: 'clone/a', content: 'Already here' });

    const count = await cloneVersionDocs('test-lib', 'v1', 'v2');
    expect(count).toBe(1); // only clone/b was missing

    const v2docs = await listDocuments({ library_id: 'test-lib', version_id: 'v2' });
    expect(v2docs.map((d) => d.slug).sort()).toEqual(['clone/a', 'clone/b']);
    expect(v2docs.find((d) => d.slug === 'clone/a')?.content).toBe('Already here');
  });
});

describe('re-uploading a cloned document replaces its metadata and manual links', () => {
  async function stateOf(versionId: string, slug: string) {
    const db = getDb();
    const meta = (await db.execute(sql`
      select m.key, m.value from document_metadata m join documents d on d.id = m.document_id
      where d.library_id = 'test-lib' and d.version_id = ${versionId} and d.slug = ${slug}`)) as unknown as { key: string; value: string }[];
    const links = (await db.execute(sql`
      select l.to_slug, l.source from document_links l join documents d on d.id = l.from_document_id
      where d.library_id = 'test-lib' and d.version_id = ${versionId} and d.slug = ${slug}`)) as unknown as { to_slug: string; source: string }[];
    return { meta, links };
  }

  async function seed() {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a', content: 'Reads table: orders_tbl',
      metadata: [{ key: 'table_name', value: 'orders_tbl' }],
      links: [{ slug: 'b', type: 'references' }],
    });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'b', content: 'B' });
    await createTestVersion('test-lib', 'v2');
    await cloneVersionDocs('test-lib', 'v1', 'v2');
    expect((await stateOf('v2', 'a')).links).toHaveLength(1);
  }

  const reupload = { library_id: 'test-lib', version_id: 'v2', slug: 'a', content: 'No more tables', metadata: [] };

  it('insertDocument: no metadata and no links leave none', async () => {
    await seed();
    const doc = await insertDocument(reupload);
    expect(await stateOf('v2', 'a')).toEqual({ meta: [], links: [] });
    expect(doc.content_hash).toBe(computeDocHash(reupload));
    // v1 is untouched
    expect((await stateOf('v1', 'a')).links).toHaveLength(1);
  });

  it('insertDocumentBatch: no metadata and no links leave none', async () => {
    await seed();
    await insertDocumentBatch([reupload]);
    expect(await stateOf('v2', 'a')).toEqual({ meta: [], links: [] });
  });

  it('auto links survive a re-upload', async () => {
    await seed();
    await getDb().execute(sql`
      insert into document_links (from_document_id, to_slug, link_type, source, confidence)
      select id, 'b', 'references', 'auto', 0.9 from documents where library_id = 'test-lib' and version_id = 'v2' and slug = 'a'`);
    await insertDocumentBatch([reupload]);
    expect((await stateOf('v2', 'a')).links).toEqual([{ to_slug: 'b', source: 'auto' }]);
  });
});
