/**
 * Lifetimes of personal `sk_` tokens. Tokens created on the Tokens page never expire; the ones a
 * CLI device login mints (`cli-<hostname>`) expire after a configurable number of days.
 * Plain TypeScript, no dependencies.
 */

/** CLI sign-in tokens live 90 days unless configured otherwise. */
export const DEFAULT_CLI_TOKEN_TTL_DAYS = 90;
/** The longest configurable CLI token lifetime: ten years. */
export const MAX_CLI_TOKEN_TTL_DAYS = 3650;

const DAY_MS = 86_400_000;

export function cliTokenExpiry(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * DAY_MS);
}

/** A token without an expiry never expires; one with an expiry is expired from that instant on. */
export function isTokenExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() >= expiresAt.getTime();
}
