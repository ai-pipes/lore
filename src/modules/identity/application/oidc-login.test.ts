import { describe, expect, it } from 'vitest';
import {
  claims,
  FAKE_ISSUER,
  fakeIdentity,
  fakeOidcProvider,
  fakeSso,
  type FakeIdentity,
} from '../../../../test/fakes/identity.js';
import { IdentityError } from '../domain/user.js';
import { bootstrapAdmin } from './bootstrap.js';
import { pollDeviceLogin } from './device-login.js';
import { completeSsoLogin, linkSso, startSsoLogin, unlinkSso } from './oidc-login.js';
import { passwordLogin } from './sessions.js';

const IP = '192.0.2.1';
const member = (sub: string, extra: Partial<Parameters<typeof claims>[0]> = {}) =>
  claims({ sub, groups: ['lore-users'], ...extra });

function sso(o: { ssoStartLimit?: number } = {}) {
  const s = fakeSso();
  const d = fakeIdentity({ sso: s, ...o });
  return { d, provider: s.provider };
}

/** The whole flow: start, then the callback with the state the provider hands back. */
async function signIn(d: FakeIdentity, returnTo = '/', iss: string | null = FAKE_ISSUER) {
  const started = await startSsoLogin(d, { returnTo, ip: IP });
  if (!started.ok) throw started.error;
  return completeSsoLogin(d, { state: started.value.state, code: 'code-1', ip: IP, ...(iss ? { iss } : {}) });
}

