/**
 * The authorization gate. Every route has exactly one entry in ROUTE_POLICY, keyed by
 * `${METHOD} ${url}` exactly as Fastify registers it. Registering a route without an entry
 * throws, so a new or forgotten route can never be served openly (fail closed).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isInteractiveAdmin, unauthenticated } from '../../modules/identity/index.js';
import type { Container } from '../container.js';
import type { Caller } from './caller.js';

/**
 * - `public` — anyone.
 * - `read` — a user or the admin key.
 * - `push-read` — what `lore push` reads: a user, the admin key or a project key (the catalog's
 *   push guard limits a project key to libraries of its namespace).
 * - `push` — an admin user, the admin key or a project key (the push guard limits a project key to
 *   its namespace, and nobody to the `insights` namespace).
 * - `chat` — a user only; the admin key has no user, so it is forbidden.
 * - `session` — a user signed in with a web session (not an `sk_` token).
 * - `admin` — an admin user (session or `sk_`) or the admin key.
 * - `admin-session` — an admin user signed in with a web session, or the admin key (break-glass);
 *   an admin's `sk_` token is refused: creating users and resetting passwords.
 * A project key gets 403 on `read`, `chat`, `session`, `admin` and `admin-session` routes.
 */
export type Access = 'public' | 'read' | 'push-read' | 'push' | 'chat' | 'session' | 'admin' | 'admin-session';

const POLICY: Record<string, Access> = {
  'GET /health': 'public',
  'GET /health/live': 'public',
  'GET /health/ready': 'public',
  'GET /login': 'public',
  'GET /assets/lore.css': 'public',
  'GET /assets/lore.js': 'public',
  'GET /assets/account.js': 'public',
  'GET /assets/vendor/:name': 'public',
  'GET /api/auth/config': 'public',
  'POST /api/auth/login': 'public',
  'POST /api/auth/logout': 'public',
  'GET /api/auth/sso/login': 'public',
  'GET /api/auth/sso/callback': 'public',
  'POST /api/cli/login/start': 'public',
  'POST /api/cli/login/poll': 'public',

  // Personal tokens: a web session only, so a leaked token cannot mint more. `current` revokes the
  // calling token (the handler answers 400 unless the caller came with an sk_ token).
  'GET /tokens': 'session',
  'GET /api/tokens': 'session',
  'POST /api/tokens': 'session',
  'DELETE /api/tokens/:id': 'session',
  'DELETE /api/tokens/current': 'read',

  'GET /': 'read',
  'GET /api/services': 'read',
  'GET /api/search': 'read',
  'GET /api/document': 'read',
  'GET /api/libraries/:libraryId/diff/*': 'read',
  'GET /api/libraries/:libraryId/topology/:service': 'read',
  'GET /api/libraries/:id/versions/:versionId/images/*': 'read',
  'GET /static/libraries/:id/versions/:versionId/images/*': 'read',

  // `lore whoami` with a project key asks who it is too.
  'GET /api/auth/me': 'push-read',
  'GET /api/libraries': 'push-read',
  'GET /api/libraries/:id': 'push-read',
  'GET /api/libraries/:id/versions': 'push-read',
  'GET /api/libraries/:id/documents': 'push-read',
  'GET /api/libraries/:id/versions/:versionId/document-hashes': 'push-read',
  'GET /api/libraries/:id/versions/:versionId/images': 'push-read',

  'POST /api/libraries': 'push',
  'POST /api/libraries/:id/versions': 'push',
  'POST /api/libraries/:id/versions/:versionId/clone-from/:sourceVersionId': 'push',
  'DELETE /api/libraries/:id/versions/:versionId': 'push',
  'POST /api/libraries/:id/versions/:versionId/promote': 'push',
  'POST /api/libraries/:id/versions/:versionId/documents': 'push',
  'POST /api/libraries/:id/versions/:versionId/documents/bulk': 'push',
  'DELETE /api/libraries/:id/versions/:versionId/documents/:slug': 'push',
  'POST /api/libraries/:id/versions/:versionId/images': 'push',
  'DELETE /api/libraries/:id/versions/:versionId/images/*': 'push',

  'GET /api/sessions': 'chat',
  'POST /api/sessions': 'chat',
  'GET /api/sessions/:id': 'chat',
  'PATCH /api/sessions/:id': 'chat',
  'DELETE /api/sessions/:id': 'chat',
  'POST /api/sessions/:id/messages': 'chat',
  'POST /api/sessions/:id/publish': 'chat',
  'POST /api/chat': 'chat',

  'GET /admin/users': 'admin',
  'GET /api/users': 'admin',
  'POST /api/users': 'admin-session',
  // Role changes need an admin-session caller: the handler refuses `role` from an sk_ token.
  'PATCH /api/users/:id': 'admin',
  'POST /api/users/:id/password': 'admin-session',
  'POST /api/users/:id/unlock': 'admin',

  'GET /admin/namespaces': 'admin',
  'GET /api/namespaces': 'admin',
  'POST /api/namespaces': 'admin',
  'PATCH /api/namespaces/:id': 'admin',
  'PUT /api/libraries/:id/namespace': 'admin',
  'GET /api/project-keys': 'admin',
  'POST /api/project-keys': 'admin',
  'DELETE /api/project-keys/:id': 'admin',

  'GET /cli/login': 'session',
  'GET /api/cli/login/:userCode': 'session',
  'POST /api/cli/login/approve': 'session',
};

