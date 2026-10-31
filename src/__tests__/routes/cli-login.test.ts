import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildServer } from '../../platform/http/server.js';
import { getDb } from '../../platform/db.js';
import { cleanDb, createTestUser, type TestUser } from '../helpers.js';
import { createPgIdentity } from '../../modules/identity/infrastructure/compose.js';
import { nodeSecrets } from '../../modules/identity/infrastructure/secrets.js';
import type { IdentityDeps } from '../../modules/identity/index.js';

let app: FastifyInstance;
let identity: IdentityDeps;
let u: TestUser;
let ipSeq = 0;

beforeAll(async () => {
  app = await buildServer();
  identity = createPgIdentity({});
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await cleanDb();
  u = await createTestUser({ role: 'member' });
});
afterEach(() => {
  vi.useRealTimers();
});

const listTokens = (d: IdentityDeps, userId: string) => d.tokens.listByUser(userId);

async function start(hostname = 'devbox', remoteAddress = `10.1.0.${++ipSeq % 250}`) {
  return app.inject({ method: 'POST', url: '/api/cli/login/start', payload: { hostname }, remoteAddress });
}

async function poll(deviceCode: string) {
  const r = await app.inject({ method: 'POST', url: '/api/cli/login/poll', payload: { device_code: deviceCode } });
  expect(r.statusCode).toBe(200);
  return r.json();
}

function approve(userCode: string, ok: boolean, headers: Record<string, string> = { cookie: u.cookie }) {
  return app.inject({ method: 'POST', url: '/api/cli/login/approve', headers, payload: { user_code: userCode, approve: ok } });
}

