import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildServer } from '../../platform/http/server.js';
import { buildContainer } from '../../platform/container.js';
import { registerAuthorization, allows, ROUTE_POLICY } from '../../platform/http/route-policy.js';
import { getDb } from '../../platform/db.js';
import { cleanDb, createTestUser, TEST_API_KEY, type TestUser } from '../helpers.js';

type Who = 'anon' | 'member' | 'admin' | 'adminKey';

const CASES: [string, string, Record<Who, number>][] = [
  ['GET', '/api/search?q=x', { anon: 401, member: 200, admin: 200, adminKey: 200 }],
  ['GET', '/api/sessions', { anon: 401, member: 200, admin: 200, adminKey: 403 }],
  ['POST', '/api/libraries', { anon: 401, member: 403, admin: 201, adminKey: 201 }],
  ['GET', '/api/libraries', { anon: 401, member: 200, admin: 200, adminKey: 200 }],
  ['GET', '/health/ready', { anon: 200, member: 200, admin: 200, adminKey: 200 }],
  ['GET', '/assets/lore.js', { anon: 200, member: 200, admin: 200, adminKey: 200 }],
  ['GET', '/api/auth/me', { anon: 401, member: 200, admin: 200, adminKey: 200 }],
  ['GET', '/', { anon: 302, member: 200, admin: 200, adminKey: 200 }],
  ['POST', '/api/libraries/x/rotate-key', { anon: 401, member: 404, admin: 404, adminKey: 404 }],
  ['GET', '/api/users', { anon: 401, member: 403, admin: 200, adminKey: 200 }],
  ['GET', '/admin/users', { anon: 302, member: 403, admin: 200, adminKey: 200 }],
  ['GET', '/api/no-such-route', { anon: 401, member: 404, admin: 404, adminKey: 404 }],
  // admin-session: an sk_ token of an admin is refused (the admin key passes the gate, then 400s on the empty body)
  ['POST', '/api/users', { anon: 401, member: 403, admin: 403, adminKey: 400 }],
  ['POST', '/api/users/00000000-0000-0000-0000-000000000000/password', { anon: 401, member: 403, admin: 403, adminKey: 400 }],
  ['PATCH', '/api/users/00000000-0000-0000-0000-000000000000', { anon: 401, member: 403, admin: 404, adminKey: 404 }],
];

let app: FastifyInstance;
let member: TestUser;
let admin: TestUser;

beforeAll(async () => {
  app = await buildServer();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await cleanDb();
  member = await createTestUser({ role: 'member' });
  admin = await createTestUser({ role: 'admin' });
});

function headersFor(who: Who): Record<string, string> {
  switch (who) {
    case 'anon':
      return {};
    case 'member':
      return member.bearer;
    case 'admin':
      return admin.bearer;
    case 'adminKey':
      return { authorization: `Bearer ${TEST_API_KEY}` };
  }
}

