import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../platform/db.js';
import { createSearch, searchDocuments } from '../../modules/search/index.js';
import { createPgCatalog, reindexEmbeddings } from '../../modules/catalog/index.js';
import { insertDocument } from '../../modules/catalog/infrastructure/pg-documents.js';
import { document_vectors } from '../../modules/catalog/infrastructure/schema.js';
import { createVersion, promoteVersion } from '../../modules/catalog/infrastructure/pg-versions.js';
import { HashEmbeddingProvider } from '../../modules/catalog/infrastructure/embeddings/HashEmbeddings.js';
import {
  getEmbeddingProvider,
  setEmbeddingProvider,
} from '../../modules/catalog/infrastructure/embeddings/EmbeddingProvider.js';
import type { EmbeddingProvider } from '../../modules/catalog/infrastructure/embeddings/types.js';
import { createLanguageModel } from '../../modules/llm/index.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';

const llm = createLanguageModel({});
const catalog = createPgCatalog({ llm });
const search = createSearch(catalog, llm);
const defaultProvider = getEmbeddingProvider();

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary('petstore-api', 'Petstore API');
  await createTestVersion('petstore-api', 'v1');
});

afterEach(() => setEmbeddingProvider(defaultProvider));

const doc = (slug: string, content: string, version = 'v1') => ({
  library_id: 'petstore-api',
  version_id: version,
  slug,
  content,
});
const models = async () => (await getDb().select({ model: document_vectors.model }).from(document_vectors)).map((r) => r.model);

async function seed() {
  setEmbeddingProvider(new HashEmbeddingProvider(1536));
  await insertDocument(doc('orders/refund', 'Refund an order. Reverses the payment.'));
  await insertDocument(doc('orders/cancel', 'Cancel an order before shipping.'));
  await insertDocument(doc('pets/photo', 'Upload a photo of a pet.'));
}

describe('reindexEmbeddings (Postgres)', () => {
  it('re-embeds stale and untagged vectors with the current model', async () => {
    await seed();
    await getDb().update(document_vectors).set({ model: null });
    setEmbeddingProvider(new HashEmbeddingProvider(768));
    expect(await searchDocuments(search, 'refnd ordr paymnt')).toHaveLength(0);

    const r = await reindexEmbeddings(catalog);
    expect(r).toEqual({ ok: true, value: { done: 3, total: 3 } });
    expect(await models()).toEqual(['hash:768', 'hash:768', 'hash:768']);
    expect((await searchDocuments(search, 'refnd ordr paymnt')).map((x) => x.slug)).toContain('orders/refund');
  });

  it('includes documents of non-current versions', async () => {
    await seed();
    await createVersion('v2', 'petstore-api');
    await promoteVersion('petstore-api', 'v2');
    await insertDocument(doc('orders/new', 'A new order doc.', 'v2'));
    setEmbeddingProvider(new HashEmbeddingProvider(768));
    expect(await reindexEmbeddings(catalog)).toEqual({ ok: true, value: { done: 4, total: 4 } });
    expect(await models()).toEqual(Array(4).fill('hash:768'));
  });

  it('resumes after a failure and then has nothing left', async () => {
    await seed();
    const inner = new HashEmbeddingProvider(768);
    let calls = 0;
    const flaky: EmbeddingProvider = {
      id: inner.id,
      dimensions: inner.dimensions,
      minScore: inner.minScore,
      embed: (t) => inner.embed(t),
      embedBatch: (texts) => (++calls === 2 ? Promise.reject(new Error('boom')) : inner.embedBatch(texts)),
    };
    setEmbeddingProvider(flaky);
    await expect(reindexEmbeddings(catalog, { batchSize: 2 })).rejects.toThrow('boom');
    expect((await models()).filter((m) => m === 'hash:768')).toHaveLength(2);

    expect(await reindexEmbeddings(catalog, { batchSize: 2 })).toEqual({ ok: true, value: { done: 1, total: 1 } });
    expect(await models()).toEqual(Array(3).fill('hash:768'));
    expect(await reindexEmbeddings(catalog)).toEqual({ ok: true, value: { done: 0, total: 0 } });
  });

  it('re-embeds current rows with all', async () => {
    await seed();
    expect(await reindexEmbeddings(catalog)).toEqual({ ok: true, value: { done: 0, total: 0 } });
    expect(await reindexEmbeddings(catalog, { all: true })).toEqual({ ok: true, value: { done: 3, total: 3 } });
  });

  it('reports no_provider without a provider', async () => {
    setEmbeddingProvider(null);
    expect(await reindexEmbeddings(catalog)).toEqual({ ok: false, error: 'no_provider' });
  });
});
