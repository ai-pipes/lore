import { describe, it, expect, beforeEach } from 'vitest';
import { createSearch, searchDocuments } from '../../modules/search/index.js';
import { createPgCatalog } from '../../modules/catalog/index.js';
import { insertDocument } from '../../modules/catalog/infrastructure/pg-documents.js';
import { getEmbeddingProvider } from '../../modules/catalog/infrastructure/embeddings/EmbeddingProvider.js';
import { createVersion } from '../../modules/catalog/infrastructure/pg-versions.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';
import { createLanguageModel } from '../../modules/llm/index.js';

const llm = createLanguageModel({});

const search = createSearch(createPgCatalog({ llm }), llm);

// Runs with LORE_EMBEDDING_PROVIDER=hash (see vitest.config.ts) and no LLM:
// exercises the hybrid FTS + vector path fully offline.

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary('petstore-api', 'Petstore API');
  await createTestVersion('petstore-api', 'v1');
});

describe('hybrid search (offline hash embeddings)', () => {
  it('uses the hash provider in tests', () => {
    expect(getEmbeddingProvider()?.constructor.name).toBe('HashEmbeddingProvider');
  });

  it('finds a document through the vector index when full-text search misses (typo)', async () => {
    await insertDocument({ library_id: 'petstore-api', version_id: 'v1', slug: 'orders/refund', content: 'Refund an order. Reverses the payment.', summary: 'Refund an order' });
    await insertDocument({ library_id: 'petstore-api', version_id: 'v1', slug: 'pets/upload-photo', content: 'Upload a photo for a pet.', summary: 'Upload pet photo' });

    const results = await searchDocuments(search, 'refnd ordr paymnt');
    expect(results[0]?.slug).toBe('orders/refund');
    expect(results[0]?.summary).toBe('Refund an order'); // metadata is filled for vector-only hits
    expect(results.map((r) => r.slug)).not.toContain('pets/upload-photo');
  });

  it('vector search only sees the current version by default', async () => {
    await createVersion('v2', 'petstore-api');
    await insertDocument({ library_id: 'petstore-api', version_id: 'v1', slug: 'orders/current', content: 'Order checkout flow.' });
    await insertDocument({ library_id: 'petstore-api', version_id: 'v2', slug: 'orders/unpromoted', content: 'Order checkout flow.' });

    const results = await searchDocuments(search, 'order checkout flow', { services: [{ library_id: 'petstore-api' }] });
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain('orders/current');
    expect(slugs).not.toContain('orders/unpromoted');
  });

  it('returns nothing for a query with no lexical or vector overlap', async () => {
    await insertDocument({ library_id: 'petstore-api', version_id: 'v1', slug: 'a/doc', content: 'Apples and oranges.' });
    expect(await searchDocuments(search, 'xyzzy')).toHaveLength(0);
  });
});
