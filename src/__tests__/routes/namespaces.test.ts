import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { cleanDb, createTestLibrary, createTestUser, TEST_API_KEY, type TestUser } from '../helpers.js';

let app: FastifyInstance;
let admin: TestUser;
let member: TestUser;
const ADMIN_KEY = { authorization: `Bearer ${TEST_API_KEY}` };

beforeAll(async () => {
  app = await buildServer();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await cleanDb();
  admin = await createTestUser({ role: 'admin' });
  member = await createTestUser({ role: 'member' });
});

describe('namespaces API', () => {
  it('lists the reserved namespaces with their libraries', async () => {
    await createTestLibrary('orders');
    const r = await app.inject({ url: '/api/namespaces', headers: admin.bearer });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([
      expect.objectContaining({ id: 'default', display_name: 'Default', system: false, libraries: ['orders'] }),
      expect.objectContaining({ id: 'insights', system: true, libraries: [] }),
    ]);
  });

  it('creates and renames a namespace', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/namespaces', headers: admin.bearer, payload: { id: 'pay', display_name: 'Payments' } });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ id: 'pay', display_name: 'Payments', system: false });
    const p = await app.inject({ method: 'PATCH', url: '/api/namespaces/pay', headers: admin.bearer, payload: { display_name: 'Pay team' } });
    expect(p.statusCode).toBe(200);
    expect(p.json().display_name).toBe('Pay team');
    expect((await app.inject({ method: 'PATCH', url: '/api/namespaces/nope', headers: admin.bearer, payload: { display_name: 'X' } })).statusCode).toBe(404);
  });

  it('rejects a bad id with 400 and a duplicate with 409', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/namespaces', headers: ADMIN_KEY, payload: { id: 'Bad Id', display_name: 'X' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'invalid_id' });
    expect((await app.inject({ method: 'POST', url: '/api/namespaces', headers: ADMIN_KEY, payload: {} })).statusCode).toBe(400);
    const dup = await app.inject({ method: 'POST', url: '/api/namespaces', headers: ADMIN_KEY, payload: { id: 'default', display_name: 'X' } });
    expect(dup.statusCode).toBe(409);
  });

  it('assigns a library to a namespace', async () => {
    await createTestLibrary('billing');
    await app.inject({ method: 'POST', url: '/api/namespaces', headers: admin.bearer, payload: { id: 'pay', display_name: 'Payments' } });
    const r = await app.inject({ method: 'PUT', url: '/api/libraries/billing/namespace', headers: admin.bearer, payload: { namespace_id: 'pay' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: 'billing', namespace_id: 'pay' });
    expect((await app.inject({ url: '/api/libraries/billing', headers: admin.bearer })).json().namespace_id).toBe('pay');
    const missing = await app.inject({ method: 'PUT', url: '/api/libraries/nope/namespace', headers: admin.bearer, payload: { namespace_id: 'pay' } });
    expect(missing.statusCode).toBe(404);
  });

  it('assigning a library to insights is 400 system_namespace', async () => {
    await createTestLibrary('billing');
    const r = await app.inject({ method: 'PUT', url: '/api/libraries/billing/namespace', headers: admin.bearer, payload: { namespace_id: 'insights' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'system_namespace' });
  });

  it('an admin creates a library in a namespace; an unknown namespace is 404', async () => {
    await app.inject({ method: 'POST', url: '/api/namespaces', headers: admin.bearer, payload: { id: 'pay', display_name: 'Payments' } });
    const r = await app.inject({ method: 'POST', url: '/api/libraries', headers: admin.bearer, payload: { id: 'svc', display_name: 'Svc', namespace_id: 'pay' } });
    expect(r.statusCode).toBe(201);
    expect(r.json().namespace_id).toBe('pay');
    const bad = await app.inject({ method: 'POST', url: '/api/libraries', headers: admin.bearer, payload: { id: 'x', display_name: 'X', namespace_id: 'nope' } });
    expect(bad.statusCode).toBe(404);
  });

  it('nobody pushes to the insights library, the admin key included', async () => {
    await createTestLibrary('insights');
    const { getDb } = await import('../../platform/db.js');
    const { sql } = await import('drizzle-orm');
    await getDb().execute(sql`update libraries set namespace_id = 'insights' where id = 'insights'`);
    const v = await app.inject({ method: 'POST', url: '/api/libraries/insights/versions', headers: ADMIN_KEY, payload: { id: 'v1' } });
    expect(v.statusCode).toBe(403);
    const lib = await app.inject({ method: 'POST', url: '/api/libraries', headers: ADMIN_KEY, payload: { id: 'insights', display_name: 'Mine' } });
    expect(lib.statusCode).toBe(403);
    // Reading it stays open
    expect((await app.inject({ url: '/api/libraries/insights/versions', headers: member.bearer })).statusCode).toBe(200);
  });

  it('members get 403 on every namespace and project-key route', async () => {
    for (const [method, url] of [
      ['GET', '/api/namespaces'],
      ['POST', '/api/namespaces'],
      ['PATCH', '/api/namespaces/default'],
      ['PUT', '/api/libraries/x/namespace'],
      ['GET', '/api/project-keys'],
      ['POST', '/api/project-keys'],
      ['DELETE', '/api/project-keys/x'],
      ['GET', '/admin/namespaces'],
    ] as const) {
      const r = await app.inject({ method, url, headers: member.bearer, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('serves the Namespaces & keys page to admins only', async () => {
    const page = await app.inject({ url: '/admin/namespaces', headers: { cookie: admin.cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('data-page="namespaces"');
    expect(page.body).not.toMatch(/<script>|<style>/);
    const anon = await app.inject({ url: '/admin/namespaces' });
    expect(anon.statusCode).toBe(302);
  });
});

describe('project keys API', () => {
  it('member cannot create a project key (403)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/project-keys', headers: member.bearer, payload: { namespace_id: 'default', name: 'ci' } });
    expect(r.statusCode).toBe(403);
  });

  it('creates, lists and revokes keys', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/project-keys', headers: admin.bearer, payload: { namespace_id: 'default', name: 'ci' } });
    expect(c.statusCode).toBe(201);
    const body = c.json();
    expect(body).toEqual({ id: expect.any(String), name: 'ci', prefix: body.key.slice(0, 12), namespace_id: 'default', library_id: null, key: expect.stringMatching(/^lpk_[A-Za-z0-9_-]{43}$/) });
    const list = await app.inject({ url: '/api/project-keys?namespace=default', headers: admin.bearer });
    expect(list.json()).toEqual([expect.objectContaining({ id: body.id, name: 'ci', created_by: admin.id, revoked_at: null })]);
    expect((await app.inject({ url: '/api/project-keys?namespace=other', headers: admin.bearer })).json()).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: `/api/project-keys/${body.id}`, headers: admin.bearer })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/project-keys/${body.id}`, headers: admin.bearer })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/project-keys/not-a-uuid', headers: admin.bearer })).statusCode).toBe(404);
  });

  it('rejects bad input', async () => {
    await createTestLibrary('orders');
    const post = (payload: object) => app.inject({ method: 'POST', url: '/api/project-keys', headers: ADMIN_KEY, payload });
    expect((await post({ namespace_id: 'default' })).statusCode).toBe(400);
    expect((await post({ namespace_id: 'nope', name: 'ci' })).statusCode).toBe(404);
    expect((await post({ namespace_id: 'insights', name: 'ci' })).json()).toEqual({ error: 'system_namespace' });
    await app.inject({ method: 'POST', url: '/api/namespaces', headers: ADMIN_KEY, payload: { id: 'pay', display_name: 'Payments' } });
    const r = await post({ namespace_id: 'pay', name: 'ci', library_id: 'orders' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'library_not_in_namespace' });
    // The admin key has no user: created_by stays null
    const ok = await post({ namespace_id: 'default', name: 'ci', library_id: 'orders' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().library_id).toBe('orders');
  });
});
