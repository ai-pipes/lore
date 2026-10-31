/** Web session lifetime: 7 days, sliding. The expiry is pushed forward at most every 5 minutes. */
export const SESSION_TTL_MS = 7 * 24 * 3600_000;
export const SESSION_REFRESH_AFTER_MS = 5 * 60_000;

/** When a session created or refreshed at `now` expires. */
export function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

/** True once the session was last extended more than `SESSION_REFRESH_AFTER_MS` ago. */
export function sessionNeedsRefresh(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS;
}

/** How a web session was started. */
export type SignInMethod = 'password' | 'sso';

/** Single sign-on sessions live at most 24 hours in total unless configured otherwise. */
export const DEFAULT_SSO_SESSION_MAX_HOURS = 24;
/** The longest configurable absolute lifetime of a single sign-on session: 30 days. */
export const MAX_SSO_SESSION_MAX_HOURS = 720;

/**
 * The absolute deadline of a session started at `now`: a single sign-on session ends `maxHours`
 * after sign-in however active it is (so groups and role are re-read from the provider); a password
 * session has none (null) and only slides.
 */
export function sessionDeadline(method: SignInMethod, now: Date, maxHours: number): Date | null {
  return method === 'sso' ? new Date(now.getTime() + maxHours * 3600_000) : null;
}

/** True from the deadline on; a session without a deadline never passes it. */
export function isPastDeadline(deadline: Date | null, now: Date): boolean {
  return deadline !== null && now.getTime() >= deadline.getTime();
}

/** A known-device cookie (issued by a password sign-in) lives 90 days. */
export const KNOWN_DEVICE_TTL_MS = 90 * 24 * 60 * 60_000;

export function knownDeviceExpiry(now: Date): Date {
  return new Date(now.getTime() + KNOWN_DEVICE_TTL_MS);
}
