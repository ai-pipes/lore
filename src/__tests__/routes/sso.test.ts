import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { cleanDb, createTestUser } from '../helpers.js';
import { createPgIdentity, linkSso, type SsoConfig } from '../../modules/identity/index.js';
import { getDb } from '../../platform/db.js';
import { web_sessions } from '../../modules/identity/infrastructure/schema.js';
import { FakeIdp, type FakeClaims } from '../../../test/fakes/fake-idp.js';

const ORIGIN = 'http://lore.test';
const PASSWORD = 'correct-horse-battery';

let idp: FakeIdp;
let app: FastifyInstance;
let ipSeq = 0;

function ssoConfig(overrides: Partial<SsoConfig> = {}): SsoConfig {
  return {
    issuer: idp.issuer,
    clientId: idp.clientId,
    clientSecret: idp.clientSecret,
    redirectUri: `${ORIGIN}/api/auth/sso/callback`,
    scopes: 'openid profile email groups',
    groupsClaim: 'groups',
    policy: { loginGroup: 'lore-users', adminGroup: 'lore-admins' },
    allowInsecure: true, // the fake provider listens on plain http
    ...overrides,
  };
}

const setCookies = (r: LightMyRequestResponse): string[] => {
  const h = r.headers['set-cookie'];
  return h === undefined ? [] : [h].flat().map(String);
};
const cookieLine = (r: LightMyRequestResponse, name: string) => setCookies(r).find((c) => c.startsWith(`${name}=`));
const cookiePair = (r: LightMyRequestResponse, name: string) => (cookieLine(r, name) ?? '').split(';')[0] ?? '';

