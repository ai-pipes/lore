/**
 * The first admin of a password install, from `LORE_ADMIN_LOGIN` / `LORE_ADMIN_PASSWORD`. In SSO
 * mode they are ignored: the first admin is whoever signs in as a member of the admin group.
 */
import { checkPassword, normalizeLogin } from '../domain/user.js';
import type { IdentityDeps } from './ports.js';

/**
 * Creates the admin when both variables are set and there are no users yet (`created`); `exists`
 * once there is any user; `skipped` (with a warning when only part of it is usable) otherwise.
 * The password is never logged.
 */
export async function bootstrapAdmin(
  d: IdentityDeps,
  env: { login?: string; password?: string },
  log: { info(m: string): void; warn(m: string): void },
): Promise<'created' | 'exists' | 'skipped'> {
  if (!env.login && !env.password) return 'skipped';
  if (d.sso) {
    log.warn('LORE_ADMIN_LOGIN/LORE_ADMIN_PASSWORD are ignored in SSO mode');
    return 'skipped';
  }
  if (!env.login || !env.password) {
    log.warn('LORE_ADMIN_LOGIN and LORE_ADMIN_PASSWORD must both be set; no admin was created');
    return 'skipped';
  }
  const login = normalizeLogin(env.login);
  if (login === null) {
    log.warn('LORE_ADMIN_LOGIN is not a valid login ([a-z0-9._-], up to 128 characters); no admin was created');
    return 'skipped';
  }
  const weak = checkPassword(env.password);
  if (weak) {
    log.warn(`LORE_ADMIN_PASSWORD: ${weak.message}; no admin was created`);
    return 'skipped';
  }
  if ((await d.users.count()) > 0) return 'exists'; // spares the KDF on every restart
  const user = await d.users.insertIfEmpty({
    login,
    displayName: login,
    role: 'admin',
    passwordHash: await d.hasher.hash(env.password),
  });
  if (!user) return 'exists';
  log.info(`created the first admin "${login}" from LORE_ADMIN_LOGIN`);
  return 'created';
}
