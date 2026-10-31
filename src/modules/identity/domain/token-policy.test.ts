import { describe, expect, it } from 'vitest';
import { cliTokenExpiry, DEFAULT_CLI_TOKEN_TTL_DAYS, isTokenExpired, MAX_CLI_TOKEN_TTL_DAYS } from './token-policy.js';

const now = new Date('2026-10-31T12:00:00Z');

describe('token policy', () => {
  it('CLI sign-in tokens live 90 days by default, at most ten years', () => {
    expect(DEFAULT_CLI_TOKEN_TTL_DAYS).toBe(90);
    expect(MAX_CLI_TOKEN_TTL_DAYS).toBe(3650);
    expect(cliTokenExpiry(now, 90)).toEqual(new Date('2027-01-29T12:00:00Z'));
    expect(cliTokenExpiry(now, 1).getTime() - now.getTime()).toBe(86_400_000);
  });

  it('a token without an expiry never expires; one with an expiry expires at it', () => {
    expect(isTokenExpired(null, now)).toBe(false);
    expect(isTokenExpired(new Date(now.getTime() + 1), now)).toBe(false);
    expect(isTokenExpired(now, now)).toBe(true);
    expect(isTokenExpired(new Date(now.getTime() - 1), now)).toBe(true);
  });
});
