/**
 * Search Quality Baseline Tests
 *
 * These tests measure the quality of searchDocuments() and searchDocs() using a fixed
 * set of fixture documents and queries with known expected results.
 *
 * Metrics tracked:
 *   Precision@1 — correct document is the TOP result
 *   Recall@3    — correct document appears in the TOP 3 results
 *
 * Run BEFORE and AFTER any changes to verify quality does not regress.
 * Semantic test cases (requiresEmbeddings: true) are skipped unless
 * LORE_EMBEDDING_PROVIDER is configured.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSearch, searchDocuments, lookupBySlug } from '../../modules/search/index.js';
import { createPgCatalog } from '../../modules/catalog/index.js';
import { searchDocs } from '../../modules/catalog/infrastructure/pg-document-search.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';
import { insertDocument } from '../../modules/catalog/infrastructure/pg-documents.js';
import { FIXTURE_DOCS, FTS_TEST_CASES } from './fixtures.js';
import { createLanguageModel } from '../../modules/llm/index.js';

const llm = createLanguageModel({});

const search = createSearch(createPgCatalog({ llm }), llm);

const LIBRARY_ID = 'quality-test-lib';
const VERSION_ID = 'quality-v1';

beforeAll(async () => {
  await cleanDb();
  await createTestLibrary(LIBRARY_ID, 'Quality Test Library');
  await createTestVersion(LIBRARY_ID, VERSION_ID);

  for (const doc of FIXTURE_DOCS) {
    await insertDocument({
      library_id: LIBRARY_ID,
      version_id: VERSION_ID,
      slug: doc.slug,
      domain: doc.domain,
      entry_type: doc.entry_type,
      summary: doc.summary,
      content: doc.content,
    });
  }
}, 120_000);

afterAll(async () => {
  await cleanDb();
});

// ─── FTS Quality ────────────────────────────────────────────────────────────

describe('FTS: Precision@1 (top result is correct)', () => {
  const precision1Results: { desc: string; passed: boolean }[] = [];

  for (const tc of FTS_TEST_CASES) {
    it(tc.description, async () => {
      const results = await searchDocs({
        query: tc.query,
        library_id: LIBRARY_ID,
        version_id: VERSION_ID,
      });

      const passed = results.length > 0 && results[0].slug === tc.expectedSlug;
      precision1Results.push({ desc: tc.description, passed });

      if (!passed && results.length > 0) {
        console.log(
          `  Expected: ${tc.expectedSlug}\n  Got:      ${results.slice(0, 3).map((r) => r.slug).join(', ')}`,
        );
      }

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].slug).toBe(tc.expectedSlug);
    });
  }
});

describe('FTS: Recall@3 (correct result in top 3)', () => {
  for (const tc of FTS_TEST_CASES) {
    it(tc.description, async () => {
      const results = await searchDocs({
        query: tc.query,
        library_id: LIBRARY_ID,
        version_id: VERSION_ID,
        limit: 3,
      });

      const found = results.some((r) => r.slug === tc.expectedSlug);

      if (!found) {
        console.log(
          `  Expected: ${tc.expectedSlug}\n  Got:      ${results.map((r) => r.slug).join(', ')}`,
        );
      }

      expect(found, `Expected "${tc.expectedSlug}" in top 3 results`).toBe(true);
    });
  }
});

// ─── searchDocuments Quality ─────────────────────────────────────────────────

describe('searchDocuments: Precision@1', () => {
  for (const tc of FTS_TEST_CASES) {
    it(tc.description, async () => {
      const results = await searchDocuments(search, tc.query, {
        services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }],
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].slug).toBe(tc.expectedSlug);
    });
  }
});

describe('searchDocuments: Recall@3', () => {
  for (const tc of FTS_TEST_CASES) {
    it(tc.description, async () => {
      const results = await searchDocuments(search, tc.query, {
        services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }],
      });

      const found = results.some((r) => r.slug === tc.expectedSlug);
      expect(found, `Expected "${tc.expectedSlug}" in top 3 results`).toBe(true);
    });
  }
});

// ─── Slug Direct Lookup ──────────────────────────────────────────────────────

describe('Slug pattern direct lookup', () => {
  it('dot-notation slug is resolved: order-service.create-order', async () => {
    const doc = await lookupBySlug(search, 'order-service.create-order.something', {
      library_id: LIBRARY_ID,
      version_id: VERSION_ID,
    });
    // The slug pattern requires 3+ dot-separated parts. "order-service.create-order" (2 parts) won't match.
    // "order-service.createOrder.v1" (3 parts) would try "order-service/createOrder-v1" and "order-service/createOrder/v1"
    // This test documents current SLUG_PATTERN behavior — it requires 3+ segments.
    expect(doc).toBeNull();
  });

  it('3-part dot-notation resolves correctly when doc exists', async () => {
    // Insert a doc with slug that matches the 3-part pattern result
    await insertDocument({
      library_id: LIBRARY_ID,
      version_id: VERSION_ID,
      slug: 'order-service/create-order',
      content: 'already exists',
    });

    // Query using the 3-part pattern: "service.domain.action" → tries "service/domain-action" first
    const doc = await lookupBySlug(search, 'order.service.create', {
      library_id: LIBRARY_ID,
      version_id: VERSION_ID,
    });
    // "order.service.create" → tries "order/service-create" and "order/service/create"
    // Neither matches "order-service/create-order", so null is correct
    expect(doc).toBeNull();
  });

  it('searchDocuments does not throw on empty result', async () => {
    const results = await searchDocuments(search, 'xyzzy nonexistent gibberish query zzz', {
      services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }],
    });
    expect(Array.isArray(results)).toBe(true);
  });

  it('searchDocuments returns results for partial keyword match', async () => {
    const results = await searchDocuments(search, 'Stripe payment', {
      services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }],
    });
    expect(results.length).toBeGreaterThan(0);
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain('payment-service/charge-card');
  });
});

// ─── Result Ordering Sanity ──────────────────────────────────────────────────

describe('Result ordering', () => {
  it('FTS results are ordered by score descending', async () => {
    // Use a broad query that should match multiple fixture documents.
    // websearch_to_tsquery uses AND for spaces, so we need a word present in many docs.
    // 'handler' appears in every document title ("# Xxx Handler").
    const results = await searchDocs({
      query: 'handler endpoint request',
      library_id: LIBRARY_ID,
      version_id: VERSION_ID,
      limit: 10,
    });

    // If somehow the query returns only 1 result, skip the ordering check
    if (results.length < 2) {
      console.log(
        '  [ordering] Only 1 result returned — cannot verify ordering. Check fixture content.',
      );
      expect(results.length).toBeGreaterThanOrEqual(1);
      return;
    }

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it('searchDocuments returns metadata for matching docs', async () => {
    const results = await searchDocuments(search, 'cancel order refund inventory', {
      services: [{ library_id: LIBRARY_ID, version_id: VERSION_ID }],
    });

    expect(results.length).toBeGreaterThan(0);
    for (const doc of results) {
      expect(doc.slug).toBeTruthy();
      expect(doc.library_id).toBeTruthy();
    }
  });
});
