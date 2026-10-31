import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SSO_SESSION_MAX_HOURS,
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
  isPastDeadline,
  sessionDeadline,
  sessionExpiry,
  sessionNeedsRefresh,
} from './session-policy.js';

describe('session policy', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  it('lasts 7 days and refreshes after 5 minutes', () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 3600_000);
    expect(SESSION_REFRESH_AFTER_MS).toBe(5 * 60_000);
    expect(sessionExpiry(new Date(now)).getTime()).toBe(now + SESSION_TTL_MS);
  });
  it('needs a refresh only once the session is older than 5 minutes', () => {
    expect(sessionNeedsRefresh(new Date(now + SESSION_TTL_MS), new Date(now))).toBe(false);
    expect(sessionNeedsRefresh(new Date(now + SESSION_TTL_MS - 4 * 60_000), new Date(now))).toBe(false);
    expect(sessionNeedsRefresh(new Date(now + SESSION_TTL_MS - 6 * 60_000), new Date(now))).toBe(true);
  });

  it('an sso session has an absolute deadline, a password session none', () => {
    expect(DEFAULT_SSO_SESSION_MAX_HOURS).toBe(24);
    expect(sessionDeadline('sso', new Date(now), 24)?.getTime()).toBe(now + 24 * 3600_000);
    expect(sessionDeadline('sso', new Date(now), 8)?.getTime()).toBe(now + 8 * 3600_000);
    expect(sessionDeadline('password', new Date(now), 24)).toBeNull();
  });
  it('is past the deadline from that instant on, never without one', () => {
    const deadline = new Date(now + 1000);
    expect(isPastDeadline(deadline, new Date(now + 999))).toBe(false);
    expect(isPastDeadline(deadline, new Date(now + 1000))).toBe(true);
    expect(isPastDeadline(null, new Date(now + 10 * SESSION_TTL_MS))).toBe(false);
  });
});
