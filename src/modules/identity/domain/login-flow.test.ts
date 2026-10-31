import { describe, expect, it } from 'vitest';
import {
  isLoginStateExpired,
  loginBase,
  loginCandidate,
  loginStateExpiry,
  MAX_LOGIN_LENGTH,
  normalizeReturnTo,
} from './login-flow.js';

describe('normalizeReturnTo', () => {
  it.each([
    ['/cli/login?code=AB', '/cli/login?code=AB'],
    ['/tokens?x=1#h', '/tokens?x=1#h'],
    ['https://evil.example/', '/'],
    ['//evil.example', '/'],
    ['/\\evil', '/'],
    ['javascript:alert(1)', '/'],
    ['', '/'],
    ['skills', '/'],
    ['/a\r\nb', '/'],
    ['/a\u007fb', '/'],
    [`/${'a'.repeat(511)}`, `/${'a'.repeat(511)}`],
    [`/${'a'.repeat(512)}`, '/'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeReturnTo(input)).toBe(expected);
  });
});

describe('login state lifetime', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  it('lives for 10 minutes', () => {
    const exp = loginStateExpiry(now);
    expect(exp.getTime() - now.getTime()).toBe(10 * 60_000);
    expect(isLoginStateExpired(exp, new Date(exp.getTime() - 1))).toBe(false);
    expect(isLoginStateExpired(exp, exp)).toBe(true);
  });
});

const claims = (preferredUsername: string | null, email: string | null, sub = 'sub-1', emailVerified = true) => ({
  sub,
  preferredUsername,
  email,
  emailVerified,
});

describe('loginBase', () => {
  it('uses sub when the email is unverified and there is no username', () => {
    expect(loginBase({ sub: 's1', preferredUsername: null, email: 'Bob@x.io', emailVerified: false })).toBe('s1');
  });
  it('prefers preferred_username, lower-cased', () => {
    expect(loginBase(claims('Anna.K', 'x@example.com'))).toBe('anna.k');
  });
  it('falls back to the local part of a verified email', () => {
    expect(loginBase(claims(null, 'Boris@Example.com'))).toBe('boris');
    expect(loginBase(claims('   ', 'boris@example.com'))).toBe('boris');
  });
  it('falls back to sub when neither is usable', () => {
    expect(loginBase(claims(null, '@example.com', 'ABC-123'))).toBe('abc-123');
    expect(loginBase(claims(null, 'no-at-sign', 'abc'))).toBe('abc');
  });
  it('reduces to [a-z0-9._-]', () => {
    expect(loginBase(claims(' Anna  Maria\t\n', null))).toBe('anna-maria');
    expect(loginBase(claims('a\u0000b\u007f', null))).toBe('a-b');
    expect(loginBase(claims("o'brien+ops@x", null))).toBe('o-brien-ops-x');
    expect(loginBase(claims('--.a--b.--', null))).toBe('a-b');
  });
  it('handles zero-width, compatibility forms and look-alikes', () => {
    expect(loginBase(claims('ad​min', null))).toBe('ad-min');
    expect(loginBase(claims('​admin⁠', null))).toBe('admin');
    expect(loginBase(claims('ＡＤＭＩＮ', null))).toBe('admin');
    expect(loginBase(claims('аdmin', null))).toBe('dmin');
    expect(loginBase(claims('ае', null, 'sub-7'))).toBe('sub-7');
  });
  it('keeps within the length limit, without a trailing separator', () => {
    expect(loginBase(claims('a'.repeat(300), null))).toHaveLength(MAX_LOGIN_LENGTH);
    expect(loginBase(claims(`${'a'.repeat(127)}-b`, null))).toBe('a'.repeat(127));
  });
  it('has a last resort when nothing is usable', () => {
    expect(loginBase(claims(null, null, ' '))).toBe('user');
  });
});

describe('loginCandidate', () => {
  it('is the base first, then base-2, base-3…', () => {
    expect(loginCandidate('bob', 1)).toBe('bob');
    expect(loginCandidate('bob', 2)).toBe('bob-2');
    expect(loginCandidate('bob', 13)).toBe('bob-13');
  });
  it('shortens the base so the suffix fits', () => {
    const c = loginCandidate('a'.repeat(MAX_LOGIN_LENGTH), 10);
    expect(c).toHaveLength(MAX_LOGIN_LENGTH);
    expect(c.endsWith('-10')).toBe(true);
  });
});
