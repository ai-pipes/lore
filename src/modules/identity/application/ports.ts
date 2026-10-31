/** The ports the identity module's use cases need. Implemented by `infrastructure/pg-*` and `test/fakes/identity.ts`. */
import type { Clock } from '../../../shared-kernel/index.js';
import type { SignInMethod } from '../domain/session-policy.js';
import type { DeviceStatus } from '../domain/device-login.js';
import type { GroupPolicy, OidcClaims, Role, User } from '../domain/user.js';

/** Random secrets and SHA-256 digests. A secret is `prefix + base64url(32 random bytes)`. */
export interface Secrets {
  random(prefix: '' | 'sk_' | 'lpk_'): string;
  sha256Hex(s: string): string;
  sha256B64url(s: string): string;
}

export interface PasswordHasher {
  hash(pw: string): Promise<string>;
  /** False for a wrong password and for a malformed stored value; never throws. */
  verify(stored: string, pw: string): Promise<boolean>;
}

export interface NewUser {
  login: string;
  displayName: string;
  role: Role;
  passwordHash?: string | null;
  oidcIss?: string | null;
  oidcSub?: string | null;
  email?: string | null;
  groups?: string[];
}

export type UserPatch = Partial<{
  login: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  passwordHash: string | null;
  oidcIss: string | null;
  oidcSub: string | null;
  email: string | null;
  groups: string[];
  lastLoginAt: Date | null;
}>;

export interface UserRepository {
  /** Null when the login or the OIDC subject is taken. */
  insert(u: NewUser): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findByLogin(login: string): Promise<User | null>;
  findBySubject(iss: string, sub: string): Promise<User | null>;
  /** All users, by login. */
  list(): Promise<User[]>;
  count(): Promise<number>;
  /** Inserts only when there are no users at all (first admin); null otherwise. */
  insertIfEmpty(u: NewUser): Promise<User | null>;
  /** Null for an unknown id. */
  update(id: string, patch: UserPatch): Promise<User | null>;
}

/** Web sessions, keyed by the SHA-256 hex of the session id. */
export interface SessionRepository {
  /** `deadline` is the absolute end of a single sign-on session (null: sliding only). */
  insert(r: { idHash: string; userId: string; expiresAt: Date; method: SignInMethod; deadline: Date | null }): Promise<void>;
  find(idHash: string): Promise<{ userId: string; expiresAt: Date; deadline: Date | null } | null>;
  /** Slides the expiry to `expiresAt` and records `seenAt` (the clock's now) as the last use. */
  extend(idHash: string, expiresAt: Date, seenAt: Date): Promise<void>;
  delete(idHash: string): Promise<void>;
  deleteByUser(userId: string): Promise<void>;
}

export interface ApiTokenRecord {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  /** Null: never expires (Tokens page); set for CLI sign-in tokens. */
  expiresAt: Date | null;
}

/** Personal `sk_` tokens, keyed by the SHA-256 hex of the token. */
export interface TokenRepository {
  insert(t: { userId: string; name: string; prefix: string; hash: string; expiresAt?: Date | null }): Promise<ApiTokenRecord>;
  findByHash(hash: string): Promise<ApiTokenRecord | null>;
  listByUser(userId: string): Promise<ApiTokenRecord[]>;
  /** False when the token is unknown, belongs to someone else or is already revoked. */
  revoke(userId: string, id: string, at: Date): Promise<boolean>;
  /** Revokes every unrevoked token of the user (a password reset). */
  revokeAllByUser(userId: string, at: Date): Promise<void>;
  touch(id: string, at: Date): Promise<void>;
}

export interface DeviceLoginRecord {
  id: string;
  userCode: string;
  /** As reported by the CLI: not verified by anyone. */
  hostname: string;
  /** The client address that started the request, shown on the approval page. */
  requestIp: string;
  status: DeviceStatus;
  /** The person who approved or denied; null while pending. */
  userId: string | null;
  expiresAt: Date;
}

/** CLI device logins, keyed by the SHA-256 hex of the device code. Rows hold no token. */
export interface DeviceLoginRepository {
  /** False when the user code is taken (the caller retries with another one). */
  insert(r: { deviceCodeHash: string; userCode: string; hostname: string; requestIp: string; expiresAt: Date }): Promise<boolean>;
  findByUserCode(userCode: string): Promise<DeviceLoginRecord | null>;
  findByDeviceCodeHash(hash: string): Promise<DeviceLoginRecord | null>;
  /** Moves a pending, unexpired request to `approved`/`denied` by `userId`; false otherwise. */
  decide(userCode: string, userId: string, status: 'approved' | 'denied', now: Date): Promise<boolean>;
  /**
   * Atomically moves an approved, unexpired request to `consumed` and inserts the approver's token
   * (one transaction). Null, and no token, when the request is not approved and unexpired any more.
   */
  consumeAndIssueToken(
    id: string,
    token: { name: string; prefix: string; hash: string; expiresAt: Date },
    now: Date,
  ): Promise<{ userId: string } | null>;
  /** Moves an approved request to `denied` (its approver was disabled or deleted). */
  deny(id: string): Promise<void>;
  /**
   * Moves every approved, not yet consumed request of `userId` to `denied`: called wherever the
   * user's sessions are ended by force, so an approval given before cannot mint a token after.
   */
  denyApprovedByUser(userId: string): Promise<void>;
  /** Deletes requests that expired before `now`. */
  deleteExpired(now: Date): Promise<void>;
}