describe('startSsoLogin', () => {
  it('remembers the attempt and sends a PKCE S256 challenge, state and nonce', async () => {
    const { d, provider } = sso();
    const r = await startSsoLogin(d, { returnTo: '/docs?x=1', ip: IP });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [sent] = provider.authorizations;
    const pending = d.pendingLogins.rows.get(r.value.state)!;
    expect(sent!.state).toBe(r.value.state);
    expect(sent!.codeChallenge).toBe(d.secrets.sha256B64url(pending.codeVerifier));
    expect(sent!.nonce).toBe(pending.nonce);
    expect(pending.nonce).not.toBe(pending.state);
    expect(pending.returnTo).toBe('/docs?x=1');
    expect(pending.expiresAt.getTime() - d.clock.now().getTime()).toBe(600_000);
    expect(r.value.url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('turns an off-site returnTo into /', async () => {
    const { d } = sso();
    const r = await startSsoLogin(d, { returnTo: '//evil.example', ip: IP });
    expect(r.ok && d.pendingLogins.rows.get(r.value.state)!.returnTo).toBe('/');
  });

  it('idp_unavailable, and nothing remembered, when the provider is down', async () => {
    const { d, provider } = sso();
    provider.down = true;
    const r = await startSsoLogin(d, { returnTo: '/', ip: IP });
    expect(!r.ok && r.error.code).toBe('idp_unavailable');
    expect(d.pendingLogins.rows.size).toBe(0);
  });

  it('an unexpected start error propagates', async () => {
    const { d, provider } = sso();
    provider.startError = new Error('boom');
    await expect(startSsoLogin(d, { returnTo: '/', ip: IP })).rejects.toThrow('boom');
  });

  it('rate-limits starts per IP and stores nothing then', async () => {
    const { d } = sso({ ssoStartLimit: 2 });
    expect((await startSsoLogin(d, { returnTo: '/', ip: IP })).ok).toBe(true);
    const r = await startSsoLogin(d, { returnTo: '/', ip: IP });
    expect(!r.ok && r.error.code).toBe('rate_limited');
    expect(!r.ok && r.error.retryAfterSec).toBe(900);
    expect(d.pendingLogins.rows.size).toBe(1);
    expect((await startSsoLogin(d, { returnTo: '/', ip: '192.0.2.2' })).ok).toBe(true);
  });


  it('not_found without single sign-on', async () => {
    const d = fakeIdentity();
    const r = await startSsoLogin(d, { returnTo: '/', ip: IP });
    expect(!r.ok && r.error.code).toBe('not_found');
    const c = await completeSsoLogin(d, { state: 's', code: 'c', ip: IP });
    expect(!c.ok && c.error.code).toBe('not_found');
  });
});

describe('completeSsoLogin', () => {
  it('creates a member from preferred_username with the name as display name, and opens a session', async () => {
    const { d, provider } = sso();
    provider.answer = member('sub-anna', { preferredUsername: 'Anna', name: 'Anna Example', email: 'a@x.test' });
    const r = await signIn(d, '/docs');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.returnTo).toBe('/docs');
    const anna = await d.users.findByLogin('anna');
    expect(anna).toMatchObject({
      role: 'member',
      displayName: 'Anna Example',
      oidcIss: FAKE_ISSUER,
      oidcSub: 'sub-anna',
      email: 'a@x.test',
      groups: ['lore-users'],
      passwordHash: null,
    });
    expect(anna!.lastLoginAt).toEqual(d.clock.now());
    expect(d.sessions.rows.get(d.secrets.sha256Hex(r.value.sessionId))?.userId).toBe(anna!.id);
    expect(provider.exchanges[0]).toMatchObject({ code: 'code-1', iss: FAKE_ISSUER });
  });

  it('display name falls back to the login; no iss is passed when the provider sent none', async () => {
    const { d, provider } = sso();
    provider.answer = member('sub-b', { preferredUsername: 'bob' });
    expect((await signIn(d, '/', null)).ok).toBe(true);
    expect((await d.users.findByLogin('bob'))!.displayName).toBe('bob');
    expect(provider.exchanges[0]).not.toHaveProperty('iss');
  });

  it('makes the admin group admins and re-syncs role, groups and email on every sign-in', async () => {
    const { d, provider } = sso();
    provider.answer = member('sub-c', { preferredUsername: 'carol', groups: ['lore-admins'] });
    await signIn(d);
    expect((await d.users.findByLogin('carol'))!.role).toBe('admin');
    provider.answer = member('sub-c', { preferredUsername: 'ignored', name: 'Carol C', email: 'c@x.test' });
    expect((await signIn(d)).ok).toBe(true);
    expect(await d.users.findByLogin('carol')).toMatchObject({
      role: 'member',
      groups: ['lore-users'],
      email: 'c@x.test',
      displayName: 'Carol C',
    });
    expect(d.users.store).toHaveLength(1);
  });

  it('a new person colliding with a local login gets a suffix, never a link', async () => {
    const { d, provider } = sso();
    const local = await d.users.insert({ login: 'anna', displayName: 'Local', role: 'admin', passwordHash: 'plain$pw' });
    await d.users.insert({ login: 'anna-2', displayName: 'Local 2', role: 'member' });
    provider.answer = member('sub-anna', { preferredUsername: 'anna', email: 'anna@x.test', emailVerified: true });
    expect((await signIn(d)).ok).toBe(true);
    expect((await d.users.findByLogin('anna-3'))!.oidcSub).toBe('sub-anna');
    expect((await d.users.findById(local!.id))!.oidcSub).toBeNull();
  });

  it('gives up after 100 taken logins', async () => {
    const { d, provider } = sso();
    for (let n = 1; n <= 100; n++) await d.users.insert({ login: n === 1 ? 'x' : `x-${n}`, displayName: 'x', role: 'member' });
    provider.answer = member('sub-x', { preferredUsername: 'x' });
    await expect(signIn(d)).rejects.toThrow(/no free login/);
  });

  it('a concurrent first sign-in of the same person lands on the user the other one created', async () => {
    const { d, provider } = sso();
    provider.answer = member('sub-r', { preferredUsername: 'rita' });
    const insert = d.users.insert.bind(d.users);
    let raced = false;
    d.users.insert = async (u) => {
      if (!raced) {
        raced = true;
        await insert({ ...u, login: 'rita-other' }); // the other request won with the same subject
      }
      return insert(u);
    };
    const r = await signIn(d);
    expect(r.ok).toBe(true);
    expect(d.users.store).toHaveLength(1);
    expect(d.users.store[0]!.login).toBe('rita-other');
  });

  it('...and is refused when that user is disabled', async () => {
    const { d, provider } = sso();
    provider.answer = member('sub-r', { preferredUsername: 'rita' });
    const insert = d.users.insert.bind(d.users);
    let raced = false;
    d.users.insert = async (u) => {
      if (!raced) {
        raced = true;
        const other = await insert({ ...u, login: 'rita-other' });
        await d.users.update(other!.id, { disabled: true });
      }
      return insert(u);
    };
    const r = await signIn(d);
    expect(!r.ok && r.error.code).toBe('disabled');
    expect(d.sessions.rows.size).toBe(0);
  });

  it('refuses a person in neither group, creates nobody and ends a known person’s sessions', async () => {
    const { d, provider } = sso();
    provider.answer = member('sub-d', { preferredUsername: 'dan' });
    const first = await signIn(d);
    expect(first.ok).toBe(true);
    const dan = (await d.users.findByLogin('dan'))!;
    await d.tokens.insert({ userId: dan.id, name: 't', prefix: 'sk_x', hash: 'h' });
    await d.deviceLogins.insert({
      deviceCodeHash: d.secrets.sha256Hex('dan-device'), userCode: 'BCDF-GHJK', hostname: 'laptop', requestIp: IP,
      expiresAt: new Date(d.clock.now().getTime() + 600_000),
    });
    await d.deviceLogins.decide('BCDF-GHJK', dan.id, 'approved', d.clock.now());
    provider.answer = claims({ sub: 'sub-d', groups: ['other'] });
    const r = await signIn(d);
    expect(!r.ok && r.error.code).toBe('not_allowed');
    expect(d.sessions.rows.size).toBe(0);
    expect(d.tokens.rows).toHaveLength(1);
    // an approval given while still allowed mints no token now
    expect(await pollDeviceLogin(d, 'dan-device')).toEqual({ status: 'denied' });
    expect(d.tokens.rows).toHaveLength(1);
    provider.answer = claims({ sub: 'sub-new' });
    const stranger = await signIn(d);
    expect(!stranger.ok && stranger.error.code).toBe('not_allowed');
    expect(d.users.store).toHaveLength(1);
  });

  it('refuses a disabled user', async () => {
    const { d, provider } = sso();
    provider.answer = member('sub-e', { preferredUsername: 'eve' });
    await signIn(d);
    const eve = (await d.users.findByLogin('eve'))!;
    await d.users.update(eve.id, { disabled: true });
    d.sessions.rows.clear();
    const r = await signIn(d);
    expect(!r.ok && r.error.code).toBe('disabled');
    expect(d.sessions.rows.size).toBe(0);
  });

  it('accepts a state only once, and not after it expired', async () => {
    const { d, provider } = sso();
    provider.answer = member('sub-1');
    const s = await startSsoLogin(d, { returnTo: '/', ip: IP });
    if (!s.ok) throw s.error;
    expect((await completeSsoLogin(d, { state: s.value.state, code: 'c', ip: IP })).ok).toBe(true);
    const replay = await completeSsoLogin(d, { state: s.value.state, code: 'c', ip: IP });
    expect(!replay.ok && replay.error.code).toBe('invalid_state');

    const late = await startSsoLogin(d, { returnTo: '/', ip: IP });
    if (!late.ok) throw late.error;
    d.clock.advance(600_000);
    const expired = await completeSsoLogin(d, { state: late.value.state, code: 'c', ip: IP });
    expect(!expired.ok && expired.error.code).toBe('invalid_state');
    expect(d.pendingLogins.rows.size).toBe(0);
  });

  it('a rejected code exchange is invalid_state; an outage is idp_unavailable', async () => {
    const { d, provider } = sso();
    provider.answer = new Error('invalid_grant');
    const rejected = await signIn(d);
    expect(!rejected.ok && rejected.error.code).toBe('invalid_state');
    provider.answer = new IdentityError('idp_unavailable', 'down');
    const down = await signIn(d);
    expect(!down.ok && down.error.code).toBe('idp_unavailable');
    expect(d.users.store).toHaveLength(0);
  });

  it('the same sub at another issuer is another person', async () => {
    const { d, provider } = sso();
    await d.users.insert({ login: 'old', displayName: 'old', role: 'admin', oidcIss: 'https://other', oidcSub: 'sub-1' });
    provider.answer = member('sub-1', { preferredUsername: 'new' });
    expect((await signIn(d)).ok).toBe(true);
    expect((await d.users.findByLogin('new'))!.oidcIss).toBe(FAKE_ISSUER);
  });
});

describe('linkSso / unlinkSso', () => {
  it('links a password user; sign-in then lands on that user, keeping login and password', async () => {
    const { d, provider } = sso();
    const u = (await d.users.insert({ login: 'root', displayName: 'Root', role: 'member', passwordHash: 'plain$pw' }))!;
    expect((await linkSso(d, 'ROOT', 'sub-root')).ok).toBe(true);
    expect((await linkSso(d, 'root', 'sub-root')).ok).toBe(true); // same pair: a no-op
    provider.answer = member('sub-root', { preferredUsername: 'someone-else', groups: ['lore-admins'] });
    expect((await signIn(d)).ok).toBe(true);
    expect(d.users.store).toHaveLength(1);
    expect(await d.users.findById(u.id)).toMatchObject({ login: 'root', role: 'admin', passwordHash: 'plain$pw' });
  });

  it('refuses a sub linked to another user; unknown login is not_found; empty sub is invalid_input', async () => {
    const { d } = sso();
    await d.users.insert({ login: 'a', displayName: 'a', role: 'member', oidcIss: FAKE_ISSUER, oidcSub: 'sub-a' });
    await d.users.insert({ login: 'b', displayName: 'b', role: 'member' });
    const taken = await linkSso(d, 'b', 'sub-a');
    expect(!taken.ok && taken.error.code).toBe('sso_linked');
    const missing = await linkSso(d, 'nobody', 'sub-x');
    expect(!missing.ok && missing.error.code).toBe('not_found');
    const empty = await linkSso(d, 'b', ' ');
    expect(!empty.ok && empty.error.code).toBe('invalid_input');
  });

  it('a user deleted meanwhile is not_found', async () => {
    const { d } = sso();
    await d.users.insert({ login: 'b', displayName: 'b', role: 'member' });
    d.users.update = async () => null;
    const r = await linkSso(d, 'b', 'sub-a');
    expect(!r.ok && r.error.code).toBe('not_found');
  });

  it('linkSso needs single sign-on (it stores the issuer)', async () => {
    const d = fakeIdentity();
    await d.users.insert({ login: 'b', displayName: 'b', role: 'member' });
    const r = await linkSso(d, 'b', 'sub-a');
    expect(!r.ok && r.error.code).toBe('not_found');
  });

  it('unlinks; an unknown login is not_found', async () => {
    const d = fakeIdentity();
    const u = (await d.users.insert({ login: 'a', displayName: 'a', role: 'member', oidcIss: FAKE_ISSUER, oidcSub: 's' }))!;
    expect((await unlinkSso(d, 'a')).ok).toBe(true);
    expect(await d.users.findById(u.id)).toMatchObject({ oidcIss: null, oidcSub: null });
    const r = await unlinkSso(d, 'nobody');
    expect(!r.ok && r.error.code).toBe('not_found');
  });
});

describe('password features in single sign-on mode', () => {
  it('password login is sso_only, before any limiter or hash work', async () => {
    const { d } = sso();
    await d.users.insert({ login: 'root', displayName: 'r', role: 'admin', passwordHash: 'plain$pw-123456789' });
    const r = await passwordLogin(d, { login: 'root', password: 'pw-123456789', ip: IP });
    expect(!r.ok && r.error.code).toBe('sso_only');
    expect(d.hasher.verifyCalls).toBe(0);
    expect(d.loginAccountLimiter.counts.size + d.loginIpLimiter.counts.size).toBe(0);
  });

  it('bootstrapAdmin ignores LORE_ADMIN_LOGIN/PASSWORD with a warning', async () => {
    const { d } = sso();
    const lines: string[] = [];
    const log = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(`warn ${m}`) };
    expect(await bootstrapAdmin(d, { login: 'root', password: 'root-password-123' }, log)).toBe('skipped');
    expect(lines).toEqual(['warn LORE_ADMIN_LOGIN/LORE_ADMIN_PASSWORD are ignored in SSO mode']);
    expect(await bootstrapAdmin(d, {}, log)).toBe('skipped');
    expect(lines).toHaveLength(1);
    expect(d.users.store).toHaveLength(0);
  });
});

it('fakeOidcProvider default answer has no groups', () => {
  expect(fakeOidcProvider().answer).toMatchObject({ groups: [] });
});
