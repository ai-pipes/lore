import { describe, expect, it } from 'vitest';
import { deviceCookieSecret, HmacSignInKeys } from './sign-in-keys.js';

const now = new Date('2026-10-31T12:00:00Z');
const later = new Date(now.getTime() + 86_400_000);
const secret = deviceCookieSecret({ adminKey: 'admin-key-0123456789abcdef' });

describe('HmacSignInKeys', () => {
  it('login keys are stable per process, hide the login and differ between processes', () => {
    const a = new HmacSignInKeys(null);
    expect(a.loginKey('alice')).toBe(a.loginKey('alice'));
    expect(a.loginKey('alice')).not.toContain('alice');
    expect(a.loginKey('alice')).not.toBe(a.loginKey('bob'));
    expect(new HmacSignInKeys(null).loginKey('alice')).not.toBe(a.loginKey('alice'));
  });

  it('a device cookie verifies to its user and a random device id until it expires', () => {
    const k = new HmacSignInKeys(secret);
    const c = k.issueDevice('user-1', later)!;
    const v = k.verifyDevice(c, now);
    expect(v).toEqual({ userId: 'user-1', deviceId: expect.any(String) });
    expect(k.verifyDevice(k.issueDevice('user-1', later)!, now)!.deviceId).not.toBe(v!.deviceId);
    expect(k.verifyDevice(c, later)).toBeNull();
    // another server secret (another LORE_API_KEY) does not accept it
    expect(new HmacSignInKeys(deviceCookieSecret({ adminKey: 'another-key-0123456789abc' })).verifyDevice(c, now)).toBeNull();
  });

  it('rejects tampered, malformed and oversized values', () => {
    const k = new HmacSignInKeys(secret);
    const c = k.issueDevice('user-1', later)!;
    const [v, , d, exp, sig] = c.split('.');
    for (const bad of [
      [v, 'user-2', d, exp, sig].join('.'),
      [v, 'user-1', d, String(Number(exp) + 1000), sig].join('.'),
      `${c}x`,
      ['v2', 'user-1', d, exp, sig].join('.'),
      'garbage',
      `${c}.extra`,
      'x'.repeat(300),
    ]) {
      expect(k.verifyDevice(bad, now)).toBeNull();
    }
  });

  it('is off without a secret; an explicit secret wins over the admin key', () => {
    const off = new HmacSignInKeys(deviceCookieSecret({}));
    expect(off.issueDevice('user-1', later)).toBeNull();
    expect(off.verifyDevice('v1.a.b.1.c', now)).toBeNull();
    expect(deviceCookieSecret({ deviceCookieSecret: 's'.repeat(32), adminKey: 'k' })).not.toEqual(deviceCookieSecret({ adminKey: 'k' }));
  });
});
