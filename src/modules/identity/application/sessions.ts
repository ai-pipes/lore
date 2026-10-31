/** Password sign-in and sign-out of web sessions. */
import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { knownDeviceExpiry, sessionDeadline, sessionExpiry, type SignInMethod } from '../domain/session-policy.js';
import { IdentityError, MAX_PASSWORD_LENGTH, normalizeLogin } from '../domain/user.js';
import type { IdentityDeps, PasswordHasher } from './ports.js';

// Verified against when the login does not exist (or has no password), so that "no such user"
// costs the same as "wrong password". One lazily computed hash per hasher instance.
const dummyHashes = new WeakMap<PasswordHasher, Promise<string>>();
function dummyHash(d: IdentityDeps): Promise<string> {
  let h = dummyHashes.get(d.hasher);
  if (!h) {
    h = d.hasher.hash(d.secrets.random(''));
    dummyHashes.set(d.hasher, h);
  }
  return h;
}

/**
 * A new web session for `userId`; only the SHA-256 of its id is stored. Stamps the last login.
 * Records how the person signed in; a single sign-on session also gets its absolute deadline.
 */
export async function startSession(
  d: IdentityDeps,
  userId: string,
  method: SignInMethod = 'password',
): Promise<{ sessionId: string; expiresAt: Date }> {
  const now = d.clock.now();
  const sessionId = d.secrets.random('');
  const expiresAt = sessionExpiry(now);
  const deadline = sessionDeadline(method, now, d.ssoSessionMaxHours);
  await d.sessions.insert({ idHash: d.secrets.sha256Hex(sessionId), userId, expiresAt, method, deadline });
  await d.users.update(userId, { lastLoginAt: now });
  return { sessionId, expiresAt };
}

const tooMany = (retryAfterSec: number) => err(new IdentityError('rate_limited', 'too many attempts', retryAfterSec));
const invalidCredentials = () => err(new IdentityError('invalid_credentials', 'invalid login or password'));

/**
 * Signs in with login and password (`sso_only` in SSO mode). Every failure (unknown login, wrong
 * password, no password, disabled user) is `invalid_credentials`. The limits ("device cookies",
 * OWASP), each attempt counted before the password is checked so concurrent guesses cannot slip
 * past, a success giving its attempt back, and every refusal `rate_limited` without KDF work:
 * - at most a few sign-ins in flight per client IP (`signInSlots`);
 * - failures per client IP across all logins (`loginIpLimiter`, password spraying);
 * - failures per login (`loginAccountLimiter`, keyed by an HMAC of the login, so an unknown login
 *   is limited exactly like an existing one): a hard lock for every client
 * - except a known device: a browser presenting a valid device cookie of this user (issued by an
 *   earlier successful sign-in) is limited by its own counter (`loginDeviceLimiter`) instead.
 * A successful sign-in returns a fresh device cookie (null when device cookies are off).
 */
export async function passwordLogin(
  d: IdentityDeps,
  i: { login: string; password: string; ip: string; deviceCookie?: string | null },
): Promise<Result<{ sessionId: string; expiresAt: Date; deviceCookie: string | null }, IdentityError>> {
  // In SSO mode people sign in at the provider; refused before any limiter or KDF work.
  if (d.sso) return err(new IdentityError('sso_only', 'password sign-in is off: sign in with SSO'));
  if (!d.signInSlots.tryAcquire(i.ip)) return tooMany(1);
  try {
    const perIp = d.loginIpLimiter.hit(i.ip);
    if (!perIp.allowed) return tooMany(perIp.retryAfterSec);

    const login = normalizeLogin(i.login);
    if (login === null || i.password.length > MAX_PASSWORD_LENGTH) {
      // Never reaches the DB; one dummy verify keeps the timing the same as any other failure.
      await d.hasher.verify(await dummyHash(d), i.password.slice(0, MAX_PASSWORD_LENGTH));
      return invalidCredentials();
    }

    const now = d.clock.now();
    const device = i.deviceCookie ? d.signInKeys.verifyDevice(i.deviceCookie, now) : null;
    const accountKey = d.signInKeys.loginKey(login);
    // Without a device cookie the login's limit is applied before the user is even looked up.
    const hitAccount = () => d.loginAccountLimiter.hit(accountKey);
    let limit = device ? null : hitAccount();
    if (limit && !limit.allowed) return tooMany(limit.retryAfterSec);

    const user = await d.users.findByLogin(login);
    const knownDevice = device !== null && user !== null && device.userId === user.id;
    if (device) limit = knownDevice ? d.loginDeviceLimiter.hit(device.deviceId) : hitAccount();
    if (limit && !limit.allowed) return tooMany(limit.retryAfterSec);

    const passwordOk = await d.hasher.verify(user?.passwordHash ?? (await dummyHash(d)), i.password);
    // A disabled user answers exactly like a wrong password.
    if (!user || user.passwordHash === null || !passwordOk || user.disabled) return invalidCredentials();

    d.loginIpLimiter.refund(i.ip);
    if (knownDevice) d.loginDeviceLimiter.refund(device.deviceId);
    else d.loginAccountLimiter.refund(accountKey);
    const session = await startSession(d, user.id);
    return ok({ ...session, deviceCookie: d.signInKeys.issueDevice(user.id, knownDeviceExpiry(now)) });
  } finally {
    d.signInSlots.release(i.ip);
  }
}

/** Lifts the sign-in lock of a user's login (an admin action). `not_found` for an unknown user. */
export async function unlockLogin(d: IdentityDeps, userId: string): Promise<Result<void, IdentityError>> {
  const user = await d.users.findById(userId);
  if (!user) return err(new IdentityError('not_found', 'no such user'));
  d.loginAccountLimiter.reset(d.signInKeys.loginKey(user.login));
  return ok(undefined);
}

/** Ends the web session with this id (no-op for an unknown id). */
export async function logout(d: IdentityDeps, sessionId: string): Promise<void> {
  await d.sessions.delete(d.secrets.sha256Hex(sessionId));
}
