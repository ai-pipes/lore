import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildServer } from '../../platform/http/server.js';
import { getDb } from '../../platform/db.js';
import { cleanDb, createTestUser, TEST_API_KEY } from '../helpers.js';
import { nodeSecrets } from '../../modules/identity/infrastructure/secrets.js';
import { createPgIdentity } from '../../modules/identity/infrastructure/compose.js';
import { bootstrapAdmin } from '../../modules/identity/index.js';

const PASSWORD = 'correct-horse-battery';
const cookieOf = (setCookie: unknown) => String(setCookie).split(';')[0];

async function login(app: FastifyInstance, user: string, password: string, remoteAddress = '127.0.0.1') {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: user, password }, remoteAddress });
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await cleanDb();
});

describe('password sign-in', () => {
  it('logs in and returns a Lax HttpOnly cookie', async () => {
    const u = await createTestUser({ password: PASSWORD });
    const r = await login(app, u.login.toUpperCase(), PASSWORD);
    expect(r.statusCode).toBe(204);
    const [session, device] = [r.headers['set-cookie']].flat().map(String);
    expect(session).toMatch(/^lore_session=[A-Za-z0-9_-]{43}; .*HttpOnly; SameSite=Lax/);
    expect(session).toContain('Path=/');
    expect(session).toContain('Max-Age=604800');
    expect(session).not.toContain('Secure');
    expect(device).toMatch(/^lore_device=v1\./); // the known-device cookie
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie: cookieOf(r.headers['set-cookie']) } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ kind: 'user', login: u.login, role: 'member' });
  });

  it('signing in again ends the session the browser had (no stale or fixated session survives)', async () => {
    const u = await createTestUser({ password: PASSWORD });
    const first = cookieOf((await login(app, u.login, PASSWORD)).headers['set-cookie']);
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: u.login, password: PASSWORD },
      headers: { cookie: first },
    });
    expect(again.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: first } })).statusCode).toBe(401);
    const second = cookieOf(again.headers['set-cookie']);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: second } })).statusCode).toBe(200);
  });

  it('marks the cookie Secure when LORE_COOKIE_SECURE=true', async () => {
    process.env.LORE_COOKIE_SECURE = 'true';
    const secureApp = await buildServer();
    try {
      const u = await createTestUser({ password: PASSWORD });
      const r = await login(secureApp, u.login, PASSWORD);
      expect(String(r.headers['set-cookie'])).toMatch(/; Secure$/);
    } finally {
      delete process.env.LORE_COOKIE_SECURE;
      await secureApp.close();
    }
  });

  it('stores only the hash of the session id', async () => {
    const u = await createTestUser({ password: PASSWORD });
    const r = await login(app, u.login, PASSWORD);
    const value = cookieOf(r.headers['set-cookie']).slice('lore_session='.length);
    const rows = (await getDb().execute(sql`select id_hash from web_sessions where user_id = ${u.id} order by created_at desc`)) as unknown as { id_hash: string }[];
    const hashes = rows.map((x) => x.id_hash);
    expect(hashes).not.toContain(value);
    expect(hashes).toContain(nodeSecrets.sha256Hex(value));
  });

  it('a wrong password and an unknown login are 401 invalid_credentials without a cookie', async () => {
    const u = await createTestUser({ password: PASSWORD });
    for (const r of [await login(app, u.login, 'wrong-password-123'), await login(app, 'nobody', PASSWORD)]) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: 'invalid_credentials' });
      expect(r.headers['set-cookie']).toBeUndefined();
    }
  });

  it('disabled user gets invalid_credentials', async () => {
    const u = await createTestUser({ password: PASSWORD });
    await getDb().execute(sql`update users set disabled = true where id = ${u.id}`);
    const r = await login(app, u.login, PASSWORD);
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'invalid_credentials' });
    // and the existing session of a disabled user stops working
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: u.cookie } })).statusCode).toBe(401);
  });

  it.each([
    ['no body', undefined],
    ['a missing password', { login: 'alice' }],
    ['a non-string login', { login: 1, password: PASSWORD }],
  ])('%s is 400', async (_name, payload) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload, headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(400);
  });

  it('urlencoded body on /api/auth/login is 415', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `login=a&password=${PASSWORD}`,
    });
    expect(r.statusCode).toBe(415);
  });

  it('a cross-site login post is 403', async () => {
    const u = await createTestUser({ password: PASSWORD });
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { login: u.login, password: PASSWORD },
    });
    expect(r.statusCode).toBe(403);
  });

  it('the 11th failure on a login is 429 with Retry-After, from any IP, for existing and unknown logins alike', async () => {
    const limited = await buildServer(); // its own limiter
    try {
      const u = await createTestUser({ password: PASSWORD });
      for (const name of [u.login, 'no-such-user']) {
        for (let i = 1; i <= 10; i++) {
          expect((await login(limited, name, `wrong-password-${i}`, `198.51.100.${i}`)).statusCode).toBe(401);
        }
        const r = await login(limited, name, 'wrong-password-11', '198.51.100.11');
        expect(r.statusCode).toBe(429);
        expect(r.json()).toEqual({ error: 'rate_limited' });
        expect(Number(r.headers['retry-after'])).toBe(900);
      }
      // a hard lock: even the right password from a fresh address
      expect((await login(limited, u.login, PASSWORD, '203.0.113.8')).statusCode).toBe(429);
      // other logins are unaffected
      const other = await createTestUser({ password: PASSWORD });
      expect((await login(limited, other.login, PASSWORD, '198.51.100.1')).statusCode).toBe(204);
    } finally {
      await limited.close();
    }
  });

  it('a known device (lore_device cookie from an earlier sign-in) still signs in while the login is locked', async () => {
    const limited = await buildServer();
    try {
      const u = await createTestUser({ password: PASSWORD });
      const first = await login(limited, u.login, PASSWORD, '203.0.113.20');
      expect(first.statusCode).toBe(204);
      const set = [first.headers['set-cookie']].flat().map(String);
      const device = set.find((c) => c.startsWith('lore_device='))!;
      expect(device).toMatch(/; Max-Age=7776000; Path=\/api\/auth\/login; HttpOnly; SameSite=Lax$/);
      const deviceCookie = device.split(';')[0];
      for (let i = 1; i <= 11; i++) await login(limited, u.login, `wrong-password-${i}`, `198.51.100.${i}`);
      expect((await login(limited, u.login, PASSWORD, '203.0.113.20')).statusCode).toBe(429);
      const known = await limited.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login: u.login, password: PASSWORD },
        remoteAddress: '203.0.113.20',
        headers: { cookie: deviceCookie },
      });
      expect(known.statusCode).toBe(204);
      // a forged device cookie does not
      const forged = await limited.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login: u.login, password: PASSWORD },
        remoteAddress: '203.0.113.21',
        headers: { cookie: `${deviceCookie}x` },
      });
      expect(forged.statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('an admin unlocks a locked login', async () => {
    const limited = await buildServer();
    try {
      const u = await createTestUser({ password: PASSWORD });
      const admin = await createTestUser({ role: 'admin' });
      for (let i = 1; i <= 11; i++) await login(limited, u.login, `wrong-password-${i}`, `198.51.100.${i}`);
      expect((await login(limited, u.login, PASSWORD, '203.0.113.30')).statusCode).toBe(429);
      const member = await createTestUser();
      const denied = await limited.inject({ method: 'POST', url: `/api/users/${u.id}/unlock`, headers: member.bearer });
      expect(denied.statusCode).toBe(403);
      const r = await limited.inject({ method: 'POST', url: `/api/users/${u.id}/unlock`, headers: { cookie: admin.cookie } });
      expect(r.statusCode).toBe(204);
      expect((await login(limited, u.login, PASSWORD, '203.0.113.30')).statusCode).toBe(204);
      const unknown = await limited.inject({
        method: 'POST',
        url: '/api/users/00000000-0000-0000-0000-000000000000/unlock',
        headers: { cookie: admin.cookie },
      });
      expect(unknown.statusCode).toBe(404);
    } finally {
      await limited.close();
    }
  });

  it('51 failures from one IP across many logins lock that IP (password spraying)', async () => {
    const limited = await buildServer();
    try {
      const u = await createTestUser({ password: PASSWORD });
      for (let n = 1; n <= 50; n++) {
        expect((await login(limited, `nobody-${n}`, 'spray-password-1', '203.0.113.50')).statusCode).toBe(401);
      }
      expect((await login(limited, u.login, PASSWORD, '203.0.113.50')).statusCode).toBe(429);
      expect((await login(limited, u.login, PASSWORD, '203.0.113.51')).statusCode).toBe(204);
    } finally {
      await limited.close();
    }
  });

  /** Locks one client address behind the proxy by spraying 50 logins, then signs in from another. */
  const lockAndRetry = async (server: FastifyInstance) => {
    const u = await createTestUser({ password: PASSWORD });
    const viaProxy = (loginName: string, password: string, client: string) =>
      server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login: loginName, password },
        remoteAddress: '10.9.9.9',
        headers: { 'x-forwarded-for': client },
      });
    for (let i = 1; i <= 51; i++) await viaProxy(`nobody-${i}`, 'spray-password-1', '198.51.100.20');
    return (await viaProxy(u.login, PASSWORD, '198.51.100.21')).statusCode;
  };

  it('LORE_TRUST_PROXY: the client address comes from X-Forwarded-For behind a trusted proxy', async () => {
    const proxied = await buildServer({ trustProxy: ['10.9.9.9'] });
    try {
      expect(await lockAndRetry(proxied)).toBe(204);
    } finally {
      await proxied.close();
    }
  });

  it('without LORE_TRUST_PROXY, X-Forwarded-For is ignored (a client cannot pick its address)', async () => {
    const direct = await buildServer({ trustProxy: false });
    try {
      expect(await lockAndRetry(direct)).toBe(429);
    } finally {
      await direct.close();
    }
  });
});

