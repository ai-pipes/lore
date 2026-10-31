import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { cleanDb, createTestDocument, createTestLibrary, createTestUser, createTestVersion, TEST_API_KEY } from '../helpers.js';

// Malformed input is the caller's mistake: 400, never a database error (500).
let app: FastifyInstance;
let USER: { authorization: string };
/** The same user's web session (personal tokens are minted from a session only). */
let SESSION: { cookie: string };
const ADMIN_KEY = { authorization: `Bearer ${TEST_API_KEY}` };

beforeAll(async () => {
  app = await buildServer();
});

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary('orders-api', 'Orders API');
  await createTestVersion('orders-api', 'v1');
  await createTestDocument('orders-api', 'v1', { slug: 'refunds', content: '# Refunds\n\nRefunds are async.', domain: 'payments' });
  const user = await createTestUser();
  USER = user.bearer;
  SESSION = { cookie: user.cookie };
});

async function newSession(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/sessions', headers: USER, payload: {} });
  return res.json().id as string;
}

function nested(depth: number): unknown {
  let v: unknown = 'leaf';
  for (let i = 0; i < depth; i++) v = { a: v };
  return v;
}

describe('NUL and other control characters', () => {
  it.each([
    '/api/libraries/%00',
    '/api/libraries/orders%00api',
    '/api/search?q=%00',
    '/api/search?q=refunds&library_id=orders%00api',
    '/api/search?q=refunds%01',
    '/api/document?library_id=orders-api&slug=ref%00unds',
    '/api/services?library_id=%00',
  ])('GET %s is 400', async (url) => {
    const res = await app.inject({ method: 'GET', url, headers: USER });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/control character/);
  });

  it('a NUL in a JSON body string is 400 (session title, scope_filters, token name)', async () => {
    for (const [url, payload] of [
      ['/api/sessions', { title: 'a\u0000b' }],
      ['/api/sessions', { scope_filters: { services: [{ library_id: 'x\u0000' }] } }],
      ['/api/tokens', { name: 'ci\u0000' }],
    ] as const) {
      const headers = url === '/api/tokens' ? SESSION : USER;
      const res = await app.inject({ method: 'POST', url, headers, payload });
      expect(res.statusCode, url).toBe(400);
    }
  });

  it('a NUL in a message, its metadata or a publish library_id is 400', async () => {
    const id = await newSession();
    for (const [url, payload] of [
      [`/api/sessions/${id}/messages`, { role: 'user', content: 'hi\u0000' }],
      [`/api/sessions/${id}/messages`, { role: 'user', content: 'hi', metadata: { 'k\u0000': 1 } }],
      [`/api/sessions/${id}/publish`, { library_id: 'orders\u0000' }],
    ] as const) {
      const res = await app.inject({ method: 'POST', url, headers: USER, payload });
      expect(res.statusCode, url).toBe(400);
    }
  });

  it('a NUL in a search query string is 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=re%00funds', headers: USER });
    expect(res.statusCode).toBe(400);
  });

  it('keeps tabs, newlines and other control characters inside pushed Markdown', async () => {
    await createTestVersion('orders-api', 'v2');
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries/orders-api/versions/v2/documents/bulk?noEnrich=true',
      headers: ADMIN_KEY,
      payload: [{ slug: 'ctl', content: '# Ctl\n\n\tcode\r\npage\fbreak \u001b[1mbold\u001b[0m' }],
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('repeated query parameters', () => {
  it.each([
    '/api/search?q=a&q=b',
    '/api/search?q=refunds&domain=a&domain=b',
    '/api/search?q=refunds&library_id=orders-api&branch=a&branch=b',
    '/api/document?library_id=orders-api&library_id=x&slug=refunds',
  ])('GET %s is 400', async (url) => {
    const res = await app.inject({ method: 'GET', url, headers: USER });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/more than once/);
  });

  it('a single value still works', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=refunds&domain=payments', headers: USER });
    expect(res.statusCode).toBe(200);
  });
});

describe('deeply nested JSON', () => {
  it('message metadata nested too deep is 400', async () => {
    const id = await newSession();
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/messages`,
      headers: { ...USER, 'content-type': 'application/json' },
      // built as text: JSON.stringify itself overflows the stack at this depth
      payload: `{"role":"user","content":"hi","metadata":${'{"a":'.repeat(10_000)}1${'}'.repeat(10_000)}}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/nested too deep/);
  });

  it('ordinary nesting is accepted', async () => {
    const id = await newSession();
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/messages`,
      headers: USER,
      payload: { role: 'user', content: 'hi', metadata: nested(10) },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('content that is not a string', () => {
  it('POST /api/sessions/:id/messages with content: 5 is 400', async () => {
    const id = await newSession();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${id}/messages`, headers: USER, payload: { role: 'user', content: 5 } });
    expect(res.statusCode).toBe(400);
  });
});
