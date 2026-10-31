/**
 * Users administration (admins): list, create, change role / display name / disabled, reset a
 * password. In SSO mode people and passwords live in the identity provider, so creating a user and
 * resetting a password are `sso_managed`; disabling still works (and outlasts group membership).
 */
import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { checkPassword, IdentityError, normalizeLogin, type Role, type User } from '../domain/user.js';
import type { IdentityDeps, UserPatch } from './ports.js';

export const DISPLAY_NAME_MAX_LENGTH = 200;

const ROLES: readonly string[] = ['admin', 'member'] satisfies Role[];

const invalid = (message: string) => err(new IdentityError('invalid_input', message));
const notFound = () => err(new IdentityError('not_found', 'no such user'));
const ssoManaged = () =>
  err(new IdentityError('sso_managed', 'people and passwords are managed in the identity provider'));

/** All users, by login. */
export async function listUsers(d: IdentityDeps): Promise<User[]> {
  return d.users.list();
}

/** The trimmed display name, or null when it is longer than DISPLAY_NAME_MAX_LENGTH. */
function cleanDisplayName(raw: string): string | null {
  const name = raw.trim();
  return name.length > DISPLAY_NAME_MAX_LENGTH ? null : name;
}

/**
 * A new password user. The login is normalized (a different case is the same login); a blank
 * display name falls back to the login.
 */
export async function createUser(
  d: IdentityDeps,
  i: { login: string; displayName: string; password: string; role: Role },
): Promise<Result<User, IdentityError>> {
  if (d.sso) return ssoManaged();
  const login = normalizeLogin(i.login);
  if (login === null) return invalid('login must be 1-128 characters of a-z, 0-9, ".", "_" or "-"');
  const displayName = cleanDisplayName(i.displayName);
  if (displayName === null) return invalid(`display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`);
  if (!ROLES.includes(i.role)) return invalid('role must be "admin" or "member"');
  const weak = checkPassword(i.password);
  if (weak) return err(weak);
  const taken = () => err(new IdentityError('user_exists', `the login "${login}" is taken`));
  if (await d.users.findByLogin(login)) return taken();
  const user = await d.users.insert({
    login,
    displayName: displayName || login,
    role: i.role,
    passwordHash: await d.hasher.hash(i.password),
  });
  return user ? ok(user) : taken();
}

/**
 * Changes a user. `actorId` is the admin making the change (null for the admin key); an actor
 * cannot disable or demote themself (`forbidden`). Disabling deletes the user's web sessions;
 * their tokens stop working while they are disabled and work again once re-enabled.
 */
export async function updateUser(
  d: IdentityDeps,
  actorId: string | null,
  id: string,
  p: { displayName?: string; role?: Role; disabled?: boolean },
): Promise<Result<User, IdentityError>> {
  const patch: UserPatch = {};
  if (p.displayName !== undefined) {
    const name = typeof p.displayName === 'string' ? cleanDisplayName(p.displayName) : null;
    if (!name) return invalid(`display name must be 1-${DISPLAY_NAME_MAX_LENGTH} characters`);
    patch.displayName = name;
  }
  if (p.role !== undefined) {
    if (!ROLES.includes(p.role)) return invalid('role must be "admin" or "member"');
    patch.role = p.role;
  }
  if (p.disabled !== undefined) {
    if (typeof p.disabled !== 'boolean') return invalid('disabled must be true or false');
    patch.disabled = p.disabled;
  }
  const user = await d.users.findById(id);
  if (!user) return notFound();
  if (actorId === user.id && (patch.disabled === true || (patch.role === 'member' && user.role === 'admin'))) {
    return err(new IdentityError('forbidden', 'you cannot disable or demote yourself'));
  }
  const updated = await d.users.update(id, patch);
  if (!updated) return notFound();
  if (patch.disabled === true) {
    await d.sessions.deleteByUser(id);
    await d.deviceLogins.denyApprovedByUser(id);
  }
  return ok(updated);
}

/**
 * Sets a new password for a user, ends their web sessions, cancels the CLI logins they approved but
 * the CLI has not picked up yet, and revokes their personal `sk_` tokens (whoever knew the old
 * password may have minted some). `actorId` is the admin doing it (null for
 * the admin key); an admin changing their own password must give the current one (`forbidden`).
 */
export async function resetPassword(
  d: IdentityDeps,
  actorId: string | null,
  id: string,
  password: string,
  currentPassword?: string,
): Promise<Result<void, IdentityError>> {
  if (d.sso) return ssoManaged();
  const weak = checkPassword(password);
  if (weak) return err(weak);
  const user = await d.users.findById(id);
  if (!user) return notFound();
  if (actorId === user.id) {
    // The current-password check is a password guess like a sign-in: it counts against the same
    // per-login lock, and the attempt that finds the login locked also ends the caller's sessions.
    const key = d.signInKeys.loginKey(user.login);
    const limit = d.loginAccountLimiter.hit(key);
    if (!limit.allowed) {
      await d.sessions.deleteByUser(user.id);
      await d.deviceLogins.denyApprovedByUser(user.id);
      return err(new IdentityError('rate_limited', 'too many attempts', limit.retryAfterSec));
    }
    const confirmed =
      currentPassword !== undefined && user.passwordHash !== null && (await d.hasher.verify(user.passwordHash, currentPassword));
    if (!confirmed) return err(new IdentityError('forbidden', 'changing your own password needs your current password'));
    d.loginAccountLimiter.refund(key);
  }
  const updated = await d.users.update(id, { passwordHash: await d.hasher.hash(password) });
  if (!updated) return notFound();
  await d.sessions.deleteByUser(id);
  await d.deviceLogins.denyApprovedByUser(id);
  await d.tokens.revokeAllByUser(id, d.clock.now());
  return ok(undefined);
}
