import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'crypto';
import type { PasswordHasher } from '../application/ports.js';

/** scrypt N=2^15, r=8, p=1, 64-byte key, 16-byte salt; stored as `scrypt$N$r$p$<salt>$<hash>` (base64url). */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAXMEM = 64 * 1024 * 1024;

function derive(pw: string, salt: Buffer, opts: ScryptOptions, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pw, salt, keylen, opts, (e, key) => (e ? reject(e) : resolve(key)));
  });
}

export const scryptHasher: PasswordHasher = {
  async hash(pw) {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(pw, salt, { N, r: R, p: P, maxmem: MAXMEM }, KEYLEN);
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  },

  async verify(stored, pw) {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    // Only the parameters this server writes are accepted: a stored value cannot make it do more work.
    if (parts[1] !== String(N) || parts[2] !== String(R) || parts[3] !== String(P)) return false;
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length !== SALT_BYTES || expected.length !== KEYLEN) return false;
    try {
      const key = await derive(pw, salt, { N, r: R, p: P, maxmem: MAXMEM }, KEYLEN);
      return timingSafeEqual(key, expected);
    } catch {
      return false;
    }
  },
};
