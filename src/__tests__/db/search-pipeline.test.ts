import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSearch, searchDocuments, extractSearchTerms } from '../../modules/search/index.js';
import { createPgCatalog } from '../../modules/catalog/index.js';
import { insertDocument } from '../../modules/catalog/infrastructure/pg-documents.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';
import { createVersion } from '../../modules/catalog/infrastructure/pg-versions.js';
import type { LanguageModel } from '../../modules/llm/index.js';

// A hand-written model — tests must not make real API calls
const mockCreate = vi.fn<() => Promise<string>>();
const llm: LanguageModel = {
  configured: () => true,
  complete: () => mockCreate(),
  stream: () => {
    throw new Error('not used');
  },
};

const search = createSearch(createPgCatalog({ llm }), llm);

function llmReturns(text: string) {
  mockCreate.mockResolvedValue(text);
}

beforeEach(async () => {
  mockCreate.mockReset();
  await cleanDb();
  await createTestLibrary('service-a', 'Service A');
  await createTestVersion('service-a', 'v1');
  await createTestLibrary('service-b', 'Service B');
  await createTestVersion('service-b', 'v1');
});

// ─── extractSearchTerms ───────────────────────────────────────────────────────

describe('extractSearchTerms', () => {
  it('returns trimmed text from LLM response', async () => {
    llmReturns('  internal transfer inventory  ');
    const terms = await extractSearchTerms(search, '¿dónde están las transferencias internas?');
    expect(terms).toBe('internal transfer inventory');
  });

  it('falls back to original query when LLM returns empty content', async () => {
    llmReturns('');
    const terms = await extractSearchTerms(search, 'some query');
    expect(terms).toBe('some query');
  });
});

// ─── searchDocuments — cross-library ─────────────────────────────────────────

describe('searchDocuments — no services (cross-library)', () => {
  it('finds documents across all libraries', async () => {
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'transfers/internal', content: 'Internal inventory transfer between warehouses.', summary: 'Internal transfer' });
    await insertDocument({ library_id: 'service-b', version_id: 'v1', slug: 'transfers/external', content: 'External inventory transfer to partners.', summary: 'External transfer' });
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'unrelated/doc', content: 'Something completely unrelated about apples.', summary: 'Apples' });

    // LLM returns a broad term so both transfer docs match FTS
    llmReturns('inventory transfer');

    const results = await searchDocuments(search, '¿dónde están las transferencias internas?');

    expect(results.length).toBeGreaterThanOrEqual(2);
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain('transfers/internal');
    expect(slugs).toContain('transfers/external');
    expect(slugs).not.toContain('unrelated/doc');
  });

  it('returns results sorted by score descending', async () => {
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/main', content: 'Internal transfer internal transfer internal transfer.', summary: 'Main' });
    await insertDocument({ library_id: 'service-b', version_id: 'v1', slug: 'b/side', content: 'Handles some internal transfer occasionally.', summary: 'Side' });

    llmReturns('internal transfer');
    const results = await searchDocuments(search, 'internal transfer', { dropFactor: 0 });

    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('returns empty array when nothing matches', async () => {
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/doc', content: 'Apples and oranges.' });

    llmReturns('xyznotaword');
    const results = await searchDocuments(search, 'xyznotaword');
    expect(results).toHaveLength(0);
  });
});

// ─── searchDocuments — with services filter ───────────────────────────────────

