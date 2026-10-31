/**
 * The Caller of a request, resolved once in an `onRequest` hook: a user via the `lore_session`
 * cookie or an `sk_` bearer token, a project key (`lpk_`), or the break-glass admin key.
 */
import type { FastifyRequest } from 'fastify';
import { authenticateProjectKey, PROJECT_KEY_PREFIX, type ProjectCaller, type PushActor } from '../../modules/catalog/index.js';
import {
  authenticateBearer,
  authenticateSession,
  extractToken,
  sessionCookie,
  sessionIdFromCookies,
  type Principal,
} from '../../modules/identity/index.js';
import type { Container } from '../container.js';
import { isSecureRequest } from './cookies.js';

export type Caller = Principal | ProjectCaller;

/** The pushing side of a caller, for the catalog's push policy. */
export function pushActorOf(caller: Caller | null): PushActor {
  if (!caller) return { kind: 'none' };
  if (caller.kind === 'project') {
    return { kind: 'project', keyId: caller.keyId, namespaceId: caller.namespaceId, libraryId: caller.libraryId };
  }
  if (caller.kind === 'admin-key' || caller.role === 'admin') return { kind: 'admin' };
  return { kind: 'none' };
}

/** The user behind a caller, or null (the admin key, a project key, anonymous). */
export function userIdOf(caller: Caller | null): string | null {
  return caller?.kind === 'user' ? caller.userId : null;
}

declare module 'fastify' {
  interface FastifyRequest {
    caller: Caller | null;
  }
}

/**
 * A request with an `Authorization` header is judged by its bearer token alone (an invalid one is
 * anonymous, not a fallback to the cookie). Otherwise the session cookie; `setCookie` is the
 * renewed cookie when the session's expiry slid forward.
 */
export async function resolveCaller(c: Container, req: FastifyRequest): Promise<{ caller: Caller | null; setCookie?: string }> {
  if (req.headers.authorization !== undefined) {
    const token = extractToken(req);
    if (!token) return { caller: null };
    if (token.startsWith(PROJECT_KEY_PREFIX)) return { caller: await authenticateProjectKey(c.catalog, token) };
    return { caller: await authenticateBearer(c.identity, token) };
  }
  const sessionId = sessionIdFromCookies(req.headers.cookie);
  if (!sessionId) return { caller: null };
  const r = await authenticateSession(c.identity, sessionId);
  if (!r) return { caller: null };
  return r.refreshedUntil
    ? { caller: r.principal, setCookie: sessionCookie(sessionId, isSecureRequest(req, c.cookieSecure)) }
    : { caller: r.principal };
}
