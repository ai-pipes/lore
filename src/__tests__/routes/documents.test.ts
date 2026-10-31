import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import {
  cleanDb,
  TEST_API_KEY,
  createTestLibrary,
  createTestVersion,
  createTestDocument,
  buildMultipart,
} from '../helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
});

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
  await createTestVersion();
});

const AUTH = { authorization: `Bearer ${TEST_API_KEY}` };

describe('POST /api/libraries/:id/versions/:versionId/documents', () => {
  it('creates a document via multipart', async () => {
    const { body, contentType } = buildMultipart({
      slug: 'api/orders',
      content: '# Orders\n\nHandles order creation.',
      domain: 'orders',
      entry_type: 'handler',
      summary: 'Order creation handler',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries/test-lib/versions/v1/documents',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const doc = res.json();
    expect(doc.slug).toBe('api/orders');
    expect(doc.domain).toBe('orders');
    expect(doc.content_hash).toBeTruthy();
  });

  it('returns 400 when slug is missing', async () => {
    const { body, contentType } = buildMultipart({ content: 'Some content' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries/test-lib/versions/v1/documents',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  it('upserts on re-upload of same slug', async () => {
    const mkBody = (content: string) =>
      buildMultipart({ slug: 'api/upsert-me', content });

    const { body: body1, contentType } = mkBody('version one');
    await app.inject({
      method: 'POST',
      url: '/api/libraries/test-lib/versions/v1/documents',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body1,
    });

    const { body: body2 } = mkBody('version two');
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries/test-lib/versions/v1/documents',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body2,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().content).toBe('version two');
  });
});

describe('GET /api/libraries/:id/documents', () => {
  it('returns all documents in current version', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'doc/a' });
    await createTestDocument('test-lib', 'v1', { slug: 'doc/b' });

    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/documents' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('filters by domain via query param', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'a', domain: 'payments' });
    await createTestDocument('test-lib', 'v1', { slug: 'b', domain: 'orders' });

    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/documents?domain=payments' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].domain).toBe('payments');
  });

  it('paginates via limit and offset query params', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'p1' });
    await createTestDocument('test-lib', 'v1', { slug: 'p2' });
    await createTestDocument('test-lib', 'v1', { slug: 'p3' });

    const page1 = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/documents?limit=2&offset=0' });
    expect(page1.statusCode).toBe(200);
    expect(page1.json()).toHaveLength(2);

    const page2 = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/documents?limit=2&offset=2' });
    expect(page2.statusCode).toBe(200);
    expect(page2.json()).toHaveLength(1);
  });

  it('filters by branch via query param', async () => {
    // Don't promote — v1 stays current
    const { createVersion } = await import('../../modules/catalog/infrastructure/pg-versions.js');
    await createVersion('feat-v', 'test-lib', 'feature/new');
    await createTestDocument('test-lib', 'feat-v', { slug: 'feature-only' });

    const main = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/documents' });
    expect(main.json().find((d: { slug: string }) => d.slug === 'feature-only')).toBeUndefined();

    const branch = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/documents?branch=feature/new' });
    expect(branch.json().find((d: { slug: string }) => d.slug === 'feature-only')).toBeDefined();
  });
  it('rejects a limit or offset that is not a non-negative integer with 400', async () => {
    for (const q of ['limit=abc', 'limit=-1', 'limit=0', 'limit=1.5', 'offset=-5', 'offset=x']) {
      const res = await app.inject({ headers: AUTH, method: 'GET', url: `/api/libraries/test-lib/documents?${q}` });
      expect(res.statusCode, q).toBe(400);
    }
  });

  it('accepts a limit above the maximum (clamped)', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'only' });
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/documents?limit=1000000' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

describe('GET /api/libraries/:id/versions/:versionId/document-hashes', () => {
  it('returns every (slug, content_hash) pair of the version, beyond any page size', async () => {
    const { insertDocumentBatch } = await import('../../modules/catalog/infrastructure/pg-documents.js');
    await insertDocumentBatch(
      Array.from({ length: 150 }, (_, i) => ({ library_id: 'test-lib', version_id: 'v1', slug: `d/${String(i).padStart(3, '0')}`, content: `doc ${i}` })),
    );
    const { createVersion } = await import('../../modules/catalog/infrastructure/pg-versions.js');
    await createVersion('v2', 'test-lib');
    await createTestDocument('test-lib', 'v2', { slug: 'other-version' });

    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/versions/v1/document-hashes' });
    expect(res.statusCode).toBe(200);
    const items = res.json() as { slug: string; content_hash: string }[];
    expect(items).toHaveLength(150);
    expect(items.map((i) => i.slug)).toContain('d/149');
    expect(items.every((i) => /^[0-9a-f]{64}$/.test(i.content_hash))).toBe(true);
    expect(Object.keys(items[0]).sort()).toEqual(['content_hash', 'slug']);
  });

  it('is empty for a version without documents', async () => {
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/versions/nope/document-hashes' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('DELETE /api/libraries/:id/versions/:versionId/documents/:slug', () => {
  it('deletes a document', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'to/delete' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/libraries/test-lib/versions/v1/documents/to%2Fdelete',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe('to/delete');
  });

  it('returns 404 for non-existent document', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/libraries/test-lib/versions/v1/documents/ghost',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });
});