describe('searchDocuments — with services list', () => {
  it('only returns documents from specified services', async () => {
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/transfer', content: 'Internal inventory transfer.', summary: 'Transfer A' });
    await insertDocument({ library_id: 'service-b', version_id: 'v1', slug: 'b/transfer', content: 'Internal inventory transfer.', summary: 'Transfer B' });

    llmReturns('internal transfer');
    const results = await searchDocuments(search, 'internal transfer', {
      services: [{ library_id: 'service-a' }],
    });

    expect(results.every((r) => r.library_id === 'service-a')).toBe(true);
    expect(results.some((r) => r.library_id === 'service-b')).toBe(false);
  });

  it('returns [] for a service that does not exist', async () => {
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/transfer', content: 'Internal inventory transfer.', summary: 'Transfer A' });

    llmReturns('internal transfer');
    const results = await searchDocuments(search, 'transfer', {
      services: [{ library_id: 'nonexistent-library' }],
    });

    expect(results).toEqual([]);
  });

  it('merges and sorts results across multiple services', async () => {
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/high', content: 'Transfer transfer transfer.', summary: 'High score A' });
    await insertDocument({ library_id: 'service-b', version_id: 'v1', slug: 'b/low', content: 'One transfer here.', summary: 'Low score B' });

    llmReturns('transfer');
    const results = await searchDocuments(search, 'transfer', {
      services: [{ library_id: 'service-a' }, { library_id: 'service-b' }],
      dropFactor: 0,
    });

    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    expect(results.map((r) => r.library_id)).toContain('service-a');
    expect(results.map((r) => r.library_id)).toContain('service-b');
  });

  it('empty services list behaves like cross-library search', async () => {
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/transfer', content: 'Internal inventory transfer.', summary: 'Transfer' });

    llmReturns('internal transfer');
    const withEmpty = await searchDocuments(search, 'internal transfer', { services: [] });
    const withoutServices = await searchDocuments(search, 'internal transfer');

    expect(withEmpty.map((r) => r.slug)).toEqual(withoutServices.map((r) => r.slug));
  });
});

// ─── version/branch filtering ─────────────────────────────────────────────────

describe('searchDocuments — version and branch filtering', () => {
  it('searches specific version_id when provided', async () => {
    // v1 is current; v2 is a separate version on the same library
    const v2 = await createVersion('v2', 'service-a');
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/transfer', content: 'Internal inventory transfer v1.' });
    await insertDocument({ library_id: 'service-a', version_id: 'v2', slug: 'a/transfer', content: 'Internal inventory transfer v2.' });

    llmReturns('internal transfer');
    const results = await searchDocuments(search, 'internal transfer', {
      services: [{ library_id: 'service-a', version_id: v2.id }],
    });

    expect(results.every((r) => r.slug === 'a/transfer')).toBe(true);
    // Only one result expected — from v2
    expect(results).toHaveLength(1);
  });

  it('searches by branch when version_id is omitted', async () => {
    // Create a separate "feature" branch version (non-current)
    await createVersion('v-feature', 'service-a', 'feature');
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/transfer', content: 'Transfer on main branch.' });
    await insertDocument({ library_id: 'service-a', version_id: 'v-feature', slug: 'a/transfer-new', content: 'Transfer on feature branch.' });

    llmReturns('transfer');
    const results = await searchDocuments(search, 'transfer', {
      services: [{ library_id: 'service-a', branch: 'feature' }],
    });

    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain('a/transfer-new');
    expect(slugs).not.toContain('a/transfer'); // v1 is on main, not feature branch
  });

  it('searches current version when neither version_id nor branch is given', async () => {
    await createVersion('v2', 'service-a');
    // Only v1 is current (promoted in beforeEach); v2 is not
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/current', content: 'Transfer on current version.' });
    await insertDocument({ library_id: 'service-a', version_id: 'v2', slug: 'a/non-current', content: 'Transfer on non-current version.' });

    llmReturns('transfer');
    const results = await searchDocuments(search, 'transfer', {
      services: [{ library_id: 'service-a' }],
    });

    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain('a/current');
    expect(slugs).not.toContain('a/non-current');
  });
});

// ─── LLM fallback ─────────────────────────────────────────────────────────────

describe('searchDocuments — LLM fallback', () => {
  it('falls back to original query when LLM throws', async () => {
    await insertDocument({ library_id: 'service-a', version_id: 'v1', slug: 'a/payment', content: 'Payment processing handler.', summary: 'Payment' });

    mockCreate.mockRejectedValue(new Error('LLM unavailable'));

    const results = await searchDocuments(search, 'payment', { services: [{ library_id: 'service-a' }] });
    expect(results.length).toBeGreaterThan(0);
  });
});
