import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { SignInKeys } from '../application/ports.js';

const VERSION = 'v1';
const MAX_COOKIE_LENGTH = 256;

/**
 * The HMAC key of known-device cookies: `LORE_DEVICE_COOKIE_SECRET` when set, else derived from the
 * admin key `LORE_API_KEY` (rotating it signs everybody's devices out of the bypass), else null
 * (device cookies off: the login lock applies to every client). Never stored anywhere.
 */
export function deviceCookieSecret(cfg: { deviceCookieSecret?: string; adminKey?: string }): Buffer | null {
  if (cfg.deviceCookieSecret) return createHmac('sha256', cfg.deviceCookieSecret).update('lore known-device cookie').digest();
  if (cfg.adminKey) return createHmac('sha256', cfg.adminKey).update('lore known-device cookie').digest();
  return null;
}

/**
 * Login limiter keys are an HMAC under a per-process random key (the limiter lives in memory, so
 * the key need not survive a restart). A device cookie is
 * `v1.<user id>.<random device id>.<expiry, unix s>.<HMAC-SHA256 of the rest, base64url>`.
 */
export class HmacSignInKeys implements SignInKeys {
  private readonly loginSecret = randomBytes(32);

  constructor(private readonly deviceSecret: Buffer | null) {}

  loginKey(login: string): string {
    return createHmac('sha256', this.loginSecret).update(login).digest('base64url');
  }

  issueDevice(userId: string, expiresAt: Date): string | null {
    if (!this.deviceSecret) return null;
    const body = `${VERSION}.${userId}.${randomBytes(16).toString('base64url')}.${Math.floor(expiresAt.getTime() / 1000)}`;
    return `${body}.${this.sign(body)}`;
  }

  verifyDevice(raw: string, now: Date): { userId: string; deviceId: string } | null {
    if (!this.deviceSecret || raw.length > MAX_COOKIE_LENGTH) return null;
    const parts = raw.split('.');
    if (parts.length !== 5 || parts[0] !== VERSION) return null;
    const [, userId, deviceId, exp, sig] = parts;
    const expected = Buffer.from(this.sign(parts.slice(0, 4).join('.')));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    if (!/^\d+$/.test(exp) || Number(exp) * 1000 <= now.getTime()) return null;
    return { userId, deviceId };
  }

  private sign(body: string): string {
    return createHmac('sha256', this.deviceSecret!).update(body).digest('base64url');
  }
}
