import { systemClock } from '../../../shared-kernel/index.js';
import type { IdentityDeps } from '../application/ports.js';
import { DEFAULT_SSO_SESSION_MAX_HOURS } from '../domain/session-policy.js';
import { DEFAULT_CLI_TOKEN_TTL_DAYS } from '../domain/token-policy.js';
import { OpenidProvider } from './openid-provider.js';
import { pgPendingLoginRepository } from './pg-pending-logins.js';
import { pgDeviceLoginRepository } from './pg-device-logins.js';
import { pgSessionRepository } from './pg-sessions.js';
import { pgTokenRepository } from './pg-tokens.js';
import { pgUserRepository } from './pg-users.js';
import { ClientInFlightLimiter, ClientRateLimiter } from './client-limiters.js';
import { InFlightLimiter, InMemoryRateLimiter } from './rate-limiter.js';
import { scryptHasher } from './scrypt-hasher.js';
import { deviceCookieSecret, HmacSignInKeys } from './sign-in-keys.js';
import { nodeSecrets } from './secrets.js';
import type { SsoConfig } from './sso-config.js';

/** Configuration of the identity module. */
export interface IdentityConfig {
  adminKey?: string;
  /** `LORE_DEVICE_COOKIE_SECRET`: signs known-device cookies; derived from `adminKey` when absent. */
  deviceCookieSecret?: string;
  /** Single sign-on; null or absent = password mode. */
  sso?: SsoConfig | null;
  /** Lifetime in days of CLI sign-in tokens; `DEFAULT_CLI_TOKEN_TTL_DAYS` when absent. */
  cliTokenTtlDays?: number;
  /** Absolute lifetime in hours of single sign-on web sessions; `DEFAULT_SSO_SESSION_MAX_HOURS` when absent. */
  ssoSessionMaxHours?: number;
  /** Where degraded-provider warnings go (never tokens or claims). */
  logger?: { warn(fields: object, msg: string): void };
}

/**
 * The identity ports bound to Postgres, scrypt and node:crypto. The database is resolved lazily
 * (getDb). Rate limiters live in memory, so build this once per server.
 */
export function createPgIdentity(cfg: IdentityConfig): IdentityDeps {
  const warn = (m: string) => cfg.logger?.warn({}, m);
  const limiter = (limit: number, windowSec: number, lockSec: number) =>
    new InMemoryRateLimiter(limit, windowSec, lockSec, Date.now, undefined, undefined, warn);
  return {
    users: pgUserRepository,
    sessions: pgSessionRepository,
    tokens: pgTokenRepository,
    hasher: scryptHasher,
    secrets: nodeSecrets,
    clock: systemClock,
    // 10 failed password sign-ins per login in 900 s lock it for 900 s (except for known devices)
    loginAccountLimiter: limiter(10, 900, 900),
    // 50 failures per IP across all logins in 900 s lock the IP for 900 s (password spraying);
    // an IPv6 /64 is locked at 200, so rotating addresses inside it does not help
    loginIpLimiter: new ClientRateLimiter(limiter(50, 900, 900), limiter(200, 900, 900)),
    // 10 failures per known device in 900 s lock that device for 900 s
    loginDeviceLimiter: limiter(10, 900, 900),
    signInKeys: new HmacSignInKeys(deviceCookieSecret(cfg)),
    // at most 4 password sign-ins (scrypt runs) in flight per IP, 16 per IPv6 /64
    signInSlots: new ClientInFlightLimiter(new InFlightLimiter(4), new InFlightLimiter(16)),
    adminKey: cfg.adminKey,
    sso: cfg.sso
      ? {
          issuer: cfg.sso.issuer,
          policy: cfg.sso.policy,
          provider: new OpenidProvider({
            issuer: cfg.sso.issuer,
            clientId: cfg.sso.clientId,
            clientSecret: cfg.sso.clientSecret,
            redirectUri: cfg.sso.redirectUri,
            scopes: cfg.sso.scopes,
            groupsClaim: cfg.sso.groupsClaim,
            allowInsecure: cfg.sso.allowInsecure,
            ...(cfg.logger ? { logger: cfg.logger } : {}),
          }),
        }
      : null,
    pendingLogins: pgPendingLoginRepository,
    // 30 single sign-on starts per IP in 600 s, 120 per IPv6 /64
    ssoStartLimiter: new ClientRateLimiter(new InMemoryRateLimiter(30, 600, 600), new InMemoryRateLimiter(120, 600, 600)),
    deviceLogins: pgDeviceLoginRepository,
    // 30 device-login starts per IP in 600 s, then 429 for 600 s; 120 per IPv6 /64
    deviceStartLimiter: new ClientRateLimiter(new InMemoryRateLimiter(30, 600, 600), new InMemoryRateLimiter(120, 600, 600)),
    cliTokenTtlDays: cfg.cliTokenTtlDays ?? DEFAULT_CLI_TOKEN_TTL_DAYS,
    ssoSessionMaxHours: cfg.ssoSessionMaxHours ?? DEFAULT_SSO_SESSION_MAX_HOURS,
  };
}
