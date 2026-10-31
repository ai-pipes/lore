import { describe, expect, it } from 'vitest';
import { scryptHasher } from './scrypt-hasher.js';
import { nodeSecrets } from './secrets.js';

describe('scryptHasher', () => {
  it('hashes in the scrypt$32768$8$1$ format and verifies the right password', async () => {
    const stored = await scryptHasher.hash('correct horse battery');
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    expect(await scryptHasher.verify(stored, 'correct horse battery')).toBe(true);
    expect(await scryptHasher.verify(stored, 'wrong horse battery')).toBe(false);
  });
  it('salts every hash', async () => {
    expect(await scryptHasher.hash('correct horse battery')).not.toBe(await scryptHasher.hash('correct horse battery'));
  });
  it('returns false for malformed stored values without throwing', async () => {
    for (const bad of ['', 'nope', 'scrypt$32768$8$1$', 'scrypt$1$8$1$abc$def', 'argon2$x$y', 'scrypt$32768$8$1$c2FsdA$c2hvcnQ', 'scrypt$999999999$8$1$c2FsdA$c2hvcnQ']) {
      await expect(scryptHasher.verify(bad, 'whatever-password')).resolves.toBe(false);
    }
  });
});

describe('nodeSecrets', () => {
  it('makes prefixed base64url secrets of 32 random bytes', () => {
    expect(nodeSecrets.random('sk_')).toMatch(/^sk_[A-Za-z0-9_-]{43}$/);
    expect(nodeSecrets.random('lpk_')).toMatch(/^lpk_[A-Za-z0-9_-]{43}$/);
    expect(nodeSecrets.random('')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nodeSecrets.random('sk_')).not.toBe(nodeSecrets.random('sk_'));
  });
  it('hashes with SHA-256', () => {
    expect(nodeSecrets.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(nodeSecrets.sha256B64url('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
});
