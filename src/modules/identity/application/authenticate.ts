/** Who is calling: web sessions, personal `sk_` tokens and the break-glass admin key. */
import { isPastDeadline, sessionExpiry, sessionNeedsRefresh } from '../domain/session-policy.js';
import { isTokenExpired } from '../domain/token-policy.js';
import type { Principal, User } from '../domain/user.js';
import type { IdentityDeps } from './ports.js';

const userPrincipal = (u: User, via: 'session' | 'token', tokenId?: string): Principal => ({
  kind: 'user',
  userId: u.id,
  login: u.login,
  displayName: u.displayName,
  role: u.role,
  via,
  ...(tokenId === undefined ? {} : { tokenId }),
});

/**
 * The user of a web session, or null for an unknown or expired session or one past its absolute single sign-on deadline (those are deleted)
 * and for a disabled or deleted user. Slides the expiry when it was last extended more than
 * `SESSION_REFRESH_AFTER_MS` ago; `refreshedUntil` is then the new expiry, for a new cookie.
 */
export async function authenticateSession(
  d: IdentityDeps,
  sessionId: string,
): Promise<{ principal: Principal; refreshedUntil: Date | null } | null> {
  const idHash = d.secrets.sha256Hex(sessionId);
  const session = await d.sessions.find(idHash);
  if (!session) return null;
  const now = d.clock.now();
  if (now.getTime() >= session.expiresAt.getTime() || isPastDeadline(session.deadline, now)) {
    await d.sessions.delete(idHash);
    return null;
  }
  const user = await d.users.findById(session.userId);
  if (!user || user.disabled) return null;
  let refreshedUntil: Date | null = null;
  if (sessionNeedsRefresh(session.expiresAt, now)) {
    refreshedUntil = sessionExpiry(now);
    await d.sessions.extend(idHash, refreshedUntil, now);
  }
  return { principal: userPrincipal(user, 'session'), refreshedUntil };
}

/**
 * A bearer token: an `sk_` token resolves to its owner (null when revoked, expired, unknown, or the owner is
 * disabled or gone) and records its use; `LORE_API_KEY` is the admin key; anything else is null.
 */
export async function authenticateBearer(d: IdentityDeps, token: string): Promise<Principal | null> {
  if (token === '') return null;
  // Comparing digests keeps the comparison independent of where the strings differ.
  const digest = d.secrets.sha256Hex(token);
  if (d.adminKey && digest === d.secrets.sha256Hex(d.adminKey)) return { kind: 'admin-key' };
  if (!token.startsWith('sk_')) return null;
  const record = await d.tokens.findByHash(digest);
  const now = d.clock.now();
  if (!record || record.revokedAt !== null || isTokenExpired(record.expiresAt, now)) return null;
  const user = await d.users.findById(record.userId);
  if (!user || user.disabled) return null;
  await d.tokens.touch(record.id, now);
  return userPrincipal(user, 'token', record.id);
}