/** Walks a browser through the whole flow; returns the callback response. */
async function signIn(claims: FakeClaims, o: { returnTo?: string; target?: FastifyInstance; ip?: string; session?: string } = {}) {
  const target = o.target ?? app;
  const remoteAddress = o.ip ?? `198.51.100.${++ipSeq % 250}`;
  const start = await target.inject({
    url: `/api/auth/sso/login?returnTo=${encodeURIComponent(o.returnTo ?? '/docs')}`,
    remoteAddress,
  });
  expect(start.statusCode).toBe(302);
  const location = new URL(String(start.headers.location));
  expect(location.origin).toBe(idp.issuer);
  expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/sso/callback`);
  const code = idp.authorize(location, claims);
  const state = location.searchParams.get('state') ?? '';
  const binding = cookiePair(start, 'lore_sso');
  expect(binding).toBe(`lore_sso=${state}`);
  const url = `/api/auth/sso/callback?code=${code}&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(idp.issuer)}`;
  const cookie = o.session ? `${binding}; ${o.session}` : binding;
  const callback = await target.inject({ url, headers: { cookie }, remoteAddress });
  // The one-time binding cookie is cleared whatever the outcome.
  expect(cookieLine(callback, 'lore_sso')).toMatch(/^lore_sso=; Max-Age=0; Path=\/api\/auth\/sso; HttpOnly; SameSite=Lax/);
  return { start, callback, url, binding, location };
}

const me = (target: FastifyInstance, cookie: string) => target.inject({ url: '/api/auth/me', headers: { cookie } });
const loginErrorOf = (r: LightMyRequestResponse) => String(r.headers.location);

beforeAll(async () => {
  idp = new FakeIdp();
  await idp.start();
  app = await buildServer({ sso: ssoConfig() });
});
afterAll(async () => {
  await app.close();
  await idp.stop();
});
beforeEach(async () => {
  await cleanDb();
  idp.discoveryDown = false;
  idp.groupsOnlyInUserInfo = false;
  idp.tokenStatus = null;
});

describe('single sign-on through the fake provider', () => {
  it('GET /api/auth/config reports sso', async () => {
    expect((await app.inject({ url: '/api/auth/config' })).json()).toEqual({ method: 'sso' });
  });

  it('first sign-in creates a member from preferred_username and sets the session cookie', async () => {
    const { callback } = await signIn({ sub: 'sub-anna', preferred_username: 'Anna', name: 'Anna Example', groups: ['lore-users'] });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/docs');
    expect(cookieLine(callback, 'lore_session')).toMatch(/^lore_session=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax$/);
    const r = await me(app, cookiePair(callback, 'lore_session'));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ kind: 'user', login: 'anna', display_name: 'Anna Example', role: 'member' });
  });

  it('an sso session ends 24 hours after sign-in: 401, row deleted, signing in again works', async () => {
    const claims = { sub: 'sub-dora', preferred_username: 'dora', groups: ['lore-users'] };
    const { callback } = await signIn(claims);
    const cookie = cookiePair(callback, 'lore_session');
    const [row] = await getDb().select().from(web_sessions);
    expect(row?.sign_in_method).toBe('sso');
    expect(row!.absolute_expires_at!.getTime() - row!.created_at.getTime()).toBeGreaterThan(23.9 * 3600_000);
    expect((await me(app, cookie)).statusCode).toBe(200);
    // The 24 hours pass; the 7-day sliding expiry alone would keep the session.
    await getDb().update(web_sessions).set({ absolute_expires_at: new Date(Date.now() - 1000) });
    expect((await me(app, cookie)).statusCode).toBe(401);
    expect(await getDb().select().from(web_sessions)).toHaveLength(0);
    const again = await signIn(claims);
    expect((await me(app, cookiePair(again.callback, 'lore_session'))).statusCode).toBe(200);
  });

  it('the binding cookie is Lax, scoped to /api/auth/sso and lives 600 s', async () => {
    const { start } = await signIn({ sub: 's', groups: ['lore-users'] });
    expect(cookieLine(start, 'lore_sso')).toMatch(/^lore_sso=[A-Za-z0-9_-]+; Max-Age=600; Path=\/api\/auth\/sso; HttpOnly; SameSite=Lax$/);
  });

  it('admin group → admin; role re-synced to member on next sign-in', async () => {
    const first = await signIn({ sub: 'sub-c', preferred_username: 'carol', groups: ['lore-admins'] });
    expect((await me(app, cookiePair(first.callback, 'lore_session'))).json()).toMatchObject({ role: 'admin' });
    const second = await signIn({ sub: 'sub-c', preferred_username: 'carol', groups: ['lore-users'] });
    expect((await me(app, cookiePair(second.callback, 'lore_session'))).json()).toMatchObject({ login: 'carol', role: 'member' });
    // the first session follows the user's current role too
    expect((await me(app, cookiePair(first.callback, 'lore_session'))).json()).toMatchObject({ role: 'member' });
  });

  it('signing in again ends the session the browser had', async () => {
    const first = cookiePair((await signIn({ sub: 'sub-e', preferred_username: 'erin', groups: ['lore-users'] })).callback, 'lore_session');
    const again = await signIn({ sub: 'sub-e', preferred_username: 'erin', groups: ['lore-users'] }, { session: first });
    expect((await me(app, first)).statusCode).toBe(401);
    expect((await me(app, cookiePair(again.callback, 'lore_session'))).statusCode).toBe(200);
  });

  it('person in neither group is refused (loginError=not_allowed) and loses existing sessions', async () => {
    const first = await signIn({ sub: 'sub-d', preferred_username: 'dan', groups: ['lore-users'] });
    const cookie = cookiePair(first.callback, 'lore_session');
    expect((await me(app, cookie)).statusCode).toBe(200);
    const { callback } = await signIn({ sub: 'sub-d', preferred_username: 'dan', groups: ['others'] });
    expect(loginErrorOf(callback)).toBe('/login?loginError=not_allowed');
    expect(cookieLine(callback, 'lore_session')).toBeUndefined();
    expect((await me(app, cookie)).statusCode).toBe(401);
  });

  it('callback without the lore_sso binding cookie → invalid_state', async () => {
    const start = await app.inject({ url: '/api/auth/sso/login', remoteAddress: '198.51.100.251' });
    const location = new URL(String(start.headers.location));
    const code = idp.authorize(location, { sub: 's', groups: ['lore-users'] });
    const state = location.searchParams.get('state') ?? '';
    const url = `/api/auth/sso/callback?code=${code}&state=${state}&iss=${encodeURIComponent(idp.issuer)}`;
    const noCookie = await app.inject({ url });
    expect(loginErrorOf(noCookie)).toBe('/login?loginError=invalid_state');
    const otherCookie = await app.inject({ url, headers: { cookie: 'lore_sso=another-attempt' } });
    expect(loginErrorOf(otherCookie)).toBe('/login?loginError=invalid_state');
    const noParams = await app.inject({ url: '/api/auth/sso/callback?error=access_denied', headers: { cookie: `lore_sso=${state}` } });
    expect(loginErrorOf(noParams)).toBe('/login?loginError=invalid_state');
  });

  it('state is single-use: replaying the callback → invalid_state', async () => {
    const { callback, url, binding } = await signIn({ sub: 's', groups: ['lore-users'] });
    expect(callback.headers.location).toBe('/docs');
    const replay = await app.inject({ url, headers: { cookie: binding } });
    expect(loginErrorOf(replay)).toBe('/login?loginError=invalid_state');
    expect(cookieLine(replay, 'lore_session')).toBeUndefined();
  });

  it('returnTo=//evil.example lands on /', async () => {
    const { callback } = await signIn({ sub: 's', groups: ['lore-users'] }, { returnTo: '//evil.example' });
    expect(callback.headers.location).toBe('/');
  });

  it('authorization URL carries code_challenge_method=S256, state and nonce', async () => {
    const { location } = await signIn({ sub: 's', groups: ['lore-users'] });
    const p = location.searchParams;
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get('nonce')).not.toBe(p.get('state'));
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('openid profile email groups');
  });

  it('groups only in UserInfo are honoured', async () => {
    idp.groupsOnlyInUserInfo = true;
    const { callback } = await signIn({ sub: 'sub-u', preferred_username: 'uma', groups: ['lore-admins'] });
    expect((await me(app, cookiePair(callback, 'lore_session'))).json()).toMatchObject({ login: 'uma', role: 'admin' });
  });

  it('collision with an existing local login gets a -2 suffix, not a link', async () => {
    const local = await createTestUser({ login: 'alice', password: PASSWORD, role: 'admin' });
    const { callback } = await signIn({ sub: 'sub-alice', preferred_username: 'alice', groups: ['lore-users'] });
    expect((await me(app, cookiePair(callback, 'lore_session'))).json()).toMatchObject({ login: 'alice-2', role: 'member' });
    expect((await app.inject({ url: '/api/auth/me', headers: local.bearer })).json()).toMatchObject({ login: 'alice', role: 'admin' });
  });

  it('password login answers 403 sso_only; sk_ tokens still work', async () => {
    const u = await createTestUser({ password: PASSWORD });
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: u.login, password: PASSWORD } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: 'sso_only' });
    expect(r.headers['set-cookie']).toBeUndefined();
    expect((await app.inject({ url: '/api/auth/me', headers: u.bearer })).statusCode).toBe(200);
  });

  it('linkSso then sign-in lands on the linked user', async () => {
    const u = await createTestUser({ login: 'root', password: PASSWORD });
    const linked = await linkSso(createPgIdentity({ sso: ssoConfig() }), 'root', 'sub-root');
    expect(linked.ok).toBe(true);
    const { callback } = await signIn({ sub: 'sub-root', preferred_username: 'someone', groups: ['lore-admins'] });
    expect((await me(app, cookiePair(callback, 'lore_session'))).json()).toMatchObject({ login: 'root', role: 'admin' });
    expect((await app.inject({ url: '/api/auth/me', headers: u.bearer })).json()).toMatchObject({ login: 'root', role: 'admin' });
  });

  it('a 5xx from the token endpoint is idp_unavailable', async () => {
    idp.tokenStatus = 503;
    const { callback } = await signIn({ sub: 's', groups: ['lore-users'] });
    expect(loginErrorOf(callback)).toBe('/login?loginError=idp_unavailable');
  });

  it('a wrong iss is a rejected login', async () => {
    const start = await app.inject({ url: '/api/auth/sso/login', remoteAddress: '198.51.100.252' });
    const location = new URL(String(start.headers.location));
    const code = idp.authorize(location, { sub: 's', groups: ['lore-users'] });
    const state = location.searchParams.get('state') ?? '';
    const r = await app.inject({
      url: `/api/auth/sso/callback?code=${code}&state=${state}&iss=${encodeURIComponent('https://other.example')}`,
      headers: { cookie: `lore_sso=${state}` },
    });
    expect(loginErrorOf(r)).toBe('/login?loginError=invalid_state');
  });

  it('the 31st start from one IP in 10 minutes → loginError=rate_limited', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await app.inject({ url: '/api/auth/sso/login', remoteAddress: '203.0.113.30' });
      expect(new URL(String(r.headers.location)).origin).toBe(idp.issuer);
    }
    const r = await app.inject({ url: '/api/auth/sso/login', remoteAddress: '203.0.113.30' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/login?loginError=rate_limited');
    expect(cookieLine(r, 'lore_sso')).toBeUndefined();
  });

  it('the login page script knows the SSO button and the loginError messages', async () => {
    const js = (await app.inject({ url: '/assets/account.js' })).body;
    expect(js).toContain('/api/auth/config');
    expect(js).toContain('/api/auth/sso/login');
    for (const code of ['invalid_state', 'not_allowed', 'disabled', 'idp_unavailable', 'rate_limited', 'internal']) {
      expect(js).toContain(code);
    }
    expect((await app.inject({ url: '/login' })).body).toContain('id="ssoBtn"');
  });
});

describe('an identity provider that is down', () => {
  it('IdP down → loginError=idp_unavailable; password/tokens unaffected', async () => {
    const fresh = await buildServer({ sso: ssoConfig() }); // no cached discovery
    try {
      idp.discoveryDown = true;
      const r = await fresh.inject({ url: '/api/auth/sso/login' });
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toBe('/login?loginError=idp_unavailable');
      const u = await createTestUser({ password: PASSWORD });
      expect((await fresh.inject({ url: '/api/auth/me', headers: u.bearer })).statusCode).toBe(200);
      expect((await fresh.inject({ url: '/api/auth/me', headers: { cookie: u.cookie } })).statusCode).toBe(200);
      const pw = await fresh.inject({ method: 'POST', url: '/api/auth/login', payload: { login: u.login, password: PASSWORD } });
      expect(pw.statusCode).toBe(403); // still sso_only, not a 5xx
      // once the provider is back, sign-in works
      idp.discoveryDown = false;
      const { callback } = await signIn({ sub: 's', preferred_username: 'back', groups: ['lore-users'] }, { target: fresh });
      expect(callback.headers.location).toBe('/docs');
    } finally {
      await fresh.close();
    }
  });
});

describe('password mode', () => {
  it('the SSO routes are 404 and the config says password', async () => {
    const plain = await buildServer({ sso: null });
    try {
      expect((await plain.inject({ url: '/api/auth/config' })).json()).toEqual({ method: 'password' });
      expect((await plain.inject({ url: '/api/auth/sso/login' })).statusCode).toBe(404);
      expect((await plain.inject({ url: '/api/auth/sso/callback?code=x&state=y' })).statusCode).toBe(404);
    } finally {
      await plain.close();
    }
  });
});