// The test-only reset route exists only under NODE_ENV=test, and so does its policy row.
if (process.env.NODE_ENV === 'test') POLICY['DELETE /api/test/reset'] = 'public';

export const ROUTE_POLICY: Readonly<Record<string, Access>> = Object.freeze(POLICY);

/** Whether `caller` may use a route with `access`. */
export function allows(access: Access, caller: Caller | null): 'ok' | 'unauthenticated' | 'forbidden' {
  if (access === 'public') return 'ok';
  if (!caller) return 'unauthenticated';
  if (caller.kind === 'project') return access === 'push-read' || access === 'push' ? 'ok' : 'forbidden';
  const isAdmin = caller.kind === 'admin-key' || caller.role === 'admin';
  switch (access) {
    case 'read':
    case 'push-read':
      return 'ok';
    case 'push':
    case 'admin':
      return isAdmin ? 'ok' : 'forbidden';
    case 'chat':
      return caller.kind === 'user' ? 'ok' : 'forbidden';
    case 'session':
      return caller.kind === 'user' && caller.via === 'session' ? 'ok' : 'forbidden';
    case 'admin-session':
      return isInteractiveAdmin(caller) ? 'ok' : 'forbidden';
  }
}

/** The policy of a registered route; HEAD routes Fastify adds for GET routes share the GET row. */
function policyOf(method: string, url: string): Access | undefined {
  return ROUTE_POLICY[`${method} ${url}`] ?? (method === 'HEAD' ? ROUTE_POLICY[`GET ${url}`] : undefined);
}

/** Pages (not `/api` or `/static`) send an anonymous browser to the sign-in page instead of a 401. */
function isPageRequest(req: FastifyRequest): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = req.url.split('?')[0];
  return !path.startsWith('/api/') && !path.startsWith('/static/');
}

function redirectToLogin(req: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.redirect(`/login?returnTo=${encodeURIComponent(req.url)}`, 302);
}

/**
 * Installs the gate. `onRoute` checks every route registered after this call; a route without a
 * policy fails startup with `no access policy for …` (a route inside a plugin fails its
 * `register`, any other fails `ready()`). An `onRequest` hook (after the caller is resolved)
 * enforces the policy: 401 for anonymous callers (302 to /login for pages), 403 when the caller
 * lacks the access. Unknown routes are 401 for anonymous callers, 403 for project keys (they may
 * use only push routes) and 404 otherwise.
 */
export function registerAuthorization(app: FastifyInstance, _c: Container): void {
  const unlisted: string[] = [];
  app.addHook('onRoute', function (this: FastifyInstance, route) {
    for (const method of [route.method].flat()) {
      if (policyOf(method, route.url)) continue;
      const message = `no access policy for ${method} ${route.url}`;
      // Throwing at the root would escape the caller's `app.get(…)`; report it from onReady instead.
      if (this === app) unlisted.push(message);
      else throw new Error(message);
    }
  });
  app.addHook('onReady', async () => {
    if (unlisted.length > 0) throw new Error(unlisted.join('; '));
  });

  app.addHook('onRequest', async (req, reply) => {
    const url = req.routeOptions.url;
    if (req.is404 || url === undefined) {
      if (!req.caller) return unauthenticated(reply);
      if (req.caller.kind === 'project') return reply.code(403).send({ error: 'forbidden' });
      return;
    }
    const access = policyOf(req.method, url);
    const verdict = access ? allows(access, req.caller) : 'forbidden';
    if (verdict === 'ok') return;
    if (verdict === 'unauthenticated') return isPageRequest(req) ? redirectToLogin(req, reply) : unauthenticated(reply);
    return reply.code(403).send({ error: 'forbidden' });
  });
}
