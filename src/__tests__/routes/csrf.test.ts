import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { cleanDb, createTestLibrary, createTestUser, createTestVersion, TEST_API_KEY } from '../helpers.js';

const PASSWORD = 'correct-horse-battery';

// Every write route needs a caller now, so the checks run for both kinds of user credentials.
describe.each([
  ['with a personal sk_ token', false],
  ['signed in with a session cookie', true],
] as const)('CSRF protection (%s)', (_name, signedIn) => {
  let app: FastifyInstance;
  let auth: Record<string, string> = {};

  beforeAll(async () => {
    app = await buildServer();
  });
  beforeEach(async () => {
    await cleanDb();
    await createTestLibrary('orders-api', 'Orders');
    await createTestVersion('orders-api', 'v1');
    const user = await createTestUser();
    auth = signedIn ? { cookie: user.cookie } : user.bearer;
  });

  it('rejects urlencoded bodies on API routes (415)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sessions', headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'title=x' });
    expect(res.statusCode).toBe(415);
  });

  it('rejects text/plain bodies on API routes (415)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat', headers: { ...auth, 'content-type': 'text/plain' }, payload: '{"messages":[{"role":"user","content":"x"}]}' });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a cross-site Origin on state-changing routes', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sessions', headers: { ...auth, origin: 'https://evil.example', 'content-type': 'application/json' }, payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('rejects Sec-Fetch-Site: cross-site and Origin: null', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/sessions', headers: auth, payload: {} });
    const id = created.json().id;
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${id}`, headers: { ...auth, 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${id}`, headers: { ...auth, origin: 'null' } })).statusCode).toBe(403);
  });

  it('rejects cross-site writes even with a valid bearer key', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/libraries/orders-api/versions', headers: { authorization: `Bearer ${TEST_API_KEY}`, origin: 'https://evil.example' }, payload: { id: 'v2' } });
    expect(res.statusCode).toBe(403);
  });

  it('allows same-origin browser requests and non-browser clients', async () => {
    const same = await app.inject({ method: 'POST', url: '/api/sessions', headers: { ...auth, host: 'lore.example.com', origin: 'https://lore.example.com', 'sec-fetch-site': 'same-origin' }, payload: {} });
    expect(same.statusCode).toBe(201);
    const cli = await app.inject({ method: 'POST', url: '/api/libraries/orders-api/versions', headers: { authorization: `Bearer ${TEST_API_KEY}` }, payload: { id: 'v2' } });
    expect(cli.statusCode).toBe(201);
  });

  it('cross-site GETs are not blocked by the CSRF check', async () => {
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(200);
  });
});

describe('sign-in with CSRF protection', () => {
  let app: FastifyInstance;
  let login: string;
  beforeAll(async () => {
    app = await buildServer();
  });
  beforeEach(async () => {
    await cleanDb();
    login = (await createTestUser({ password: PASSWORD })).login;
  });

  it('same-origin JSON login works', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { host: 'localhost:4737', origin: 'http://localhost:4737' }, payload: { login, password: PASSWORD } });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toContain('SameSite=Lax');
  });

  it('cross-site login posts are rejected', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'https://evil.example' }, payload: { login, password: PASSWORD } });
    expect(res.statusCode).toBe(403);
    const form = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `login=${login}&password=${PASSWORD}` });
    expect(form.statusCode).toBe(415);
  });

  it('LORE_ALLOWED_ORIGINS admits a proxy origin', async () => {
    process.env.LORE_ALLOWED_ORIGINS = 'https://docs.example.com';
    try {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { host: 'lore:4737', origin: 'https://docs.example.com' }, payload: { login, password: PASSWORD } });
      expect(res.statusCode).toBe(204);
    } finally {
      delete process.env.LORE_ALLOWED_ORIGINS;
    }
  });
});
