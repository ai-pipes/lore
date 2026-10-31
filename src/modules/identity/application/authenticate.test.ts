import { describe, expect, it } from 'vitest';
import { fakeIdentity } from '../../../../test/fakes/identity.js';
import { SESSION_REFRESH_AFTER_MS, SESSION_TTL_MS } from '../domain/session-policy.js';
import { authenticateBearer, authenticateSession } from './authenticate.js';
import { passwordLogin, startSession } from './sessions.js';

async function setup() {
  const d = fakeIdentity({ adminKey: 'admin-key-0123456789abcdef' });
  const user = (await d.users.insert({
    login: 'alice',
    displayName: 'Alice A.',
    role: 'admin',
    passwordHash: await d.hasher.hash('correct-horse-battery'),
  }))!;
  const r = await passwordLogin(d, { login: 'alice', password: 'correct-horse-battery', ip: '1.2.3.4' });
  if (!r.ok) throw r.error;
  const token = d.secrets.random('sk_');
  const record = await d.tokens.insert({ userId: user.id, name: 'laptop', prefix: token.slice(0, 8), hash: d.secrets.sha256Hex(token) });
  return { d, user, sessionId: r.value.sessionId, token, record };
}

describe('authenticateSession with a single sign-on session', () => {
  const HOUR = 3600_000;
  async function ssoSession(maxHours?: number) {
    const { d, user } = await setup();
    if (maxHours !== undefined) d.ssoSessionMaxHours = maxHours;
    const { sessionId } = await startSession(d, user.id, 'sso');
    return { d, user, sessionId };
  }

  it('records the method and a 24-hour deadline; a password session has none', async () => {
    const { d, sessionId } = await ssoSession();
    expect(d.sessions.rows.get(d.secrets.sha256Hex(sessionId))).toMatchObject({
      method: 'sso',
      deadline: new Date(d.clock.now().getTime() + 24 * HOUR),
    });
    const { d: p, sessionId: pid } = await setup();
    expect(p.sessions.rows.get(p.secrets.sha256Hex(pid))).toMatchObject({ method: 'password', deadline: null });
  });

  it('stays signed in while active before the deadline, even past the 5-minute refresh', async () => {
    const { d, sessionId } = await ssoSession();
    d.clock.advance(23 * HOUR);
    expect(await authenticateSession(d, sessionId)).not.toBeNull();
  });

  it('is signed out and deleted after the deadline although the sliding expiry has days left', async () => {
    const { d, sessionId } = await ssoSession();
    d.clock.advance(23 * HOUR);
    await authenticateSession(d, sessionId); // activity slides the 7-day expiry
    d.clock.advance(HOUR);
    expect(await authenticateSession(d, sessionId)).toBeNull();
    expect(d.sessions.rows.has(d.secrets.sha256Hex(sessionId))).toBe(false);
  });

  it('honours a configured deadline', async () => {
    const { d, sessionId } = await ssoSession(2);
    d.clock.advance(2 * HOUR - 1);
    expect(await authenticateSession(d, sessionId)).not.toBeNull();
    d.clock.advance(1);
    expect(await authenticateSession(d, sessionId)).toBeNull();
  });

  it('a password session keeps sliding past 24 hours', async () => {
    const { d, sessionId } = await setup();
    for (let day = 0; day < 10; day++) {
      d.clock.advance(24 * HOUR);
      expect(await authenticateSession(d, sessionId)).not.toBeNull();
    }
  });
});

describe('authenticateSession', () => {
  it('resolves a fresh session to its user without refreshing it', async () => {
    const { d, user, sessionId } = await setup();
    expect(await authenticateSession(d, sessionId)).toEqual({
      principal: { kind: 'user', userId: user.id, login: 'alice', displayName: 'Alice A.', role: 'admin', via: 'session' },
      refreshedUntil: null,
    });
  });

  it('slides the expiry once the session was last extended more than 5 minutes ago', async () => {
    const { d, sessionId } = await setup();
    d.clock.advance(SESSION_REFRESH_AFTER_MS + 1000);
    const r = await authenticateSession(d, sessionId);
    const until = new Date(d.clock.now().getTime() + SESSION_TTL_MS);
    expect(r?.refreshedUntil).toEqual(until);
    expect(d.sessions.rows.get(d.secrets.sha256Hex(sessionId))).toMatchObject({ expiresAt: until, lastSeenAt: d.clock.now() });
    expect((await authenticateSession(d, sessionId))?.refreshedUntil).toBeNull();
  });

  it('rejects and deletes an expired session', async () => {
    const { d, sessionId } = await setup();
    d.clock.advance(SESSION_TTL_MS);
    expect(await authenticateSession(d, sessionId)).toBeNull();
    expect(d.sessions.rows.size).toBe(0);
  });

  it('rejects unknown sessions and sessions of disabled or deleted users', async () => {
    const { d, user, sessionId } = await setup();
    expect(await authenticateSession(d, 'nope')).toBeNull();
    await d.users.update(user.id, { disabled: true });
    expect(await authenticateSession(d, sessionId)).toBeNull();
    d.users.store.length = 0;
    expect(await authenticateSession(d, sessionId)).toBeNull();
  });
});

describe('authenticateBearer', () => {
  it('resolves an sk_ token to its owner and records its use', async () => {
    const { d, user, token, record } = await setup();
    expect(await authenticateBearer(d, token)).toEqual({
      kind: 'user', userId: user.id, login: 'alice', displayName: 'Alice A.', role: 'admin', via: 'token', tokenId: record.id,
    });
    expect(d.tokens.rows[0].lastUsedAt).toEqual(d.clock.now());
  });

  it('rejects revoked tokens, tokens of disabled or deleted users and unknown tokens', async () => {
    const { d, user, token, record } = await setup();
    expect(await authenticateBearer(d, 'sk_unknown')).toBeNull();
    await d.users.update(user.id, { disabled: true });
    expect(await authenticateBearer(d, token)).toBeNull();
    await d.users.update(user.id, { disabled: false });
    expect(await authenticateBearer(d, token)).not.toBeNull();
    await d.tokens.revoke(user.id, record.id, d.clock.now());
    expect(await authenticateBearer(d, token)).toBeNull();
    const other = d.secrets.random('sk_');
    await d.tokens.insert({ userId: 'gone', name: 'x', prefix: 'sk_', hash: d.secrets.sha256Hex(other) });
    expect(await authenticateBearer(d, other)).toBeNull();
  });

  it('rejects a token at or after its expiry', async () => {
    const { d, user } = await setup();
    const t = d.secrets.random('sk_');
    await d.tokens.insert({
      userId: user.id, name: 'cli-x', prefix: 'sk_', hash: d.secrets.sha256Hex(t), expiresAt: new Date(d.clock.now().getTime() + 1000),
    });
    expect(await authenticateBearer(d, t)).not.toBeNull();
    d.clock.advance(1000);
    expect(await authenticateBearer(d, t)).toBeNull();
  });

  it('accepts the break-glass admin key, and nothing else', async () => {
    const { d } = await setup();
    expect(await authenticateBearer(d, 'admin-key-0123456789abcdef')).toEqual({ kind: 'admin-key' });
    expect(await authenticateBearer(d, 'admin-key-0123456789abcdeX')).toBeNull();
    expect(await authenticateBearer(d, '')).toBeNull();
    expect(await authenticateBearer(d, 'lpk_whatever')).toBeNull();
    expect(await authenticateBearer({ ...d, adminKey: undefined }, 'admin-key-0123456789abcdef')).toBeNull();
  });
});