describe('CLI device login', () => {
  it('full flow issues exactly one cli-<hostname> token', async () => {
    const r = await start();
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const s = r.json();
    expect(s).toMatchObject({ user_code: expect.stringMatching(/^[B-Z]{4}-[B-Z]{4}$/), interval: 5, expires_in: 600 });
    expect(s.verification_url).toBe('http://localhost:80/cli/login');
    expect((await poll(s.device_code)).status).toBe('pending');
    const a = await approve(s.user_code, true);
    expect(a.statusCode).toBe(204);
    const p = await poll(s.device_code);
    expect(p).toMatchObject({ status: 'approved', token: expect.stringMatching(/^sk_/), login: u.login, role: 'member' });
    expect((await poll(s.device_code)).status).toBe('expired'); // Review Focus 4: second poll gets nothing
    expect((await listTokens(identity, u.id)).filter((t) => t.name === 'cli-devbox')).toHaveLength(1);
    const me = await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${p.token}` } });
    expect(me.json()).toMatchObject({ kind: 'user', login: u.login });
    // the CLI token expires after 90 days (LORE_CLI_TOKEN_TTL_DAYS); the Tokens API shows when
    const listed = (await app.inject({ url: '/api/tokens', headers: { cookie: u.cookie } })).json() as { name: string; expires_at: string | null }[];
    const cli = listed.find((t) => t.name === 'cli-devbox')!;
    const days = (Date.parse(cli.expires_at!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90);
  });

  it('LORE_CLI_TOKEN_TTL_DAYS sets the CLI token lifetime; an expired CLI token is 401', async () => {
    process.env.LORE_CLI_TOKEN_TTL_DAYS = '7';
    const other = await buildServer();
    try {
      const s = (await other.inject({ method: 'POST', url: '/api/cli/login/start', payload: { hostname: 'week' } })).json();
      await other.inject({ method: 'POST', url: '/api/cli/login/approve', headers: { cookie: u.cookie }, payload: { user_code: s.user_code, approve: true } });
      const p = (await other.inject({ method: 'POST', url: '/api/cli/login/poll', payload: { device_code: s.device_code } })).json();
      const rows = (await getDb().execute(sql`select expires_at from api_tokens where name = 'cli-week'`)) as unknown as { expires_at: Date }[];
      const days = (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
      const auth = { authorization: `Bearer ${p.token}` };
      expect((await other.inject({ url: '/api/auth/me', headers: auth })).statusCode).toBe(200);
      await getDb().execute(sql`update api_tokens set expires_at = now() - interval '1 second' where name = 'cli-week'`);
      expect((await other.inject({ url: '/api/auth/me', headers: auth })).statusCode).toBe(401);
    } finally {
      delete process.env.LORE_CLI_TOKEN_TTL_DAYS;
      await other.close();
    }
  });

  it('uses PUBLIC_URL for the verification url when it is set', async () => {
    process.env.PUBLIC_URL = 'https://lore.example/';
    const other = await buildServer();
    try {
      const s = (await other.inject({ method: 'POST', url: '/api/cli/login/start', payload: { hostname: 'devbox' } })).json();
      expect(s.verification_url).toBe('https://lore.example/cli/login');
    } finally {
      delete process.env.PUBLIC_URL;
      await other.close();
    }
  });

  it('approving twice or after 10 minutes is rejected and issues nothing', async () => {
    // twice
    const s = (await start()).json();
    expect((await approve(s.user_code, true)).statusCode).toBe(204);
    const again = await approve(s.user_code, true);
    expect(again.statusCode).toBe(409);
    expect((await approve(s.user_code, false)).statusCode).toBe(409);
    expect((await poll(s.device_code)).status).toBe('approved');
    expect((await poll(s.device_code)).status).toBe('expired');

    // after 10 minutes (clock fake)
    const late = (await start('laptop')).json();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    const r = await approve(late.user_code, true);
    expect(r.statusCode).toBe(410);
    expect((await poll(late.device_code)).status).toBe('expired');
    vi.useRealTimers();

    const names = (await listTokens(identity, u.id)).map((t) => t.name);
    expect(names.filter((n) => n === 'cli-devbox')).toHaveLength(1);
    expect(names).not.toContain('cli-laptop');
  });

  it('deny → poll says denied', async () => {
    const s = (await start()).json();
    expect((await approve(s.user_code, false)).statusCode).toBe(204);
    expect(await poll(s.device_code)).toEqual({ status: 'denied' });
    expect((await listTokens(identity, u.id)).filter((t) => t.name === 'cli-devbox')).toHaveLength(0);
    // Denied for good: enabling the approver again does not revive the request
    await getDb().execute(sql`update users set disabled = false where id = ${u.id}`);
    expect(await poll(s.device_code)).toEqual({ status: 'denied' });
    expect((await listTokens(identity, u.id)).filter((t) => t.name === 'cli-devbox')).toHaveLength(0);
  });

  it('parallel polls of an approved request mint exactly one token', async () => {
    const s = (await start()).json();
    await approve(s.user_code, true);
    const results = await Promise.all(Array.from({ length: 8 }, () => poll(s.device_code)));
    expect(results.filter((r) => r.status === 'approved')).toHaveLength(1);
    expect(results.filter((r) => r.status !== 'approved').every((r) => r.status === 'expired')).toBe(true);
    expect((await listTokens(identity, u.id)).filter((t) => t.name === 'cli-devbox')).toHaveLength(1);
  });

  it('approve with Sec-Fetch-Site: cross-site is 403 and stays pending', async () => {
    const s = (await start()).json();
    const r = await approve(s.user_code, true, { cookie: u.cookie, 'sec-fetch-site': 'cross-site' });
    expect(r.statusCode).toBe(403);
    const evil = await approve(s.user_code, true, { cookie: u.cookie, origin: 'https://evil.example' });
    expect(evil.statusCode).toBe(403);
    expect((await poll(s.device_code)).status).toBe('pending');
  });

  it('approve with an sk_ bearer (not a session) is 403', async () => {
    const s = (await start()).json();
    const r = await approve(s.user_code, true, u.bearer);
    expect(r.statusCode).toBe(403);
    expect((await poll(s.device_code)).status).toBe('pending');
    const anon = await approve(s.user_code, true, {});
    expect(anon.statusCode).toBe(401);
  });

  it('device_code is stored hashed', async () => {
    const s = (await start()).json();
    const rows = (await getDb().execute(sql`select device_code_hash, user_code, hostname, status, request_ip from cli_logins`)) as unknown as {
      device_code_hash: string;
      user_code: string;
      hostname: string;
      status: string;
      request_ip: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_code: s.user_code, hostname: 'devbox', status: 'pending', request_ip: `10.1.0.${ipSeq % 250}` });
    expect(rows[0].device_code_hash).toBe(nodeSecrets.sha256Hex(s.device_code));
    expect(JSON.stringify(rows)).not.toContain(s.device_code);
  });

  it('the approval page is a blank code form, even when a link carries a code, and passes CSP', async () => {
    const s = (await start('build-box.local')).json();
    for (const url of ['/cli/login', `/cli/login?code=${s.user_code}`]) {
      const r = await app.inject({ url, headers: { cookie: u.cookie } });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toMatch(/^text\/html/);
      expect(r.headers['content-security-policy']).toContain("default-src 'self'");
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body).toContain('id="cliCodeForm"');
      expect(r.body).toMatch(/<input[^>]*id="cliCodeInput"(?![^>]*\bvalue=)[^>]*>/);
      expect(r.body).not.toContain(s.user_code);
      expect(r.body).not.toContain('build-box.local');
      expect(r.body).toContain('reported by the CLI');
      expect(r.body).toContain('id="cliIp"');
      expect(r.body).toContain('id="cliApprove"');
      expect(r.body).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(r.body).not.toMatch(/\sstyle=/);
      expect(r.body).not.toMatch(/\son[a-z]+=/);
    }
  });

  it('anonymous callers are sent to the sign-in page and back', async () => {
    const s = (await start()).json();
    const r = await app.inject({ url: `/cli/login?code=${s.user_code}` });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`/login?returnTo=${encodeURIComponent(`/cli/login?code=${s.user_code}`)}`);
  });

  it('GET /api/cli/login/:userCode describes the request to a session', async () => {
    const s = (await start()).json();
    const r = await app.inject({ url: `/api/cli/login/${s.user_code}`, headers: { cookie: u.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ hostname: 'devbox', user_code: s.user_code, status: 'pending', requested_ip: `10.1.0.${ipSeq % 250}` });
    expect((await app.inject({ url: '/api/cli/login/BBBB-BBBB', headers: { cookie: u.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/cli/login/${s.user_code}`, headers: u.bearer })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/cli/login/${s.user_code}` })).statusCode).toBe(401);
  });

  it('bad bodies are 400', async () => {
    expect((await start('bad host')).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/cli/login/start', payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/cli/login/poll', payload: {} })).statusCode).toBe(400);
    const r = await app.inject({
      method: 'POST',
      url: '/api/cli/login/approve',
      headers: { cookie: u.cookie },
      payload: { user_code: 'BBBB-BBBB', approve: 'yes' },
    });
    expect(r.statusCode).toBe(400);
    expect((await approve('BBBB-BBBB', true)).statusCode).toBe(404);
  });

  it('an unknown device code polls as expired', async () => {
    expect(await poll('not-a-real-device-code')).toEqual({ status: 'expired' });
  });

  it('a disabled approver gets no token', async () => {
    const s = (await start()).json();
    await approve(s.user_code, true);
    await getDb().execute(sql`update users set disabled = true where id = ${u.id}`);
    expect(await poll(s.device_code)).toEqual({ status: 'denied' });
    expect((await listTokens(identity, u.id)).filter((t) => t.name === 'cli-devbox')).toHaveLength(0);
  });

  it('31st start from one IP is 429', async () => {
    const ip = '10.9.9.9';
    for (let i = 0; i < 30; i++) expect((await start('devbox', ip)).statusCode).toBe(200);
    const r = await start('devbox', ip);
    expect(r.statusCode).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect((await start('devbox', '10.9.9.10')).statusCode).toBe(200);
  });
});
