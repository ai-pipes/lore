/**
 * CLI device login: the CLI starts a request, a signed-in person approves it in the browser by its
 * short user code, and the CLI's next poll receives a personal token exactly once.
 * Plain TypeScript, no dependencies.
 */

/** A device login request lives for 10 minutes. */
export const DEVICE_LOGIN_TTL_MS = 10 * 60_000;
/** The CLI polls every 5 seconds. */
export const POLL_INTERVAL_SEC = 5;
/** User code letters: consonants only, so no words, and no look-alikes (no vowels, no Y). */
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

const USER_CODE_LENGTH = 8;
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// 60 = 3 * 20: base64url digits below 60 map to the alphabet without bias; the rest are skipped.
const UNBIASED_LIMIT = 60;

export type DeviceStatus = 'pending' | 'approved' | 'denied' | 'consumed';

/** Eight alphabet letters as shown to people: `BCDF-GHJK`. */
export function formatUserCode(raw8: string): string {
  return `${raw8.slice(0, 4)}-${raw8.slice(4, 8)}`;
}

/**
 * A formatted user code from base64url random characters (rejection sampling, unbiased), or null
 * when they do not hold enough usable digits.
 */
export function userCodeFromRandom(b64url: string): string | null {
  let raw = '';
  for (const ch of b64url) {
    const v = B64URL.indexOf(ch);
    if (v < 0 || v >= UNBIASED_LIMIT) continue;
    raw += USER_CODE_ALPHABET[v % USER_CODE_ALPHABET.length];
    if (raw.length === USER_CODE_LENGTH) return formatUserCode(raw);
  }
  return null;
}

const USER_CODE_RE = new RegExp(`^[${USER_CODE_ALPHABET}]{8}$`);

/** A user code as typed (any case, with or without the dash, surrounding spaces) → `BCDF-GHJK`, else null. */
export function normalizeUserCode(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace('-', '');
  return USER_CODE_RE.test(s) ? formatUserCode(s) : null;
}

const HOSTNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** The CLI's hostname, trimmed: 1..64 characters of `[A-Za-z0-9._-]`, else null. */
export function normalizeHostname(raw: string): string | null {
  const h = raw.trim();
  return HOSTNAME_RE.test(h) ? h : null;
}

/** The name of the token a device login issues. */
export function cliTokenName(hostname: string): string {
  return `cli-${hostname}`;
}

export function deviceLoginExpiry(now: Date): Date {
  return new Date(now.getTime() + DEVICE_LOGIN_TTL_MS);
}

export function isDeviceLoginExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/**
 * What a poll gets. A consumed request answers `expired`, so a replayed poll never learns more and
 * never receives a second token; `issue` means the token is to be minted now.
 */
export function pollOutcome(
  s: { status: DeviceStatus; expiresAt: Date },
  now: Date,
): 'pending' | 'issue' | 'denied' | 'expired' {
  if (s.status === 'consumed' || isDeviceLoginExpired(s.expiresAt, now)) return 'expired';
  if (s.status === 'denied') return 'denied';
  if (s.status === 'approved') return 'issue';
  return 'pending';
}
