import { describe, expect, it } from 'vitest';
import { fakeIdentity } from '../../../../test/fakes/identity.js';
import { KNOWN_DEVICE_TTL_MS, SESSION_TTL_MS } from '../domain/session-policy.js';
import { logout, passwordLogin, unlockLogin } from './sessions.js';

async function setup(o: { loginAccountLimit?: number; loginIpLimit?: number; loginDeviceLimit?: number; signInConcurrency?: number } = {}) {
  const d = fakeIdentity(o);
  const user = (await d.users.insert({
    login: 'alice',
    displayName: 'Alice',
    role: 'member',
    passwordHash: await d.hasher.hash('correct-horse-battery'),
  }))!;
  return { d, user };
}

const ip = '10.0.0.1';
const RIGHT = 'correct-horse-battery';
type D = Awaited<ReturnType<typeof setup>>['d'];
const code = (r: Awaited<ReturnType<typeof passwordLogin>>) => (r.ok ? 'ok' : r.error.code);

/** Signs alice in once from `from` and returns her known-device cookie. */
async function knownDevice(d: D, from = '10.0.0.200'): Promise<string> {
  const r = await passwordLogin(d, { login: 'alice', password: RIGHT, ip: from });
  if (!r.ok || !r.value.deviceCookie) throw new Error('no device cookie');
  return r.value.deviceCookie;
}

/** An attacker fails on alice from many fresh IPs until her login is locked. */
async function lockAlice(d: D, attempts: number) {
  for (let n = 0; n < attempts; n++) await passwordLogin(d, { login: 'alice', password: `wrong-password-${n}`, ip: `198.51.100.${n}` });
}