/** Fixed-window attempt counter per key (an IP, a login, a login at an IP). */
export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSec: number };
  /** Counts one attempt; not allowed when the key is (now) locked. */
  hit(key: string): { allowed: boolean; retryAfterSec: number };
  /** Attempts counted in the current window; more than the limit while the key is locked. */
  count(key: string): number;
  /** Gives one counted attempt back (an attempt that turned out fine); never lifts a lock. */
  refund(key: string): void;
  reset(key: string): void;
}

/**
 * Keys for the sign-in limits. `loginKey` is an HMAC of the normalized login, so the limiter holds
 * no logins and treats existing and unknown logins alike. A known-device cookie is a signed value
 * binding a user id, a random device id and an expiry ("device cookies", OWASP).
 */
export interface SignInKeys {
  loginKey(login: string): string;
  /** A device cookie value for `userId` valid until `expiresAt`; null when device cookies are off (no secret). */
  issueDevice(userId: string, expiresAt: Date): string | null;
  /** The user and device of a genuine, unexpired device cookie value; null otherwise. */
  verifyDevice(raw: string, now: Date): { userId: string; deviceId: string } | null;
}

/** Caps the work in flight per key (an IP): `tryAcquire` is false while `max` holders run. */
export interface ConcurrencyLimiter {
  tryAcquire(key: string): boolean;
  /** Frees one slot of `key` (no-op when it holds none). */
  release(key: string): void;
}

/** The OIDC provider: Authorization Code + PKCE. Unreachable → throws `IdentityError('idp_unavailable')`. */
export interface OidcProvider {
  authorizationUrl(i: { state: string; codeChallenge: string; nonce: string }): Promise<URL>;
  /** Redeems the code (PKCE verifier, nonce and `iss` checked); throws when the provider refuses. */
  exchange(i: { code: string; codeVerifier: string; nonce: string; iss?: string }): Promise<OidcClaims>;
}

/** A started single sign-on attempt, keyed by its `state`. */
export interface PendingLogin {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  expiresAt: Date;
}

export interface PendingLoginRepository {
  insert(p: PendingLogin): Promise<void>;
  /** Removes and returns the attempt: a state can be used exactly once. Null when unknown. */
  consume(state: string): Promise<PendingLogin | null>;
}

/** Single sign-on as the use cases see it; null in `IdentityDeps` = password mode. */
export interface SsoDeps {
  issuer: string;
  provider: OidcProvider;
  policy: GroupPolicy;
}

/**
 * Everything the identity use cases need.
 */
export interface IdentityDeps {
  users: UserRepository;
  sessions: SessionRepository;
  tokens: TokenRepository;
  hasher: PasswordHasher;
  secrets: Secrets;
  clock: Clock;
  /**
   * Failed password sign-ins per login (keyed by `signInKeys.loginKey`, the same for existing and
   * unknown logins): 10 in 900 s lock the login for 900 s for every client without a known device.
   */
  loginAccountLimiter: RateLimiter;
  /** Failed sign-ins per client IP across all logins (password spraying): 50 in 900 s lock the IP. */
  loginIpLimiter: RateLimiter;
  /** Failed sign-ins per known device (its own limit, used instead of the login's): 10 in 900 s. */
  loginDeviceLimiter: RateLimiter;
  /** Limiter keys of logins and the signed known-device cookies. */
  signInKeys: SignInKeys;
  /** Password sign-ins in flight per client IP (each costs a KDF run): at most 4. */
  signInSlots: ConcurrencyLimiter;
  /** The break-glass admin bearer `LORE_API_KEY`. */
  adminKey: string | undefined;
  /** Single sign-on; null when OIDC is not configured (password mode). */
  sso: SsoDeps | null;
  /** Started single sign-on attempts. */
  pendingLogins: PendingLoginRepository;
  /** Single sign-on starts per client IP: 30 per 600 s. */
  ssoStartLimiter: RateLimiter;
  /** CLI device logins. */
  deviceLogins: DeviceLoginRepository;
  /** Device-login starts per client IP: 30 per 600 s. */
  deviceStartLimiter: RateLimiter;
  /** Lifetime in days of the `cli-<hostname>` tokens a device login mints (`LORE_CLI_TOKEN_TTL_DAYS`). */
  cliTokenTtlDays: number;
  /** Absolute lifetime in hours of a single sign-on web session (`LORE_SSO_SESSION_MAX_HOURS`). */
  ssoSessionMaxHours: number;
}
