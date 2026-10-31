import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { cleanDb, createTestUser, TEST_API_KEY, type TestUser } from '../helpers.js';

let app: FastifyInstance;
let admin: TestUser;
let member: TestUser;
const ADMIN_KEY = { authorization: `Bearer ${TEST_API_KEY}` };
const PW = 'a-good-long-password';

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

const me = (headers: Record<string, string>) => app.inject({ url: '/api/auth/me', headers });
const search = (headers: Record<string, string>) => app.inject({ url: '/api/search?q=x', headers });
const patch = (id: string, payload: object, headers: Record<string, string> = { cookie: admin.cookie }) =>
  app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers, payload });

describe('users administration API', () => {
  it('lists users as UserSummary objects; the admin key may list them', async () => {
    const r = await app.inject({ url: '/api/users', headers: ADMIN_KEY });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const list = r.json();
    expect(list).toHaveLength(2);
    expect(list.map((u: { login: string }) => u.login)).toEqual(expect.arrayContaining([admin.login, member.login]));
    for (const u of list) {
      expect(new Set(Object.keys(u))).toEqual(new Set(['created_at', 'disabled', 'display_name', 'id', 'last_login_at', 'login', 'role', 'sso']));
    }
    expect(list.find((u: { id: string }) => u.id === admin.id)).toMatchObject({ role: 'admin', disabled: false, sso: false, last_login_at: null });
  });

  it('a member gets 403 on every users route; anonymous gets 401', async () => {
    expect((await app.inject({ url: '/api/users', headers: { cookie: member.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/users', headers: member.bearer })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/users', headers: member.bearer, payload: {} })).statusCode).toBe(403);
    expect((await patch(admin.id, { disabled: true }, member.bearer)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/users/${admin.id}/password`, headers: member.bearer, payload: { password: PW } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/admin/users', headers: { cookie: member.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/users' })).statusCode).toBe(401);
  });

  it('serves the Users page to an admin', async () => {
    const r = await app.inject({ url: '/admin/users', headers: { cookie: admin.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('data-page="users"');
  });

  it('creates a member (201) who can then sign in', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/users', headers: { cookie: admin.cookie },
      payload: { login: 'NewBie', display_name: 'New Bie', password: PW, role: 'member' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ login: 'newbie', display_name: 'New Bie', role: 'member', disabled: false, sso: false });
    expect(JSON.stringify(r.json())).not.toContain(PW);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'newbie', password: PW } });
    expect(login.statusCode).toBe(204);
  });

  it('an 11-character password gets 400', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/users', headers: { cookie: admin.cookie },
      payload: { login: 'shorty', display_name: 'S', password: 'x'.repeat(11), role: 'member' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('a malformed body gets 400', async () => {
    for (const payload of [{}, { login: 'x', password: PW, role: 'boss' }, { login: 5, password: PW, role: 'member' }, { login: 'bad login', password: PW, role: 'member' }]) {
      const r = await app.inject({ method: 'POST', url: '/api/users', headers: ADMIN_KEY, payload });
      expect(r.statusCode).toBe(400);
    }
    expect((await patch(member.id, { role: 'boss' })).statusCode).toBe(400);
    expect((await patch(member.id, { disabled: 'yes' })).statusCode).toBe(400);
    expect((await patch(member.id, { display_name: 7 })).statusCode).toBe(400);
  });

  it('a duplicate login in a different case gets 409', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/users', headers: { cookie: admin.cookie },
      payload: { login: member.login.toUpperCase(), display_name: 'Dup', password: PW, role: 'member' },
    });
    expect(r.statusCode).toBe(409);
  });

  it('disabling a user makes their cookie and sk_ token 401; enabling restores the token, not the session', async () => {
    expect((await me({ cookie: member.cookie })).statusCode).toBe(200);
    expect((await search(member.bearer)).statusCode).toBe(200);
    const off = await patch(member.id, { disabled: true });
    expect(off.statusCode).toBe(200);
    expect(off.json().disabled).toBe(true);
    expect((await me({ cookie: member.cookie })).statusCode).toBe(401);
    expect((await search(member.bearer)).statusCode).toBe(401);

    const on = await patch(member.id, { disabled: false });
    expect(on.statusCode).toBe(200);
    expect((await search(member.bearer)).statusCode).toBe(200);
    expect((await me({ cookie: member.cookie })).statusCode).toBe(401);
  });

  it('changes the role and the display name', async () => {
    const r = await patch(member.id, { role: 'admin', display_name: 'Promoted' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ role: 'admin', display_name: 'Promoted' });
    expect((await app.inject({ url: '/api/users', headers: member.bearer })).statusCode).toBe(200);
  });

  it('disabling or demoting yourself gets 403', async () => {
    expect((await patch(admin.id, { disabled: true })).statusCode).toBe(403);
    expect((await patch(admin.id, { role: 'member' }, admin.bearer)).statusCode).toBe(403);
    expect((await me({ cookie: admin.cookie })).statusCode).toBe(200);
  });

  it('an unknown id gets 404', async () => {
    expect((await patch('00000000-0000-0000-0000-000000000000', { disabled: true })).statusCode).toBe(404);
    expect((await patch('not-a-uuid', { disabled: true })).statusCode).toBe(404);
    const pw = await app.inject({ method: 'POST', url: '/api/users/not-a-uuid/password', headers: ADMIN_KEY, payload: { password: PW } });
    expect(pw.statusCode).toBe(404);
  });

  it('a password reset (204) ends the target\'s sessions and sets the new password', async () => {
    const weak = await app.inject({ method: 'POST', url: `/api/users/${member.id}/password`, headers: { cookie: admin.cookie }, payload: { password: 'short' } });
    expect(weak.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/users/${member.id}/password`, headers: ADMIN_KEY, payload: {} })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: `/api/users/${member.id}/password`, headers: { cookie: admin.cookie }, payload: { password: PW } });
    expect(r.statusCode).toBe(204);
    expect((await me({ cookie: member.cookie })).statusCode).toBe(401);
    expect((await me({ cookie: admin.cookie })).statusCode).toBe(200);
    const old = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: member.login, password: member.password } });
    expect(old.statusCode).toBe(401);
    const fresh = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: member.login, password: PW } });
    expect(fresh.statusCode).toBe(204);
    // the member's sk_ token was revoked with the reset
    expect((await me(member.bearer)).statusCode).toBe(401);
  });

  it('guessing the current password locks the login and ends the guessing session', async () => {
    const limited = await buildServer(); // its own limiter
    try {
      const url = `/api/users/${admin.id}/password`;
      const guess = (n: number) =>
        limited.inject({ method: 'POST', url, headers: { cookie: admin.cookie }, payload: { password: PW, current_password: `guess-${n}-guess` } });
      for (let n = 1; n <= 10; n++) expect((await guess(n)).statusCode).toBe(403);
      const locked = await guess(11);
      expect(locked.statusCode).toBe(429);
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
      expect((await limited.inject({ url: '/api/auth/me', headers: { cookie: admin.cookie } })).statusCode).toBe(401);
    } finally {
      await limited.close();
    }
  });

  it('an admin resetting their own password must send current_password', async () => {
    const url = `/api/users/${admin.id}/password`;
    const missing = await app.inject({ method: 'POST', url, headers: { cookie: admin.cookie }, payload: { password: PW } });
    expect(missing.statusCode).toBe(403);
    const wrong = await app.inject({ method: 'POST', url, headers: { cookie: admin.cookie }, payload: { password: PW, current_password: 'nope-nope-nope' } });
    expect(wrong.statusCode).toBe(403);
    const bad = await app.inject({ method: 'POST', url, headers: { cookie: admin.cookie }, payload: { password: PW, current_password: 1 } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url, headers: { cookie: admin.cookie }, payload: { password: PW, current_password: admin.password } });
    expect(ok.statusCode).toBe(204);
  });
});

describe('users administration in SSO mode', () => {
  let sso: FastifyInstance;
  beforeAll(async () => {
    sso = await buildServer({
      sso: {
        issuer: 'http://127.0.0.1:9/', clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/api/auth/sso/callback',
        scopes: 'openid', groupsClaim: 'groups', policy: { loginGroup: 'lore-users', adminGroup: 'lore-admins' }, allowInsecure: true,
      },
    });
  });
  afterAll(async () => {
    await sso.close();
  });

  it('creating a user or resetting a password gets 409; disabling still works', async () => {
    const c = await sso.inject({ method: 'POST', url: '/api/users', headers: ADMIN_KEY, payload: { login: 'x', display_name: 'X', password: PW, role: 'member' } });
    expect(c.statusCode).toBe(409);
    const p = await sso.inject({ method: 'POST', url: `/api/users/${member.id}/password`, headers: ADMIN_KEY, payload: { password: PW } });
    expect(p.statusCode).toBe(409);
    const d = await sso.inject({ method: 'PATCH', url: `/api/users/${member.id}`, headers: ADMIN_KEY, payload: { disabled: true } });
    expect(d.statusCode).toBe(200);
  });
});