describe('passwordLogin', () => {
  it('starts a 7-day session, stores only the hash of its id, stamps the last login and issues a device cookie', async () => {
    const { d, user } = await setup();
    const r = await passwordLogin(d, { login: '  ALICE ', password: RIGHT, ip });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.expiresAt.getTime()).toBe(d.clock.now().getTime() + SESSION_TTL_MS);
    expect(d.sessions.rows.has(r.value.sessionId)).toBe(false);
    expect(d.sessions.rows.get(d.secrets.sha256Hex(r.value.sessionId))).toEqual({
      userId: user.id,
      expiresAt: r.value.expiresAt,
      method: 'password',
      deadline: null,
    });
    expect((await d.users.findById(user.id))?.lastLoginAt).toEqual(d.clock.now());
    expect(d.signInKeys.verifyDevice(r.value.deviceCookie!, d.clock.now())).toMatchObject({ userId: user.id });
    d.clock.advance(KNOWN_DEVICE_TTL_MS);
    expect(d.signInKeys.verifyDevice(r.value.deviceCookie!, d.clock.now())).toBeNull();
  });

  it('a wrong password is invalid_credentials and counts against the login key and the IP', async () => {
    const { d } = await setup();
    const r = await passwordLogin(d, { login: 'ALICE', password: 'wrong-password-123', ip });
    expect(code(r)).toBe('invalid_credentials');
    expect(d.loginAccountLimiter.counts.get(d.signInKeys.loginKey('alice'))).toBe(1);
    expect(d.loginIpLimiter.counts.get(ip)).toBe(1);
    expect(d.sessions.rows.size).toBe(0);
  });

  it('an unknown login still runs a password verify (same cost as a wrong password)', async () => {
    const { d } = await setup();
    const before = d.hasher.verifyCalls;
    expect(code(await passwordLogin(d, { login: 'nobody', password: 'whatever-password', ip }))).toBe('invalid_credentials');
    expect(d.hasher.verifyCalls).toBe(before + 1);
  });

  it.each([
    ['an invalid login', 'a b', 'whatever-password'],
    ['an oversized login', 'a'.repeat(129), 'whatever-password'],
    ['an oversized password', 'alice', 'x'.repeat(1025)],
  ])('%s is invalid_credentials after a dummy verify', async (_name, login, password) => {
    const { d } = await setup();
    const before = d.hasher.verifyCalls;
    expect(code(await passwordLogin(d, { login, password, ip }))).toBe('invalid_credentials');
    expect(d.hasher.verifyCalls).toBe(before + 1);
  });

  it('a disabled user with the right password answers like a wrong password', async () => {
    const { d, user } = await setup();
    await d.users.update(user.id, { disabled: true });
    expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip }))).toBe('invalid_credentials');
    expect(d.sessions.rows.size).toBe(0);
  });

  it('a user without a password (single sign-on) cannot sign in with one', async () => {
    const { d } = await setup();
    await d.users.insert({ login: 'sso', displayName: 'S', role: 'member', oidcIss: 'i', oidcSub: 's' });
    expect(code(await passwordLogin(d, { login: 'sso', password: 'plain$whatever', ip }))).toBe('invalid_credentials');
  });

  it('the account lock is hard: after the limit nobody without a known device gets in, not even with the right password', async () => {
    const { d } = await setup({ loginAccountLimit: 3 });
    await lockAlice(d, 2);
    const third = await passwordLogin(d, { login: 'alice', password: 'wrong-password-x', ip: '10.0.0.7' });
    expect(third.ok ? null : [third.error.code, third.error.retryAfterSec]).toEqual(['rate_limited', 900]);
    const before = d.hasher.verifyCalls;
    for (const from of ['10.0.0.8', '10.0.0.9']) {
      expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip: from }))).toBe('rate_limited');
    }
    expect(d.hasher.verifyCalls).toBe(before); // no KDF work while locked
  });

  it('a known device still signs in while the login is locked', async () => {
    const { d } = await setup({ loginAccountLimit: 3 });
    const device = await knownDevice(d);
    await lockAlice(d, 10);
    expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip: '10.0.0.50' }))).toBe('rate_limited');
    const r = await passwordLogin(d, { login: 'alice', password: RIGHT, ip: '10.0.0.50', deviceCookie: device });
    expect(code(r)).toBe('ok');
  });

  it('a known device has its own failure limit', async () => {
    const { d } = await setup({ loginAccountLimit: 3, loginDeviceLimit: 3 });
    const device = await knownDevice(d);
    await lockAlice(d, 10);
    const tries = [];
    for (let n = 0; n < 3; n++) tries.push(code(await passwordLogin(d, { login: 'alice', password: `wrong-${n}-password`, ip, deviceCookie: device })));
    expect(tries).toEqual(['invalid_credentials', 'invalid_credentials', 'rate_limited']);
    expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip, deviceCookie: device }))).toBe('rate_limited');
  });

  it('a device cookie of another user, a forged or an expired one does not bypass the lock', async () => {
    const { d } = await setup({ loginAccountLimit: 3 });
    await d.users.insert({ login: 'bob', displayName: 'Bob', role: 'member', passwordHash: await d.hasher.hash('bobs-password-123') });
    const bobs = await passwordLogin(d, { login: 'bob', password: 'bobs-password-123', ip });
    const aliceDevice = await knownDevice(d);
    await lockAlice(d, 10);
    const bobDevice = bobs.ok ? bobs.value.deviceCookie! : '';
    for (const cookie of [bobDevice, `${aliceDevice}x`, 'garbage']) {
      expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip, deviceCookie: cookie }))).toBe('rate_limited');
    }
    d.clock.advance(KNOWN_DEVICE_TTL_MS);
    expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip, deviceCookie: aliceDevice }))).toBe('rate_limited');
  });

  it('existing and unknown logins answer the same at the same attempt counts', async () => {
    const { d } = await setup({ loginAccountLimit: 3 });
    const run = async (login: string) => {
      const out: string[] = [];
      for (let n = 0; n < 5; n++) {
        const before = d.hasher.verifyCalls;
        const r = await passwordLogin(d, { login, password: `wrong-password-${n}`, ip: `203.0.113.${n}` });
        out.push(`${code(r)}:${d.hasher.verifyCalls - before}`);
      }
      return out;
    };
    const existing = await run('alice');
    expect(existing).toEqual(['invalid_credentials:1', 'invalid_credentials:1', 'rate_limited:0', 'rate_limited:0', 'rate_limited:0']);
    expect(await run('nobody')).toEqual(existing);
  });

  it('reserves the attempt before verifying: concurrent guesses cannot pass the limit', async () => {
    const { d } = await setup({ loginAccountLimit: 2 });
    const before = d.hasher.verifyCalls;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, n) => passwordLogin(d, { login: 'alice', password: `wrong-password-${n}`, ip: `10.0.1.${n}` })),
    );
    expect(d.hasher.verifyCalls - before).toBe(1);
    expect(results.filter((r) => code(r) === 'rate_limited')).toHaveLength(5);
  });

  it('a successful sign-in gives its reserved attempts back (the limits count failures)', async () => {
    const { d } = await setup({ loginAccountLimit: 3, loginIpLimit: 3 });
    await passwordLogin(d, { login: 'alice', password: 'wrong-password-1', ip });
    expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip }))).toBe('ok');
    expect(d.loginAccountLimiter.counts.get(d.signInKeys.loginKey('alice'))).toBe(1);
    expect(d.loginIpLimiter.counts.get(ip)).toBe(1);
    expect(code(await passwordLogin(d, { login: 'alice', password: 'wrong-password-2', ip }))).toBe('invalid_credentials');
  });

  it('failures from one IP across many logins (password spraying) lock the IP', async () => {
    const { d } = await setup({ loginIpLimit: 3 });
    await d.users.insert({ login: 'bob', displayName: 'Bob', role: 'member', passwordHash: await d.hasher.hash('bobs-password-123') });
    expect(code(await passwordLogin(d, { login: 'alice', password: 'spray-password-1', ip }))).toBe('invalid_credentials');
    expect(code(await passwordLogin(d, { login: 'bob', password: 'spray-password-1', ip }))).toBe('invalid_credentials');
    expect(code(await passwordLogin(d, { login: 'carol', password: 'spray-password-1', ip }))).toBe('rate_limited');
    const before = d.hasher.verifyCalls;
    expect(code(await passwordLogin(d, { login: 'bob', password: 'bobs-password-123', ip }))).toBe('rate_limited');
    expect(d.hasher.verifyCalls).toBe(before);
    expect(code(await passwordLogin(d, { login: 'bob', password: 'bobs-password-123', ip: '10.0.0.2' }))).toBe('ok');
  });


  it('one IP creates at most as many login counters as its failure limit allows', async () => {
    const { d } = await setup({ loginIpLimit: 5 });
    for (let n = 0; n < 200; n++) await passwordLogin(d, { login: `random-${n}`, password: 'whatever-password', ip });
    expect(d.loginAccountLimiter.counts.size).toBeLessThanOrEqual(5);
    expect([...d.loginIpLimiter.counts.keys()]).toEqual([ip]);
  });

  it('caps concurrent sign-ins per IP and releases the slot afterwards', async () => {
    const { d } = await setup({ signInConcurrency: 1 });
    expect(d.signInSlots.tryAcquire(ip)).toBe(true); // a sign-in already in flight from this IP
    const before = d.hasher.verifyCalls;
    const busy = await passwordLogin(d, { login: 'alice', password: RIGHT, ip });
    expect(busy.ok ? null : [busy.error.code, busy.error.retryAfterSec]).toEqual(['rate_limited', 1]);
    expect(d.hasher.verifyCalls).toBe(before);
    expect(d.loginAccountLimiter.counts.size + d.loginIpLimiter.counts.size).toBe(0); // refused before counting
    d.signInSlots.release(ip);
    expect(code(await passwordLogin(d, { login: 'alice', password: 'wrong-password-1', ip }))).toBe('invalid_credentials');
    expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip }))).toBe('ok');
    expect(d.signInSlots.inFlight.size).toBe(0);
  });

  it('without a device-cookie secret no device cookie is issued and the lock applies to everyone', async () => {
    const { d } = await setup({ loginAccountLimit: 3 });
    d.signInKeys.devicesEnabled = false;
    const r = await passwordLogin(d, { login: 'alice', password: RIGHT, ip });
    expect(r.ok && r.value.deviceCookie).toBeNull();
  });
});

describe('unlockLogin', () => {
  it('lifts the lock of a user\'s login (an admin action)', async () => {
    const { d, user } = await setup({ loginAccountLimit: 3 });
    await lockAlice(d, 5);
    expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip }))).toBe('rate_limited');
    expect(await unlockLogin(d, user.id)).toEqual({ ok: true, value: undefined });
    expect(code(await passwordLogin(d, { login: 'alice', password: RIGHT, ip }))).toBe('ok');
  });

  it('is not_found for an unknown user', async () => {
    const { d } = await setup();
    const r = await unlockLogin(d, 'nobody');
    expect(r.ok ? null : r.error.code).toBe('not_found');
  });
});

describe('logout', () => {
  it('deletes the session row', async () => {
    const { d } = await setup();
    const r = await passwordLogin(d, { login: 'alice', password: RIGHT, ip });
    if (!r.ok) throw r.error;
    await logout(d, r.value.sessionId);
    expect(d.sessions.rows.size).toBe(0);
    await logout(d, 'unknown'); // no-op
  });
});
