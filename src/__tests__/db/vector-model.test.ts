import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import { createSearch, searchDocuments } from '../../modules/search/index.js';
import { createPgCatalog } from '../../modules/catalog/index.js';
import { insertDocument, cloneVersionDocs } from '../../modules/catalog/infrastructure/pg-documents.js';
import { document_vectors, documents } from '../../modules/catalog/infrastructure/schema.js';
import { vectorSearch } from '../../modules/catalog/infrastructure/pg-document-search.js';
import { createVersion } from '../../modules/catalog/infrastructure/pg-versions.js';
import { HashEmbeddingProvider } from '../../modules/catalog/infrastructure/embeddings/HashEmbeddings.js';
import {
  getEmbeddingProvider,
  setEmbeddingProvider,
} from '../../modules/catalog/infrastructure/embeddings/EmbeddingProvider.js';
import { createLanguageModel } from '../../modules/llm/index.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';

const llm = createLanguageModel({});
const search = createSearch(createPgCatalog({ llm }), llm);
const defaultProvider = getEmbeddingProvider();

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary('petstore-api', 'Petstore API');
  await createTestVersion('petstore-api', 'v1');
});

afterEach(() => setEmbeddingProvider(defaultProvider));

const doc = (slug: string, content: string) => ({ library_id: 'petstore-api', version_id: 'v1', slug, content });

describe('vectors tagged with their model', () => {
  it('stores vectors of any dimension', async () => {
    setEmbeddingProvider(new HashEmbeddingProvider(1536));
    await insertDocument(doc('a/one', 'Refund an order.'));
    setEmbeddingProvider(new HashEmbeddingProvider(768));
    await insertDocument(doc('a/two', 'Upload a photo.'));

    const rows = await getDb()
      .select({ slug: documents.slug, model: document_vectors.model })
      .from(document_vectors)
      .innerJoin(documents, eq(documents.id, document_vectors.document_id));
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.model]))).toEqual({
      'a/one': 'hash:1536',
      'a/two': 'hash:768',
    });
  });

  it('ignores vectors of another model and dimension', async () => {
    setEmbeddingProvider(new HashEmbeddingProvider(1536));
    await insertDocument(doc('orders/refund', 'Refund an order. Reverses the payment.'));
    setEmbeddingProvider(new HashEmbeddingProvider(768));

    expect((await searchDocuments(search, 'refund order')).map((r) => r.slug)).toEqual(['orders/refund']);
    expect(await searchDocuments(search, 'refnd ordr paymnt')).toHaveLength(0);
  });

  it('applies minScore without comparing vectors of another dimension', async () => {
    setEmbeddingProvider(new HashEmbeddingProvider(1536));
    await insertDocument(doc('orders/stale', 'Refund an order. Reverses the payment.'));
    setEmbeddingProvider(new HashEmbeddingProvider(768));
    await insertDocument(doc('orders/refund', 'Refund an order. Reverses the payment.'));
    await insertDocument(doc('photos/upload', 'Upload a photo.'));

    const query = await getEmbeddingProvider()!.embed('Refund an order. Reverses the payment.');
    const hits = await vectorSearch(query, {}, 10, 0.5);
    expect(hits.map((h) => h.slug)).toEqual(['orders/refund']);
  });

  it('copies between versions keep the source model', async () => {
    setEmbeddingProvider(new HashEmbeddingProvider(1536));
    await insertDocument(doc('a/one', 'Refund an order.'));
    setEmbeddingProvider(new HashEmbeddingProvider(768));
    await createVersion('v2', 'petstore-api');
    expect(await cloneVersionDocs('petstore-api', 'v1', 'v2')).toBe(1);

    const rows = await getDb()
      .select({ version: document_vectors.version_id, model: document_vectors.model })
      .from(document_vectors);
    expect(rows.map((r) => `${r.version}:${r.model}`).sort()).toEqual(['v1:hash:1536', 'v2:hash:1536']);
  });

  it('rows from before the migration are ignored', async () => {
    await insertDocument(doc('orders/refund', 'Refund an order. Reverses the payment.'));
    await getDb().update(document_vectors).set({ model: null });
    expect(await searchDocuments(search, 'refnd ordr paymnt')).toHaveLength(0);
  });
});