describe('route matrix', () => {
  for (const [method, url, expected] of CASES) {
    for (const who of Object.keys(expected) as Who[]) {
      it(`${method} ${url} as ${who} → ${expected[who]}`, async () => {
        const payload = method === 'POST' && url === '/api/libraries' ? { id: `lib-${who.toLowerCase()}`, display_name: 'Lib' } : undefined;
        const r = await app.inject({ method: method as 'GET', url, headers: headersFor(who), payload });
        expect(r.statusCode).toBe(expected[who]);
      });
    }
  }

  it('unauthenticated API calls get 401 with WWW-Authenticate: Bearer', async () => {
    const r = await app.inject({ url: '/api/search?q=x' });
    expect(r.statusCode).toBe(401);
    expect(r.headers['www-authenticate']).toBe('Bearer');
    expect(r.json()).toEqual({ error: 'authentication required' });
  });

  it('an invalid bearer token is anonymous', async () => {
    const r = await app.inject({ url: '/api/libraries', headers: { authorization: 'Bearer wrong-key' } });
    expect(r.statusCode).toBe(401);
  });

  it('anonymous GET / redirects to /login?returnTo=%2F', async () => {
    const r = await app.inject({ url: '/' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/login?returnTo=%2F');
  });

  it('the redirect keeps the query string', async () => {
    const r = await app.inject({ url: '/?q=orders' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`/login?returnTo=${encodeURIComponent('/?q=orders')}`);
  });

  it('a web session cookie reads, chats and pushes (admin) like a token', async () => {
    expect((await app.inject({ url: '/api/libraries', headers: { cookie: member.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/sessions', headers: { cookie: member.cookie } })).statusCode).toBe(200);
    const push = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers: { cookie: admin.cookie, origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: { id: 'via-cookie', display_name: 'Lib' },
    });
    expect(push.statusCode).toBe(201);
  });

  it('creating users, resetting passwords and changing roles need an admin web session or the admin key', async () => {
    const asCookie = { cookie: admin.cookie };
    const create = { login: `made-${Date.now()}`, password: 'a-long-password-1', role: 'member' };
    expect((await app.inject({ method: 'POST', url: '/api/users', headers: admin.bearer, payload: create })).statusCode).toBe(403);
    const made = await app.inject({ method: 'POST', url: '/api/users', headers: asCookie, payload: create });
    expect(made.statusCode).toBe(201);
    const id = made.json().id as string;
    const reset = (headers: Record<string, string>) =>
      app.inject({ method: 'POST', url: `/api/users/${id}/password`, headers, payload: { password: 'another-password-2' } });
    expect((await reset(admin.bearer)).statusCode).toBe(403);
    expect((await reset(asCookie)).statusCode).toBe(204);
    expect((await reset({ authorization: `Bearer ${TEST_API_KEY}` })).statusCode).toBe(204);
    const patch = (headers: Record<string, string>, payload: object) => app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers, payload });
    const roleByToken = await patch(admin.bearer, { role: 'admin' });
    expect(roleByToken.statusCode).toBe(403);
    expect(roleByToken.json().code).toBe('forbidden');
    expect((await patch(admin.bearer, { display_name: 'Renamed', disabled: true })).statusCode).toBe(200);
    expect((await patch(asCookie, { role: 'admin' })).json()).toMatchObject({ role: 'admin' });
    expect((await patch({ authorization: `Bearer ${TEST_API_KEY}` }, { role: 'member' })).json()).toMatchObject({ role: 'member' });
  });

  it('cross-site POST with a valid cookie is still 403', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers: { cookie: admin.cookie, 'sec-fetch-site': 'cross-site' },
      payload: { id: 'evil', display_name: 'Evil' },
    });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/libraries/evil', headers: admin.bearer })).statusCode).toBe(404);
  });

  it('a revoked sk_ token is 401', async () => {
    await getDb().execute(sql`update api_tokens set revoked_at = now() where user_id = ${member.id}`);
    const r = await app.inject({ url: '/api/libraries', headers: member.bearer });
    expect(r.statusCode).toBe(401);
  });

  it('a disabled user\'s sk_ token is 401', async () => {
    await getDb().execute(sql`update users set disabled = true where id = ${member.id}`);
    const r = await app.inject({ url: '/api/libraries', headers: member.bearer });
    expect(r.statusCode).toBe(401);
  });

  it('POST /api/libraries returns no api_key', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/libraries', headers: admin.bearer, payload: { id: 'no-key', display_name: 'No key' } });
    expect(r.statusCode).toBe(201);
    expect(r.json().api_key).toBeUndefined();
    const again = await app.inject({ method: 'POST', url: '/api/libraries', headers: admin.bearer, payload: { id: 'no-key', display_name: 'Renamed' } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: 'no-key', display_name: 'Renamed' });
    expect(again.json().api_key).toBeUndefined();
  });

  it('migration 0009 removed libraries.api_key_hash', async () => {
    const rows = (await getDb().execute(
      sql`select column_name from information_schema.columns where table_name = 'libraries' and column_name = 'api_key_hash'`,
    )) as unknown as unknown[];
    expect(rows).toHaveLength(0);
  });
});

describe('registerAuthorization', () => {
  it('registering a route without a policy throws', async () => {
    const container = buildContainer();
    const bare = Fastify();
    registerAuthorization(bare, container);
    bare.get('/api/unlisted', async () => 'x');
    await expect(bare.ready()).rejects.toThrow('no access policy for GET /api/unlisted');
  });

  it('a route inside a plugin without a policy fails the plugin', async () => {
    const container = buildContainer();
    const bare = Fastify();
    registerAuthorization(bare, container);
    await expect(
      bare.register(async (child) => {
        child.post('/api/also-unlisted', async () => 'x');
      }),
    ).rejects.toThrow('no access policy for POST /api/also-unlisted');
  });

  it('every route of buildServer() has a policy', async () => {
    const built = await buildServer();
    await expect(built.ready()).resolves.toBeDefined();
    await built.close();
  });

  it('policy keys are METHOD + URL', () => {
    for (const key of Object.keys(ROUTE_POLICY)) expect(key).toMatch(/^(GET|POST|PATCH|PUT|DELETE) \//);
  });
});

const user = (role: 'admin' | 'member', via: 'session' | 'token' = 'token') =>
  ({ kind: 'user', userId: 'u', login: 'u', displayName: 'U', role, via }) as const;
const adminKey = { kind: 'admin-key' } as const;

describe('allows', () => {

  it('public lets anyone in', () => {
    expect(allows('public', null)).toBe('ok');
  });

  it('every other access needs a caller', () => {
    for (const a of ['read', 'push-read', 'push', 'chat', 'session', 'admin', 'admin-session'] as const) {
      expect(allows(a, null)).toBe('unauthenticated');
    }
  });

  it('read and push-read admit users and the admin key', () => {
    for (const a of ['read', 'push-read'] as const) {
      expect(allows(a, user('member'))).toBe('ok');
      expect(allows(a, adminKey)).toBe('ok');
    }
  });

  it('push and admin admit admins and the admin key only', () => {
    for (const a of ['push', 'admin'] as const) {
      expect(allows(a, user('member'))).toBe('forbidden');
      expect(allows(a, user('admin'))).toBe('ok');
      expect(allows(a, user('admin', 'session'))).toBe('ok');
      expect(allows(a, adminKey)).toBe('ok');
    }
  });

  it('chat admits users only', () => {
    expect(allows('chat', user('member'))).toBe('ok');
    expect(allows('chat', adminKey)).toBe('forbidden');
  });

  it('session admits users signed in with a web session only', () => {
    expect(allows('session', user('member', 'session'))).toBe('ok');
    expect(allows('session', user('admin', 'token'))).toBe('forbidden');
    expect(allows('session', adminKey)).toBe('forbidden');
  });

  it('admin-session admits an admin with a web session and the admin key, not sk_ tokens', () => {
    expect(allows('admin-session', null)).toBe('unauthenticated');
    expect(allows('admin-session', user('admin', 'session'))).toBe('ok');
    expect(allows('admin-session', adminKey)).toBe('ok');
    expect(allows('admin-session', user('admin', 'token'))).toBe('forbidden');
    expect(allows('admin-session', user('member', 'session'))).toBe('forbidden');
    expect(allows('admin-session', { kind: 'project', keyId: 'k', namespaceId: 'n', libraryId: null, name: 'ci' } as never)).toBe('forbidden');
  });
});
