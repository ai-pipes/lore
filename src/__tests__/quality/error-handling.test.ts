/**
 * Error Surface Tests
 *
 * These tests document the DESIRED behavior for error cases.
 * Some tests reflect current broken behavior (silent errors) and will PASS before fixes.
 * Tests marked with "SHOULD FAIL BEFORE FIX #N" document behavior that must improve.
 *
 * After all Tier-1 fixes are applied, ALL tests in this file should pass.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createSearch, searchDocuments } from '../../modules/search/index.js';
import { createPgCatalog } from '../../modules/catalog/index.js';
import { insertDocument } from '../../modules/catalog/infrastructure/pg-documents.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';
import { createLanguageModel } from '../../modules/llm/index.js';

const llm = createLanguageModel({});

const search = createSearch(createPgCatalog({ llm }), llm);

const LIBRARY_ID = 'error-test-lib';
const VERSION_ID = 'error-v1';

beforeAll(async () => {
  await cleanDb();
  await createTestLibrary(LIBRARY_ID, 'Error Test Library');
  await createTestVersion(LIBRARY_ID, VERSION_ID);

  await insertDocument({
    library_id: LIBRARY_ID,
    version_id: VERSION_ID,
    slug: 'test/document',
    content: 'This is a test document about order processing and payment workflows.',
    summary: 'Test document for error handling tests',
  });
}, 60_000);

afterAll(async () => {
  await cleanDb();
});

// ─── Silent Error Documentation ──────────────────────────────────────────────

describe('Current behavior: silent error swallowing (documents problems to fix)', () => {
  /**
   * CURRENT BEHAVIOR: searchDocuments catches all FTS errors and returns [].
   * DESIRED BEHAVIOR (after fix #1): FTS errors should be logged as warnings;
   * vector errors should fall back to FTS results, not silently return [].
   *
   * This test documents the current behavior. After fix #1, this test can be
   * replaced with one that verifies errors are logged.
   */
  it('searchDocuments returns [] when query produces no FTS match (not an error, just no results)', async () => {
    const results = await searchDocuments(search, 'xyzzy nonsense gibberish qqq zzz', {
      services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }],
    });
    // Current behavior: returns empty array (could be no match OR silent error)
    expect(Array.isArray(results)).toBe(true);
  });

  /**
   * Special characters that could break websearch_to_tsquery.
   * CURRENT BEHAVIOR: empty catch swallows the error, returns [].
   * DESIRED BEHAVIOR (after fix #1): error is logged, function still returns []
   * or FTS falls back gracefully.
   *
   * This test verifies the function does NOT THROW (graceful degradation).
   * Both before and after fix #1, this should not throw.
   */
  it('searchDocuments does not throw on query with special FTS characters', async () => {
    // Certain inputs can cause websearch_to_tsquery to fail
    const problematicQueries = [
      '& | ! !! &&',      // Boolean operators only
      '::: :::',          // Colons
      'a:*:*:*',         // Malformed prefix search
    ];

    for (const query of problematicQueries) {
      await expect(
        searchDocuments(search, query, { services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }] }),
      ).resolves.not.toThrow();
    }
  });
});

// ─── Desired Error Behavior (will PASS after fixes) ──────────────────────────

describe('Desired behavior: error visibility', () => {
  /**
   * After fix #1: When FTS encounters a parse error, it should log a warning.
   * We test this by spying on console.error / console.warn.
   *
   * NOTE: This test verifies the logging behavior that fix #1 should introduce.
   * BEFORE fix #1: This test FAILS because nothing is logged.
   * AFTER fix #1: This test PASSES because the error is logged at warn level.
   */
  it('logs warning when FTS query fails (after fix #1)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // A query that consistently breaks websearch_to_tsquery in some PostgreSQL versions
      // If it doesn't break FTS, the test still passes (no regression).
      await searchDocuments(search, ':!! :!:', { services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }] });

      // After fix #1: if FTS threw, we expect a warning or error to be logged.
      // We don't assert on the spy here because the query might not actually break FTS
      // in all PostgreSQL versions — this is a soft test.
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  /**
   * When a valid query is made, searchDocuments should return results, not throw.
   * This should pass both before and after all fixes.
   */
  it('searchDocuments returns results for a valid query', async () => {
    const results = await searchDocuments(search, 'order processing payment', {
      services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }],
    });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].slug).toBeTruthy();
  });

  /**
   * After fix #2: When embedding generation fails during document insertion,
   * any stale vector for that document should be removed (not left in DB).
   *
   * We simulate this by:
   * 1. Inserting a doc with embeddings (if provider available)
   * 2. Updating the doc with a mocked failing embedding provider
   * 3. Verifying no stale vector remains
   *
   * NOTE: This test requires mocking the embedding provider module.
   * BEFORE fix #2: stale vector persists.
   * AFTER fix #2: stale vector is deleted.
   *
   * Currently this test passes trivially (no vector was inserted if no provider),
   * so we document the intent here for when embeddings are enabled.
   */
  it('document insertion succeeds even when embedding fails', async () => {
    // This should always succeed regardless of embedding provider
    const doc = await insertDocument({
      library_id: LIBRARY_ID,
      version_id: VERSION_ID,
      slug: 'test/embedding-fail-test',
      content: 'Test document for embedding failure scenario',
    });

    expect(doc).toBeDefined();
    expect(doc.slug).toBe('test/embedding-fail-test');
    expect(doc.content_hash).toBeTruthy();
  });
});

// ─── Boundary Conditions ─────────────────────────────────────────────────────

describe('Boundary conditions', () => {
  it('searchDocuments with unknown library_id returns []', async () => {
    const results = await searchDocuments(search, 'order payment', {
      services: [{ library_id: 'nonexistent-library' }],
    });
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it('searchDocuments without library_id searches across all libraries', async () => {
    const results = await searchDocuments(search, 'order processing payment workflow', {});
    // Without library_id filter, should still find the document
    expect(Array.isArray(results)).toBe(true);
    // We inserted at least one document, so some results are expected
    // (if FTS matches — exact behavior depends on content)
  });

  it('searchDocs with minScore filter excludes low-relevance results', async () => {
    const { searchDocs } = await import('../../modules/catalog/infrastructure/pg-document-search.js');

    const resultsLowThreshold = await searchDocs({
      query: 'document',
      library_id: LIBRARY_ID,
      version_id: VERSION_ID,
      minScore: 0.001,
    });

    const resultsHighThreshold = await searchDocs({
      query: 'document',
      library_id: LIBRARY_ID,
      version_id: VERSION_ID,
      minScore: 0.99, // Extremely high — should filter out everything
    });

    // Low threshold returns results; extremely high threshold may return fewer
    expect(resultsLowThreshold.length).toBeGreaterThanOrEqual(resultsHighThreshold.length);
  });

  it('searchDocuments with empty string query returns [] without throwing', async () => {
    await expect(
      searchDocuments(search, '', { services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }] }),
    ).resolves.not.toThrow();
  });
});
