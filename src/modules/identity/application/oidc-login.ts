/**
 * Single sign-on (OIDC Authorization Code + PKCE S256 + state + nonce), ported from
 * ai-pipes/skills-registry (identity/application/oidc-login.ts), and linking provider accounts
 * to existing users (`lore link-sso` / `unlink-sso`).
 */
import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { isLoginStateExpired, loginBase, loginCandidate, loginStateExpiry, normalizeReturnTo } from '../domain/login-flow.js';
import { accessFor, IdentityError, normalizeLogin, type OidcClaims, type Role, type User } from '../domain/user.js';
import type { IdentityDeps, SsoDeps } from './ports.js';
import { startSession } from './sessions.js';

/** How many `login`, `login-2`, … are tried for a new person before giving up. */
const MAX_LOGIN_ATTEMPTS = 100;

const notConfigured = () => new IdentityError('not_found', 'single sign-on is not configured');

const isIdpUnavailable = (e: unknown): e is IdentityError => e instanceof IdentityError && e.code === 'idp_unavailable';

/**
 * Begins a sign-in: returns the provider URL (its `state` binds the attempt to this browser) and
 * remembers the attempt for 10 minutes. `idp_unavailable` when the provider cannot be reached,
 * `rate_limited` when this IP started too many attempts (nothing is remembered then).
 */
export async function startSsoLogin(
  d: IdentityDeps,
  i: { returnTo: string; ip: string },
): Promise<Result<{ url: URL; state: string }, IdentityError>> {
  if (!d.sso) return err(notConfigured());
  // Every start stores a pending attempt for anyone, without a session: bounded per IP.
  const limit = d.ssoStartLimiter.hit(i.ip);
  if (!limit.allowed) return err(new IdentityError('rate_limited', 'too many sign-in attempts', limit.retryAfterSec));

  const state = d.secrets.random('');
  const nonce = d.secrets.random('');
  const codeVerifier = d.secrets.random('');
  let url: URL;
  try {
    url = await d.sso.provider.authorizationUrl({ state, nonce, codeChallenge: d.secrets.sha256B64url(codeVerifier) });
  } catch (e) {
    if (isIdpUnavailable(e)) return err(e);
    throw e;
  }
  await d.pendingLogins.insert({
    state,
    codeVerifier,
    nonce,
    returnTo: normalizeReturnTo(i.returnTo),
    expiresAt: loginStateExpiry(d.clock.now()),
  });
  return ok({ url, state });
}

/**
 * Finishes a sign-in: consumes the state (once), redeems the code, applies the group policy, then
 * creates or refreshes the user (role, groups and email re-synced every time) and starts a web
 * session. A person in neither group is `not_allowed`, and a known one loses their web sessions.
 */
export async function completeSsoLogin(
  d: IdentityDeps,
  i: { state: string; code: string; iss?: string; ip: string },
): Promise<Result<{ sessionId: string; expiresAt: Date; returnTo: string }, IdentityError>> {
  const sso = d.sso;
  if (!sso) return err(notConfigured());

  const pending = await d.pendingLogins.consume(i.state);
  if (!pending || isLoginStateExpired(pending.expiresAt, d.clock.now())) {
    return err(new IdentityError('invalid_state', 'login attempt is unknown or expired'));
  }

  let claims: OidcClaims;
  try {
    claims = await sso.provider.exchange({
      code: i.code,
      codeVerifier: pending.codeVerifier,
      nonce: pending.nonce,
      ...(i.iss === undefined ? {} : { iss: i.iss }),
    });
  } catch (e) {
    if (isIdpUnavailable(e)) return err(e);
    return err(new IdentityError('invalid_state', 'the identity provider rejected the login'));
  }

  const existing = await d.users.findBySubject(sso.issuer, claims.sub);
  const role = accessFor(claims.groups, sso.policy);
  if (!role) {
    // Left the groups: their web sessions and pending CLI approvals end now. Tokens stay (they are
    // revoked explicitly).
    if (existing) {
      await d.sessions.deleteByUser(existing.id);
      await d.deviceLogins.denyApprovedByUser(existing.id);
    }
    return err(new IdentityError('not_allowed', 'your account is not in an allowed group'));
  }

  const user = existing?.disabled
    ? existing
    : existing
      ? await refreshUser(d, existing, claims, role)
      : await createSsoUser(d, sso, claims, role);
  // A disabled user, or one created by a concurrent first sign-in and disabled meanwhile.
  if (user.disabled) return err(new IdentityError('disabled', 'account is disabled'));

  const session = await startSession(d, user.id, 'sso');
  return ok({ ...session, returnTo: pending.returnTo });
}

async function refreshUser(d: IdentityDeps, user: User, claims: OidcClaims, role: Role): Promise<User> {
  const updated = await d.users.update(user.id, {
    role,
    groups: claims.groups,
    email: claims.email,
    ...(claims.name === null ? {} : { displayName: claims.name }),
  });
  return updated ?? user;
}

/** A first sign-in: a new user with a free login (`base`, `base-2`, …); never linked by login or email. */
async function createSsoUser(d: IdentityDeps, sso: SsoDeps, claims: OidcClaims, role: Role): Promise<User> {
  const base = loginBase(claims);
  for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
    const login = loginCandidate(base, attempt);
    const user = await d.users.insert({
      login,
      displayName: claims.name ?? login,
      role,
      oidcIss: sso.issuer,
      oidcSub: claims.sub,
      email: claims.email,
      groups: claims.groups,
    });
    if (user) return user;
    // The same person signing in twice at once: the other request created them.
    const raced = await d.users.findBySubject(sso.issuer, claims.sub);
    if (raced) return raced.disabled ? raced : refreshUser(d, raced, claims, role);
  }
  throw new Error(`no free login for "${base}" after ${MAX_LOGIN_ATTEMPTS} attempts`);
}

/**
 * Links the provider account `sub` (at the configured issuer) to the user `login`, so that their
 * single sign-on lands on that user. `sso_linked` when the account belongs to another user; a
 * no-op when it already belongs to this one.
 */
export async function linkSso(d: IdentityDeps, login: string, sub: string): Promise<Result<void, IdentityError>> {
  if (!d.sso) return err(notConfigured());
  const subject = sub.trim();
  if (subject === '') return err(new IdentityError('invalid_input', 'the provider subject (sub) is empty'));
  const user = await findUser(d, login);
  if (!user) return err(new IdentityError('not_found', `no user "${login}"`));
  const owner = await d.users.findBySubject(d.sso.issuer, subject);
  if (owner && owner.id !== user.id) {
    return err(new IdentityError('sso_linked', `that account is already linked to "${owner.login}"`));
  }
  if (owner) return ok(undefined);
  const updated = await d.users.update(user.id, { oidcIss: d.sso.issuer, oidcSub: subject });
  if (!updated) return err(new IdentityError('not_found', `no user "${login}"`));
  return ok(undefined);
}

/** Removes the provider link of `login` (a no-op when there is none). */
export async function unlinkSso(d: IdentityDeps, login: string): Promise<Result<void, IdentityError>> {
  const user = await findUser(d, login);
  if (!user) return err(new IdentityError('not_found', `no user "${login}"`));
  await d.users.update(user.id, { oidcIss: null, oidcSub: null });
  return ok(undefined);
}

async function findUser(d: IdentityDeps, raw: string): Promise<User | null> {
  const login = normalizeLogin(raw);
  return login === null ? null : d.users.findByLogin(login);
}
