import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { createVersion } from '../../modules/catalog/infrastructure/pg-versions.js';
import { cleanDb, createTestLibrary, createTestVersion, createTestDocument, TEST_API_KEY } from '../helpers.js';

let app: FastifyInstance;
const AUTH = { authorization: `Bearer ${TEST_API_KEY}` };

beforeAll(async () => {
  app = await buildServer();
});

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
  await createTestVersion();
});

describe('GET /api/document', () => {
  it('returns document by library_id and slug', async () => {
    await createTestDocument('test-lib', 'v1', {
      slug: 'store/payment-create',
      content: '# Payment Create\n\nCreates a payment.',
      summary: 'Creates a payment',
    });

    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: '/api/document?library_id=test-lib&slug=store/payment-create',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe('store/payment-create');
    expect(body.library_id).toBe('test-lib');
    expect(body.content).toContain('Payment Create');
    expect(body.summary).toBe('Creates a payment');
    expect(body.version_id).toBe('v1');
  });

  it('returns 404 when document not found', async () => {
    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: '/api/document?library_id=test-lib&slug=nonexistent/doc',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when library_id is missing', async () => {
    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: '/api/document?slug=store/payment-create',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when slug is missing', async () => {
    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: '/api/document?library_id=test-lib',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/document on a branch while a new version of it is being pushed', () => {
  it('keeps serving the previous head until the new version holds documents', async () => {
    await createVersion('f1', 'test-lib', 'feat');
    await createTestDocument('test-lib', 'f1', { slug: 'a', content: 'First.' });
    const created = await app.inject({ method: 'POST', url: '/api/libraries/test-lib/versions', headers: AUTH, body: { id: 'f2', branch: 'feat' } });
    expect(created.statusCode).toBe(201);

    const during = await app.inject({ headers: AUTH, url: '/api/document?library_id=test-lib&slug=a&branch=feat' });
    expect(during.statusCode).toBe(200);
    expect(during.json().content).toBe('First.');

    await createTestDocument('test-lib', 'f2', { slug: 'a', content: 'Second.' });
    const after = await app.inject({ headers: AUTH, url: '/api/document?library_id=test-lib&slug=a&branch=feat' });
    expect(after.json().content).toBe('Second.');
  });
});

describe('GET /api/search on a branch', () => {
  it('expands links in the branch head, not in the current version', async () => {
    await createTestDocument('test-lib', 'v1', { slug: 'orders/refund', content: 'Refund an order.', links: [{ slug: 'orders/old-dep', type: 'calls' }] });
    await createTestDocument('test-lib', 'v1', { slug: 'orders/old-dep', content: 'Old dependency.' });
    await createVersion('fb', 'test-lib', 'feat');
    await createTestDocument('test-lib', 'fb', { slug: 'orders/refund', content: 'Refund an order.', links: [{ slug: 'orders/new-dep', type: 'calls' }] });
    await createTestDocument('test-lib', 'fb', { slug: 'orders/new-dep', content: 'New dependency.' });

    const res = await app.inject({ headers: AUTH, url: '/api/search?q=refund&library_id=test-lib&branch=feat' });
    expect(res.statusCode).toBe(200);
    expect(res.json().linked.map((l: { slug: string }) => l.slug)).toEqual(['orders/new-dep']);
  });
});