describe('web sessions', () => {
  it('GET /api/auth/me is 401 when anonymous', async () => {
    const r = await app.inject({ url: '/api/auth/me' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'authentication required' });
    expect(r.headers['www-authenticate']).toBe('Bearer');
  });

  it('GET /api/auth/me knows sk_ tokens and the admin key', async () => {
    const u = await createTestUser({ role: 'admin', displayName: 'Ada' });
    expect((await app.inject({ url: '/api/auth/me', headers: u.bearer })).json()).toEqual({
      kind: 'user', login: u.login, display_name: 'Ada', role: 'admin',
    });
    expect((await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${TEST_API_KEY}` } })).json()).toEqual({
      kind: 'admin-key', role: 'admin',
    });
    expect((await app.inject({ url: '/api/auth/me', headers: { authorization: 'Bearer sk_unknown' } })).statusCode).toBe(401);
  });

  it('logout deletes the session; the cookie stops working', async () => {
    const u = await createTestUser({ password: PASSWORD });
    const r = await login(app, u.login, PASSWORD);
    const cookie = cookieOf(r.headers['set-cookie']);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^lore_session=; Max-Age=0; Path=\/; HttpOnly; SameSite=Lax/);
    const rows = (await getDb().execute(sql`select 1 from web_sessions where user_id = ${u.id}`)) as unknown as unknown[];
    expect(rows).toHaveLength(1); // only the createTestUser session is left
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
    // logging out without a session is still fine
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(204);
  });

  it('expired session is rejected and deleted', async () => {
    const u = await createTestUser();
    await getDb().execute(sql`update web_sessions set expires_at = now() - interval '1 second' where user_id = ${u.id}`);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: u.cookie } })).statusCode).toBe(401);
    const rows = (await getDb().execute(sql`select 1 from web_sessions where user_id = ${u.id}`)) as unknown as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('sliding: a session older than 5 min gets a new expiry and cookie', async () => {
    const u = await createTestUser();
    // last extended 10 minutes ago
    await getDb().execute(sql`update web_sessions set expires_at = now() + interval '7 days' - interval '10 minutes' where user_id = ${u.id}`);
    const before = (await getDb().execute(sql`select expires_at from web_sessions where user_id = ${u.id}`)) as unknown as { expires_at: Date }[];
    const r = await app.inject({ url: '/api/auth/me', headers: { cookie: u.cookie } });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['set-cookie'])).toBe(`${u.cookie}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`);
    const after = (await getDb().execute(sql`select expires_at from web_sessions where user_id = ${u.id}`)) as unknown as { expires_at: Date }[];
    expect(new Date(after[0].expires_at).getTime()).toBeGreaterThan(new Date(before[0].expires_at).getTime() + 9 * 60_000);
    // a fresh session is not rewritten on every request
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: u.cookie } })).headers['set-cookie']).toBeUndefined();
  });
});

describe('login page and auth config', () => {
  it('GET /api/auth/config reports password sign-in', async () => {
    const r = await app.inject({ url: '/api/auth/config' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ method: 'password' });
  });

  it('the login page is served under the strict CSP with no inline code', async () => {
    const r = await app.inject({ url: '/login' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/html/);
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.body).toContain('data-page="login"');
    expect(r.body).toContain('<script src="/assets/account.js" defer></script>');
    expect(r.body).toContain('<link rel="stylesheet" href="/assets/lore.css">');
    expect(r.body).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(r.body).not.toMatch(/\sstyle=|\son[a-z]+=/i);
  });

  it('serves account.js', async () => {
    const r = await app.inject({ url: '/assets/account.js' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/javascript/);
    expect(r.body).toContain('/api/auth/login');
  });

  it('keeps health checks, UI assets and the login page reachable without credentials', async () => {
    for (const url of ['/health', '/health/ready', '/assets/lore.css', '/assets/account.js', '/assets/vendor/purify.min.js', '/login']) {
      expect((await app.inject({ url })).statusCode).toBe(200);
    }
  });
});

describe('bootstrapAdmin', () => {
  it('bootstrapAdmin creates once, then exists; skipped without env', async () => {
    const d = createPgIdentity({});
    const log = { info: () => {}, warn: () => {} };
    expect(await bootstrapAdmin(d, {}, log)).toBe('skipped');
    expect(await bootstrapAdmin(d, { login: 'root', password: 'root-password-123' }, log)).toBe('created');
    expect(await bootstrapAdmin(d, { login: 'root', password: 'root-password-123' }, log)).toBe('exists');
    const r = await login(app, 'root', 'root-password-123');
    expect(r.statusCode).toBe(204);
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie: cookieOf(r.headers['set-cookie']) } });
    expect(me.json()).toEqual({ kind: 'user', login: 'root', display_name: 'root', role: 'admin' });
  });
});
