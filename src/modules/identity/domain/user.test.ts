import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared-kernel/index.js';
import { accessFor, checkPassword, IdentityError, isInteractiveAdmin, normalizeLogin, type GroupPolicy } from './user.js';

const P: GroupPolicy = { loginGroup: 'lore-users', adminGroup: 'lore-admins' };

describe('normalizeLogin', () => {
  it('trims and lower-cases', () => {
    expect(normalizeLogin('  Alice ')).toBe('alice');
    expect(normalizeLogin('bob.k_9-x')).toBe('bob.k_9-x');
  });
  it('rejects empty, inner spaces, bad first characters and over-long logins', () => {
    expect(normalizeLogin('a b')).toBeNull();
    expect(normalizeLogin('')).toBeNull();
    expect(normalizeLogin('   ')).toBeNull();
    expect(normalizeLogin('-alice')).toBeNull();
    expect(normalizeLogin('.alice')).toBeNull();
    expect(normalizeLogin('al/ice')).toBeNull();
    expect(normalizeLogin('a'.repeat(128))).toBe('a'.repeat(128));
    expect(normalizeLogin('a'.repeat(129))).toBeNull();
  });
});

describe('checkPassword', () => {
  it('requires 12..1024 characters', () => {
    expect(checkPassword('x'.repeat(11))?.code).toBe('weak_password');
    expect(checkPassword('x'.repeat(12))).toBeNull();
    expect(checkPassword('x'.repeat(1024))).toBeNull();
    expect(checkPassword('x'.repeat(1025))?.code).toBe('weak_password');
  });
});

describe('accessFor', () => {
  it('maps groups to a role, admin first', () => {
    expect(accessFor(['lore-admins'], P)).toBe('admin');
    expect(accessFor(['lore-users', 'lore-admins'], P)).toBe('admin');
    expect(accessFor(['lore-users'], P)).toBe('member');
    expect(accessFor([], P)).toBeNull();
    expect(accessFor(['other'], P)).toBeNull();
  });
});

describe('IdentityError', () => {
  it('is a DomainError with a code and an optional retry-after', () => {
    const e = new IdentityError('rate_limited', 'slow down', 30);
    expect(e).toBeInstanceOf(DomainError);
    expect(e.code).toBe('rate_limited');
    expect(e.retryAfterSec).toBe(30);
    expect(e.name).toBe('IdentityError');
    expect(new IdentityError('not_found', 'x').retryAfterSec).toBeUndefined();
  });
});

describe('isInteractiveAdmin', () => {
  const u = (role: 'admin' | 'member', via: 'session' | 'token') =>
    ({ kind: 'user', userId: 'u', login: 'u', displayName: 'U', role, via }) as const;
  it('is an admin in a web session or the admin key', () => {
    expect(isInteractiveAdmin({ kind: 'admin-key' })).toBe(true);
    expect(isInteractiveAdmin(u('admin', 'session'))).toBe(true);
    expect(isInteractiveAdmin(u('admin', 'token'))).toBe(false);
    expect(isInteractiveAdmin(u('member', 'session'))).toBe(false);
  });
});
