import { describe, expect, it } from 'vitest';
import { fakeIdentity, type FakeIdentity } from '../../../../test/fakes/identity.js';
import type { StartDeviceLoginResponse } from '../../../contracts/cli-login.js';
import { DEVICE_LOGIN_TTL_MS } from '../domain/device-login.js';
import { decideDeviceLogin, describeDeviceLogin, pollDeviceLogin, startDeviceLogin } from './device-login.js';

const BASE = 'https://lore.example';

async function setup(o: { deviceStartLimit?: number } = {}) {
  const d = fakeIdentity(o);
  const user = (await d.users.insert({ login: 'alice', displayName: 'Alice', role: 'admin' }))!;
  return { d, user };
}

async function start(d: FakeIdentity, hostname = 'devbox', ip = '10.0.0.1'): Promise<StartDeviceLoginResponse> {
  const r = await startDeviceLogin(d, { hostname, ip, baseUrl: BASE });
  if (!r.ok) throw r.error;
  return r.value;
}

describe('startDeviceLogin', () => {
  it('returns a user code, a verification url, the interval and the lifetime', async () => {
    const { d } = await setup();
    const s = await start(d);
    expect(s.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    // No code in the link: the person types the code shown in their terminal (no prefilled phishing links).
    expect(s.verification_url).toBe(`${BASE}/cli/login`);
    expect(s).toMatchObject({ interval: 5, expires_in: 600 });
    expect(d.deviceLogins.rows).toHaveLength(1);
    const row = d.deviceLogins.rows[0];
    expect(row).toMatchObject({ hostname: 'devbox', status: 'pending', userId: null, userCode: s.user_code, requestIp: '10.0.0.1' });
    expect(row.deviceCodeHash).toBe(d.secrets.sha256Hex(s.device_code));
    expect(row.expiresAt.getTime() - d.clock.now().getTime()).toBe(DEVICE_LOGIN_TTL_MS);
  });

  it('gives every request its own codes', async () => {
    const { d } = await setup();
    const a = await start(d);
    const b = await start(d);
    expect(a.user_code).not.toBe(b.user_code);
    expect(a.device_code).not.toBe(b.device_code);
  });

  it('retries when a user code is taken', async () => {
    const { d } = await setup();
    let calls = 0;
    const insert = d.deviceLogins.insert.bind(d.deviceLogins);
    d.deviceLogins.insert = async (r) => (++calls === 1 ? false : insert(r));
    await start(d);
    expect(calls).toBe(2);
  });

  it('fails after repeated user-code collisions', async () => {
    const { d } = await setup();
    d.deviceLogins.insert = async () => false;
    await expect(startDeviceLogin(d, { hostname: 'devbox', ip: '1', baseUrl: BASE })).rejects.toThrow(/user code/);
  });

  it('rejects an invalid hostname', async () => {
    const { d } = await setup();
    const r = await startDeviceLogin(d, { hostname: 'bad host', ip: '1', baseUrl: BASE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_input');
    expect(d.deviceLogins.rows).toHaveLength(0);
  });

  it('is rate limited per IP', async () => {
    // The fake limiter reports the hit that reaches the limit as refused: 3 → two starts pass.
    const { d } = await setup({ deviceStartLimit: 3 });
    await start(d, 'devbox', 'ip-a');
    await start(d, 'devbox', 'ip-a');
    const r = await startDeviceLogin(d, { hostname: 'devbox', ip: 'ip-a', baseUrl: BASE });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('rate_limited');
      expect(r.error.retryAfterSec).toBeGreaterThan(0);
    }
    expect((await startDeviceLogin(d, { hostname: 'devbox', ip: 'ip-b', baseUrl: BASE })).ok).toBe(true);
  });


  it('cleans up expired requests', async () => {
    const { d } = await setup();
    await start(d);
    d.clock.advance(DEVICE_LOGIN_TTL_MS + 1);
    await start(d);
    expect(d.deviceLogins.rows).toHaveLength(1);
  });
});

describe('describeDeviceLogin', () => {
  it('shows hostname, code and status, accepting the code in any case', async () => {
    const { d } = await setup();
    const s = await start(d);
    const r = await describeDeviceLogin(d, s.user_code.toLowerCase());
    expect(r).toEqual({ ok: true, value: { hostname: 'devbox', user_code: s.user_code, status: 'pending', requested_ip: '10.0.0.1' } });
  });

  it('unknown or malformed codes are not_found, old ones expired', async () => {
    const { d } = await setup();
    const s = await start(d);
    for (const code of ['BBBB-BBBB', 'nope']) {
      const r = await describeDeviceLogin(d, code);
      expect(!r.ok && r.error.code).toBe('not_found');
    }
    d.clock.advance(DEVICE_LOGIN_TTL_MS);
    const r = await describeDeviceLogin(d, s.user_code);
    expect(!r.ok && r.error.code).toBe('expired');
  });
});

describe('decideDeviceLogin and pollDeviceLogin', () => {
  it('approve → one poll gets the token, every later poll is expired', async () => {
    const { d, user } = await setup();
    const s = await start(d);
    expect(await pollDeviceLogin(d, s.device_code)).toEqual({ status: 'pending' });
    expect(await decideDeviceLogin(d, user.id, s.user_code, true)).toEqual({ ok: true, value: undefined });
    const p = await pollDeviceLogin(d, s.device_code);
    expect(p).toMatchObject({ status: 'approved', login: 'alice', role: 'admin' });
    if (p.status !== 'approved') throw new Error('not approved');
    expect(p.token).toMatch(/^sk_/);
    // Review Focus 4: a replayed poll gets nothing and no second token exists.
    expect(await pollDeviceLogin(d, s.device_code)).toEqual({ status: 'expired' });
    const tokens = await d.tokens.listByUser(user.id);
    expect(tokens.filter((t) => t.name === 'cli-devbox')).toHaveLength(1);
    expect(d.tokens.rows[0].hash).toBe(d.secrets.sha256Hex(p.token));
    expect(d.tokens.rows[0].prefix).toBe(p.token.slice(0, 8));
    expect(d.deviceLogins.rows[0].status).toBe('consumed');
    // CLI sign-in tokens expire (90 days unless configured)
    expect(d.tokens.rows[0].expiresAt).toEqual(new Date(d.clock.now().getTime() + 90 * 86_400_000));
  });

  it('the CLI token lifetime is configurable', async () => {
    const { d, user } = await setup();
    d.cliTokenTtlDays = 7;
    const s = await start(d);
    await decideDeviceLogin(d, user.id, s.user_code, true);
    await pollDeviceLogin(d, s.device_code);
    expect(d.tokens.rows[0].expiresAt).toEqual(new Date(d.clock.now().getTime() + 7 * 86_400_000));
  });

  it('approving twice is rejected', async () => {
    const { d, user } = await setup();
    const s = await start(d);
    expect((await decideDeviceLogin(d, user.id, s.user_code, true)).ok).toBe(true);
    const again = await decideDeviceLogin(d, user.id, s.user_code, true);
    expect(!again.ok && again.error.code).toBe('already_decided');
    const deny = await decideDeviceLogin(d, user.id, s.user_code, false);
    expect(!deny.ok && deny.error.code).toBe('already_decided');
  });

  it('approving after 10 minutes is rejected and issues nothing', async () => {
    const { d, user } = await setup();
    const s = await start(d);
    d.clock.advance(DEVICE_LOGIN_TTL_MS);
    const r = await decideDeviceLogin(d, user.id, s.user_code, true);
    expect(!r.ok && r.error.code).toBe('expired');
    expect(await pollDeviceLogin(d, s.device_code)).toEqual({ status: 'expired' });
    expect(d.tokens.rows).toHaveLength(0);
  });

  it('an approval the poll reaches only after expiry issues nothing', async () => {
    const { d, user } = await setup();
    const s = await start(d);
    await decideDeviceLogin(d, user.id, s.user_code, true);
    d.clock.advance(DEVICE_LOGIN_TTL_MS);
    expect(await pollDeviceLogin(d, s.device_code)).toEqual({ status: 'expired' });
    expect(d.tokens.rows).toHaveLength(0);
  });

  it('a decision that loses a race is already_decided', async () => {
    const { d, user } = await setup();
    const s = await start(d);
    d.deviceLogins.decide = async () => false;
    const r = await decideDeviceLogin(d, user.id, s.user_code, true);
    expect(!r.ok && r.error.code).toBe('already_decided');
  });

  it('a poll that loses the consume race gets expired and no token', async () => {
    const { d, user } = await setup();
    const s = await start(d);
    await decideDeviceLogin(d, user.id, s.user_code, true);
    d.deviceLogins.consumeAndIssueToken = async () => null;
    expect(await pollDeviceLogin(d, s.device_code)).toEqual({ status: 'expired' });
    expect(d.tokens.rows).toHaveLength(0);
  });

  it('deny → poll says denied, and no token', async () => {
    const { d, user } = await setup();
    const s = await start(d);
    expect((await decideDeviceLogin(d, user.id, s.user_code, false)).ok).toBe(true);
    expect(await pollDeviceLogin(d, s.device_code)).toEqual({ status: 'denied' });
    expect(d.tokens.rows).toHaveLength(0);
  });

  it('the minted token follows the personal-token rules (8-character prefix, trimmed name)', async () => {
    const { d, user } = await setup();
    const s = await startDeviceLogin(d, { hostname: 'build-box', ip: '1.1.1.1', baseUrl: 'https://lore.example.com' });
    if (!s.ok) throw s.error;
    await decideDeviceLogin(d, user.id, s.value.user_code, true);
    const r = await pollDeviceLogin(d, s.value.device_code);
    if (r.status !== 'approved') throw new Error(r.status);
    expect(d.tokens.rows[0]).toMatchObject({ name: 'cli-build-box', prefix: r.token.slice(0, 8), hash: d.secrets.sha256Hex(r.token) });
  });

  it('an unknown or malformed code cannot be decided', async () => {
    const { d, user } = await setup();
    for (const code of ['BBBB-BBBB', 'x']) {
      const r = await decideDeviceLogin(d, user.id, code, true);
      expect(!r.ok && r.error.code).toBe('not_found');
    }
  });

  it('an unknown device code polls as expired', async () => {
    const { d } = await setup();
    expect(await pollDeviceLogin(d, 'no-such-code')).toEqual({ status: 'expired' });
  });

  it('a user disabled after approving gets no token', async () => {
    const { d, user } = await setup();
    const s = await start(d);
    await decideDeviceLogin(d, user.id, s.user_code, true);
    await d.users.update(user.id, { disabled: true });
    expect(await pollDeviceLogin(d, s.device_code)).toEqual({ status: 'denied' });
    expect(d.tokens.rows).toHaveLength(0);
    // The request is denied for good: enabling the user again does not revive it
    expect(d.deviceLogins.rows[0].status).toBe('denied');
    await d.users.update(user.id, { disabled: false });
    expect(await pollDeviceLogin(d, s.device_code)).toEqual({ status: 'denied' });
    expect(d.tokens.rows).toHaveLength(0);
  });

});
