import { describe, expect, it } from 'vitest';
import {
  cliTokenName,
  DEVICE_LOGIN_TTL_MS,
  deviceLoginExpiry,
  formatUserCode,
  isDeviceLoginExpired,
  normalizeHostname,
  normalizeUserCode,
  POLL_INTERVAL_SEC,
  pollOutcome,
  USER_CODE_ALPHABET,
  userCodeFromRandom,
} from './device-login.js';

const now = new Date('2026-10-31T12:00:00Z');
const later = new Date(now.getTime() + 1000);
const earlier = new Date(now.getTime() - 1000);

describe('device login constants', () => {
  it('lives 10 minutes and polls every 5 s', () => {
    expect(DEVICE_LOGIN_TTL_MS).toBe(600_000);
    expect(POLL_INTERVAL_SEC).toBe(5);
    expect(deviceLoginExpiry(now).getTime() - now.getTime()).toBe(600_000);
  });

  it('the alphabet has 20 consonants and no vowels or Y', () => {
    expect(USER_CODE_ALPHABET).toHaveLength(20);
    expect(USER_CODE_ALPHABET).not.toMatch(/[AEIOUY]/);
  });
});

describe('user codes', () => {
  it('formats eight letters as XXXX-XXXX', () => {
    expect(formatUserCode('BCDFGHJK')).toBe('BCDF-GHJK');
  });

  it('maps base64url digits below 60 onto the alphabet and skips the rest', () => {
    // A=0 → B, B=1 → C, '-'=62 and '_'=63 are skipped, 4=56 → 56 % 20 = 16 → V
    expect(userCodeFromRandom('A-B_ABABA4')).toBe('BCBC-BCBV');
  });

  it('is null when the input holds too few usable digits', () => {
    expect(userCodeFromRandom('AB--__')).toBeNull();
    expect(userCodeFromRandom('ABC$DEFG')).toBeNull();
  });

  it('always yields codes of the alphabet', () => {
    const code = userCodeFromRandom('qwertyuiopasdfghjklzxcvbnm0123456789QWERTYU');
    expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  });

  it('normalizes what people type', () => {
    expect(normalizeUserCode(' bcdf-ghjk ')).toBe('BCDF-GHJK');
    expect(normalizeUserCode('BCDFGHJK')).toBe('BCDF-GHJK');
    expect(normalizeUserCode('BCDF-GHJA')).toBeNull();
    expect(normalizeUserCode('BCDF-GHJ')).toBeNull();
    expect(normalizeUserCode('')).toBeNull();
  });
});

describe('normalizeHostname', () => {
  it('accepts 1..64 characters of [A-Za-z0-9._-], trimmed', () => {
    expect(normalizeHostname('devbox')).toBe('devbox');
    expect(normalizeHostname(' My-Mac.local ')).toBe('My-Mac.local');
    expect(normalizeHostname('a'.repeat(64))).toBe('a'.repeat(64));
  });

  it('rejects empty, long or odd hostnames', () => {
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname('a'.repeat(65))).toBeNull();
    expect(normalizeHostname('evil host')).toBeNull();
    expect(normalizeHostname('<script>')).toBeNull();
  });

  it('names the token cli-<hostname>', () => {
    expect(cliTokenName('devbox')).toBe('cli-devbox');
  });
});

describe('pollOutcome', () => {
  it('pending, approved and denied before expiry', () => {
    expect(pollOutcome({ status: 'pending', expiresAt: later }, now)).toBe('pending');
    expect(pollOutcome({ status: 'approved', expiresAt: later }, now)).toBe('issue');
    expect(pollOutcome({ status: 'denied', expiresAt: later }, now)).toBe('denied');
  });

  it('a consumed request is expired, so a replay gets nothing', () => {
    expect(pollOutcome({ status: 'consumed', expiresAt: later }, now)).toBe('expired');
  });

  it('anything at or after expiry is expired, approved included', () => {
    for (const status of ['pending', 'approved', 'denied'] as const) {
      expect(pollOutcome({ status, expiresAt: earlier }, now)).toBe('expired');
      expect(pollOutcome({ status, expiresAt: now }, now)).toBe('expired');
    }
    expect(isDeviceLoginExpired(now, now)).toBe(true);
    expect(isDeviceLoginExpired(later, now)).toBe(false);
  });
});
