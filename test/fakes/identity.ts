/** In-memory identity ports for application tests (no DB, no real KDF). */
import { createHash } from 'crypto';
import type {
  ApiTokenRecord,
  ConcurrencyLimiter,
  DeviceLoginRecord,
  DeviceLoginRepository,
  IdentityDeps,
  NewUser,
  OidcProvider,
  PasswordHasher,
  PendingLogin,
  PendingLoginRepository,
  RateLimiter,
  Secrets,
  SessionRepository,
  SignInKeys,
  SsoDeps,
  TokenRepository,
  UserRepository,
} from '../../src/modules/identity/application/ports.js';
import { IdentityError, type OidcClaims, type User } from '../../src/modules/identity/domain/user.js';
import type { Clock } from '../../src/shared-kernel/index.js';

/** A clock tests move by hand. */
export interface FakeClock extends Clock {
  set(d: Date | number): void;
  advance(ms: number): void;
}

export function fakeClock(start: Date | number = Date.parse('2026-10-31T12:00:00Z')): FakeClock {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    set: (d) => {
      t = new Date(d).getTime();
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Deterministic secrets: `prefix + <counter padded to 43 base64url characters>`; real SHA-256. */
export function fakeSecrets(): Secrets {
  let n = 0;
  return {
    random: (prefix) => prefix + String(++n).padStart(43, 'A'),
    sha256Hex: (s) => createHash('sha256').update(s).digest('hex'),
    sha256B64url: (s) => createHash('sha256').update(s).digest('base64url'),
  };
}

/** `plain$<password>` — fast and easy to assert on. `verifyCalls` counts verifies (dummy-hash checks). */
export function fakeHasher(): PasswordHasher & { verifyCalls: number } {
  const h = {
    verifyCalls: 0,
    async hash(pw: string) {
      return `plain$${pw}`;
    },
    async verify(stored: string, pw: string) {
      h.verifyCalls++;
      return stored === `plain$${pw}`;
    },
  };
  return h;
}

let ids = 0;
const nextId = (p: string) => `${p}-${++ids}`;

export function fakeUsers(clock: Clock, store: User[] = []): UserRepository & { store: User[] } {
  const taken = (u: NewUser) =>
    store.some(
      (x) => x.login === u.login || (u.oidcIss != null && x.oidcIss === u.oidcIss && x.oidcSub === (u.oidcSub ?? null)),
    );
  const make = (u: NewUser): User => {
    if ((u.oidcIss == null) !== (u.oidcSub == null)) throw new Error('half-set OIDC subject');
    const user: User = {
      id: nextId('user'),
      login: u.login,
      displayName: u.displayName,
      role: u.role,
      disabled: false,
      passwordHash: u.passwordHash ?? null,
      oidcIss: u.oidcIss ?? null,
      oidcSub: u.oidcSub ?? null,
      email: u.email ?? null,
      groups: [...(u.groups ?? [])],
      lastLoginAt: null,
      createdAt: clock.now(),
    };
    store.push(user);
    return { ...user };
  };
  return {
    store,
    async insert(u) {
      return taken(u) ? null : make(u);
    },
    async findById(id) {
      const u = store.find((x) => x.id === id);
      return u ? { ...u } : null;
    },
    async findByLogin(login) {
      const u = store.find((x) => x.login === login);
      return u ? { ...u } : null;
    },
    async findBySubject(iss, sub) {
      const u = store.find((x) => x.oidcIss === iss && x.oidcSub === sub);
      return u ? { ...u } : null;
    },
    async list() {
      return [...store].sort((a, b) => a.login.localeCompare(b.login)).map((u) => ({ ...u }));
    },
    async count() {
      return store.length;
    },
    async insertIfEmpty(u) {
      return store.length > 0 || taken(u) ? null : make(u);
    },
    async update(id, patch) {
      const u = store.find((x) => x.id === id);
      if (!u) return null;
      const next = { ...u, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as User;
      // The constraints Postgres enforces on UPDATE too
      const others = store.filter((x) => x.id !== id);
      if (others.some((x) => x.login === next.login)) throw new Error('duplicate key violates users_login_unique');
      if (next.oidcIss != null && others.some((x) => x.oidcIss === next.oidcIss && x.oidcSub === next.oidcSub)) {
        throw new Error('duplicate key violates users_oidc_subject_unique');
      }
      if ((next.oidcIss == null) !== (next.oidcSub == null)) throw new Error('half-set OIDC subject');
      Object.assign(u, next);
      return { ...u };
    },
  };
}

export function fakeSessions(): SessionRepository & { rows: Map<string, { userId: string; expiresAt: Date; lastSeenAt?: Date; method?: string; deadline?: Date | null }> } {
  const rows = new Map<string, { userId: string; expiresAt: Date; lastSeenAt?: Date; method?: string; deadline?: Date | null }>();
  return {
    rows,
    async insert(r) {
      rows.set(r.idHash, { userId: r.userId, expiresAt: r.expiresAt, method: r.method, deadline: r.deadline });
    },
    async find(idHash) {
      const r = rows.get(idHash);
      return r ? { userId: r.userId, expiresAt: r.expiresAt, deadline: r.deadline ?? null } : null;
    },
    async extend(idHash, expiresAt, seenAt) {
      const r = rows.get(idHash);
      if (r) Object.assign(r, { expiresAt, lastSeenAt: seenAt });
    },
    async delete(idHash) {
      rows.delete(idHash);
    },
    async deleteByUser(userId) {
      for (const [k, v] of rows) if (v.userId === userId) rows.delete(k);
    },
  };
}

const pub = ({ hash: _hash, ...r }: ApiTokenRecord & { hash: string }): ApiTokenRecord => ({ ...r });

export function fakeTokens(clock: Clock): TokenRepository & { rows: (ApiTokenRecord & { hash: string })[] } {
  const rows: (ApiTokenRecord & { hash: string })[] = [];
  return {
    rows,
    async insert(t) {
      const r = { id: nextId('token'), ...t, expiresAt: t.expiresAt ?? null, createdAt: clock.now(), lastUsedAt: null, revokedAt: null };
      rows.push(r);
      return pub(r);
    },
    async findByHash(hash) {
      const r = rows.find((x) => x.hash === hash);
      return r ? pub(r) : null;
    },
    async listByUser(userId) {
      return rows.filter((x) => x.userId === userId).map(pub);
    },
    async revoke(userId, id, at) {
      const r = rows.find((x) => x.id === id && x.userId === userId && x.revokedAt === null);
      if (!r) return false;
      r.revokedAt = at;
      return true;
    },
    async revokeAllByUser(userId, at) {
      for (const r of rows) if (r.userId === userId && r.revokedAt === null) r.revokedAt = at;
    },
    async touch(id, at) {
      const r = rows.find((x) => x.id === id);
      if (r) r.lastUsedAt = at;
    },
  };
}

type FakeDeviceRow = DeviceLoginRecord & { deviceCodeHash: string };

/** Device logins in memory; `consumeAndIssueToken` inserts into `tokens` like the Postgres transaction. */
export function fakeDeviceLogins(tokens: TokenRepository): DeviceLoginRepository & { rows: FakeDeviceRow[] } {
  const rows: FakeDeviceRow[] = [];
  const pubDevice = ({ deviceCodeHash: _h, ...r }: FakeDeviceRow): DeviceLoginRecord => ({ ...r });
  const live = (r: FakeDeviceRow, now: Date) => r.expiresAt.getTime() > now.getTime();
  return {
    rows,
    async insert(r) {
      if (rows.some((x) => x.userCode === r.userCode || x.deviceCodeHash === r.deviceCodeHash)) return false;
      rows.push({ id: nextId('device'), ...r, status: 'pending', userId: null });
      return true;
    },
    async findByUserCode(userCode) {
      const r = rows.find((x) => x.userCode === userCode);
      return r ? pubDevice(r) : null;
    },
    async findByDeviceCodeHash(hash) {
      const r = rows.find((x) => x.deviceCodeHash === hash);
      return r ? pubDevice(r) : null;
    },
    async decide(userCode, userId, status, now) {
      const r = rows.find((x) => x.userCode === userCode && x.status === 'pending' && live(x, now));
      if (!r) return false;
      r.status = status;
      r.userId = userId;
      return true;
    },
    async consumeAndIssueToken(id, token, now) {
      const r = rows.find((x) => x.id === id && x.status === 'approved' && live(x, now));
      if (!r || r.userId === null) return null;
      r.status = 'consumed';
      await tokens.insert({ userId: r.userId, ...token });
      return { userId: r.userId };
    },
    async deny(id) {
      const r = rows.find((x) => x.id === id && x.status === 'approved');
      if (r) r.status = 'denied';
    },
    async denyApprovedByUser(userId) {
      for (const r of rows) if (r.userId === userId && r.status === 'approved') r.status = 'denied';
    },
    async deleteExpired(now) {
      for (let i = rows.length - 1; i >= 0; i--) if (!live(rows[i], now)) rows.splice(i, 1);
    },
  };
}

/** Allows `limit` hits per key; `check`/`hit` report `retryAfterSec` once the key is over the limit. */
export function fakeRateLimiter(limit = Infinity, retryAfterSec = 900): RateLimiter & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const state = (key: string) => {
    const allowed = (counts.get(key) ?? 0) < limit;
    return { allowed, retryAfterSec: allowed ? 0 : retryAfterSec };
  };
  return {
    counts,
    check: state,
    hit(key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return state(key);
    },
    count: (key) => counts.get(key) ?? 0,
    refund(key) {
      const n = counts.get(key) ?? 0;
      // a key at the limit is locked: a refund never lifts the lock
      if (n > 0 && n < limit) counts.set(key, n - 1);
    },
    reset(key) {
      counts.delete(key);
    },
  };
}

/** At most `max` holders per key; `inFlight` shows the current holders. */
export function fakeConcurrencyLimiter(max = Infinity): ConcurrencyLimiter & { inFlight: Map<string, number> } {
  const inFlight = new Map<string, number>();
  return {
    inFlight,
    tryAcquire(key) {
      const n = inFlight.get(key) ?? 0;
      if (n >= max) return false;
      inFlight.set(key, n + 1);
      return true;
    },
    release(key) {
      const n = inFlight.get(key) ?? 0;
      if (n <= 1) inFlight.delete(key);
      else inFlight.set(key, n - 1);
    },
  };
}

/**
 * Readable limiter keys and device cookies: `lk:<login>` and `dev.<userId>.<n>.<expiry ms>.sig`.
 * Anything else (another suffix, a malformed value) does not verify. `devicesEnabled = false`
 * stands for a server without a device-cookie secret.
 */
export function fakeSignInKeys(): SignInKeys & { devicesEnabled: boolean } {
  let n = 0;
  const k = {
    devicesEnabled: true,
    loginKey: (login: string) => `lk:${login}`,
    issueDevice(userId: string, expiresAt: Date) {
      return k.devicesEnabled ? `dev.${userId}.d${++n}.${expiresAt.getTime()}.sig` : null;
    },
    verifyDevice(raw: string, now: Date) {
      const m = /^dev\.([^.]+)\.([^.]+)\.(\d+)\.sig$/.exec(raw);
      if (!m || Number(m[3]) <= now.getTime()) return null;
      return { userId: m[1], deviceId: m[2] };
    },
  };
  return k;
}

export function fakePendingLogins(): PendingLoginRepository & { rows: Map<string, PendingLogin> } {
  const rows = new Map<string, PendingLogin>();
  return {
    rows,
    async insert(p) {
      rows.set(p.state, { ...p });
    },
    async consume(state) {
      const p = rows.get(state);
      rows.delete(state);
      return p ? { ...p } : null;
    },
  };
}

/** Claims for a fake provider answer; `sub` is required, everything else defaults to empty. */
export function claims(c: Partial<OidcClaims> & { sub: string }): OidcClaims {
  return { preferredUsername: null, name: null, email: null, emailVerified: false, groups: [], ...c };
}

/**
 * An OIDC provider in memory: `answer` is what the next exchange returns (or throws); `down`
 * makes both methods throw `idp_unavailable`. Records the requests it saw.
 */
export interface FakeOidcProvider extends OidcProvider {
  answer: OidcClaims | Error;
  down: boolean;
  /** Thrown by `authorizationUrl` when set (an unexpected failure). */
  startError: Error | null;
  authorizations: { state: string; codeChallenge: string; nonce: string }[];
  exchanges: { code: string; codeVerifier: string; nonce: string; iss?: string }[];
}

const unavailable = () => new IdentityError('idp_unavailable', 'the identity provider is unavailable');

export function fakeOidcProvider(answer: OidcClaims | Error = claims({ sub: 'sub-1' })): FakeOidcProvider {
  const p: FakeOidcProvider = {
    answer,
    down: false,
    startError: null,
    authorizations: [],
    exchanges: [],
    async authorizationUrl(i) {
      if (p.startError) throw p.startError;
      if (p.down) throw unavailable();
      p.authorizations.push(i);
      const url = new URL('https://idp.example/authorize');
      url.searchParams.set('state', i.state);
      url.searchParams.set('nonce', i.nonce);
      url.searchParams.set('code_challenge', i.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return url;
    },
    async exchange(i) {
      if (p.down) throw unavailable();
      p.exchanges.push(i);
      if (p.answer instanceof Error) throw p.answer;
      return { ...p.answer, groups: [...p.answer.groups] };
    },
  };
  return p;
}

export const FAKE_ISSUER = 'https://idp.example';

/** Single sign-on deps around a fake provider: groups `lore-users` / `lore-admins`. */
export function fakeSso(provider: FakeOidcProvider = fakeOidcProvider()): SsoDeps & { provider: FakeOidcProvider } {
  return { issuer: FAKE_ISSUER, provider, policy: { loginGroup: 'lore-users', adminGroup: 'lore-admins' } };
}

export interface FakeIdentity extends IdentityDeps {
  users: ReturnType<typeof fakeUsers>;
  sessions: ReturnType<typeof fakeSessions>;
  tokens: ReturnType<typeof fakeTokens>;
  hasher: ReturnType<typeof fakeHasher>;
  loginAccountLimiter: ReturnType<typeof fakeRateLimiter>;
  loginIpLimiter: ReturnType<typeof fakeRateLimiter>;
  loginDeviceLimiter: ReturnType<typeof fakeRateLimiter>;
  signInKeys: ReturnType<typeof fakeSignInKeys>;
  signInSlots: ReturnType<typeof fakeConcurrencyLimiter>;
  deviceLogins: ReturnType<typeof fakeDeviceLogins>;
  deviceStartLimiter: ReturnType<typeof fakeRateLimiter>;
  clock: FakeClock;
  pendingLogins: ReturnType<typeof fakePendingLogins>;
  ssoStartLimiter: ReturnType<typeof fakeRateLimiter>;
}

/** All identity ports in memory. */
export function fakeIdentity(
  o: {
    adminKey?: string;
    clock?: FakeClock;
    loginAccountLimit?: number;
    loginIpLimit?: number;
    loginDeviceLimit?: number;
    signInConcurrency?: number;
    sso?: SsoDeps | null;
    ssoStartLimit?: number;
    deviceStartLimit?: number;
  } = {},
): FakeIdentity {
  const clock = o.clock ?? fakeClock();
  const tokens = fakeTokens(clock);
  return {
    users: fakeUsers(clock),
    sessions: fakeSessions(),
    tokens,
    deviceLogins: fakeDeviceLogins(tokens),
    deviceStartLimiter: fakeRateLimiter(o.deviceStartLimit),
    cliTokenTtlDays: 90,
    ssoSessionMaxHours: 24,
    hasher: fakeHasher(),
    secrets: fakeSecrets(),
    clock,
    loginAccountLimiter: fakeRateLimiter(o.loginAccountLimit),
    loginIpLimiter: fakeRateLimiter(o.loginIpLimit),
    loginDeviceLimiter: fakeRateLimiter(o.loginDeviceLimit),
    signInKeys: fakeSignInKeys(),
    signInSlots: fakeConcurrencyLimiter(o.signInConcurrency),
    adminKey: o.adminKey,
    sso: o.sso ?? null,
    pendingLogins: fakePendingLogins(),
    ssoStartLimiter: fakeRateLimiter(o.ssoStartLimit),
  };
}
