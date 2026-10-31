import { createHash, randomBytes } from 'crypto';
import type { Secrets } from '../application/ports.js';

/** Secrets from `crypto.randomBytes`: `prefix + base64url(32 bytes)` (43 characters after the prefix). */
export const nodeSecrets: Secrets = {
  random: (prefix) => prefix + randomBytes(32).toString('base64url'),
  sha256Hex: (s) => createHash('sha256').update(s).digest('hex'),
  sha256B64url: (s) => createHash('sha256').update(s).digest('base64url'),
};
