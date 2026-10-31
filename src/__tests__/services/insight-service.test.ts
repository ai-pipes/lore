import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { citedDocumentLinks, createPgChat, MAX_INSIGHT_LINKS } from '../../modules/chat/index.js';
import { createPgCatalog } from '../../modules/catalog/index.js';
import { createSearch } from '../../modules/search/index.js';
import { insertDocument, DocumentExistsError } from '../../modules/catalog/infrastructure/pg-documents.js';
import { getDb } from '../../platform/db.js';
import { cleanDb, createTestLibrary, createTestVersion, createTestDocument } from '../helpers.js';
import { createLanguageModel } from '../../modules/llm/index.js';

const llm = createLanguageModel({});

const catalog = createPgCatalog({ llm });
const chat = createPgChat(catalog, createSearch(catalog, llm), llm);

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary('orders-api', 'Orders');
  await createTestVersion('orders-api', 'v1');
  for (let i = 0; i < 60; i++) await createTestDocument('orders-api', 'v1', { slug: `orders/doc-${i}` });
});

afterEach(() => vi.restoreAllMocks());

describe('citedDocumentLinks', () => {
  it('resolves refs with a single query and caps distinct refs before lookup', async () => {
    const text = Array.from({ length: 5000 }, (_, i) => `[ref:orders-api/orders/doc-${i % 60}] [ref:orders-api/missing/${i}]`).join(' ');
    const select = vi.spyOn(getDb(), 'select');
    const links = await citedDocumentLinks(chat, [text], [], 'insights');
    expect(select).toHaveBeenCalledTimes(1);
    expect(links.length).toBeLessThanOrEqual(MAX_INSIGHT_LINKS);
    expect(links.every((l) => l.library === 'orders-api' && l.slug.startsWith('orders/doc-'))).toBe(true);
  });

  it('prefers pinned documents, drops missing ones and self-references', async () => {
    const links = await citedDocumentLinks(
      chat,
      ['see [ref:orders-api/orders/doc-1] and [ref:orders-api/nope] and [ref:insights/insight/x]'],
      [{ library_id: 'orders-api', slug: 'orders/doc-2' }, { bogus: true }],
      'insights',
    );
    expect(links.map((l) => l.slug)).toEqual(['orders/doc-2', 'orders/doc-1']);
  });

  it('makes no query when there is nothing to resolve', async () => {
    const select = vi.spyOn(getDb(), 'select');
    expect(await citedDocumentLinks(chat, ['no refs here'], [], 'insights')).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});

describe("insertDocument({ onConflict: 'error' })", () => {
  it('fails instead of overwriting an existing document', async () => {
    await expect(
      insertDocument({ library_id: 'orders-api', version_id: 'v1', slug: 'orders/doc-1', content: 'overwrite' }, { onConflict: 'error' }),
    ).rejects.toBeInstanceOf(DocumentExistsError);
  });

  it('inserts new documents', async () => {
    const doc = await insertDocument({ library_id: 'orders-api', version_id: 'v1', slug: 'orders/new', content: 'x' }, { onConflict: 'error' });
    expect(doc.slug).toBe('orders/new');
  });
});
