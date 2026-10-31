/**
 * The web session cookie `lore_session`: HttpOnly, SameSite=Lax (Strict would drop the session on
 * the single sign-on callback), Path=/, Secure when configured or over https. It holds the random
 * session id; the server stores only its SHA-256.
 */
import { KNOWN_DEVICE_TTL_MS, SESSION_TTL_MS } from '../../domain/session-policy.js';

export const SESSION_COOKIE = 'lore_session';
/** Session ids are 43 base64url characters; anything much longer is not looked up. */
const MAX_SESSION_ID_LENGTH = 64;

const flags = (secure: boolean) => `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

/**
 * `Set-Cookie` value for a session created or extended just now: sessions always run
 * `SESSION_TTL_MS` from their last extension, and so does the cookie.
 */
export function sessionCookie(sessionId: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${sessionId}; Max-Age=${SESSION_TTL_MS / 1000}; ${flags(secure)}`;
}

/** `Set-Cookie` value that removes the session cookie. */
export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Max-Age=0; ${flags(secure)}`;
}

/** Name → value of a `Cookie` header; malformed values are skipped. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return out;
}

/** The session id from a `Cookie` header, or null when absent, empty or implausibly long. */
export function sessionIdFromCookies(header: string | undefined): string | null {
  const id = parseCookies(header)[SESSION_COOKIE];
  return id && id.length <= MAX_SESSION_ID_LENGTH ? id : null;
}

/**
 * The single sign-on binding cookie `lore_sso`: holds the `state` of the attempt this browser
 * started, so a callback from another browser (login CSRF) is refused. SameSite=Lax (the callback
 * is a top-level cross-site navigation), Path=/api/auth/sso, 10 minutes like the attempt itself.
 */
export const SSO_BINDING_COOKIE = 'lore_sso';
const ssoFlags = (secure: boolean) => `Path=/api/auth/sso; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export function ssoBindingCookie(state: string, secure: boolean): string {
  return `${SSO_BINDING_COOKIE}=${state}; Max-Age=600; ${ssoFlags(secure)}`;
}

export function clearedSsoBindingCookie(secure: boolean): string {
  return `${SSO_BINDING_COOKIE}=; Max-Age=0; ${ssoFlags(secure)}`;
}

/** The state bound to this browser, or null. */
export function ssoBindingFromCookies(header: string | undefined): string | null {
  const v = parseCookies(header)[SSO_BINDING_COOKIE];
  return v && v.length <= MAX_SESSION_ID_LENGTH ? v : null;
}

/**
 * The known-device cookie `lore_device`: a signed value a successful password sign-in issues
 * (user id, random device id, expiry). It lets this browser sign in while its login is locked by
 * failures elsewhere. HttpOnly, SameSite=Lax, sent only to `/api/auth/login`, 90 days.
 */
export const DEVICE_COOKIE = 'lore_device';
const MAX_DEVICE_COOKIE_LENGTH = 256;
const deviceFlags = (secure: boolean) => `Path=/api/auth/login; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export function deviceCookie(value: string, secure: boolean): string {
  return `${DEVICE_COOKIE}=${value}; Max-Age=${KNOWN_DEVICE_TTL_MS / 1000}; ${deviceFlags(secure)}`;
}

/** The device cookie value from a `Cookie` header, or null. */
export function deviceFromCookies(header: string | undefined): string | null {
  const v = parseCookies(header)[DEVICE_COOKIE];
  return v && v.length <= MAX_DEVICE_COOKIE_LENGTH ? v : null;
}
