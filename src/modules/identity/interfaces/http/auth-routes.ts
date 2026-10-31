/** Password sign-in, single sign-on, sign-out, "who am I", the sign-in method and the sign-in page. */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfigResponse, MeResponse, SsoLoginError } from '../../../../contracts/auth.js';
import { completeSsoLogin, startSsoLogin } from '../../application/oidc-login.js';
import type { IdentityDeps } from '../../application/ports.js';
import { logout, passwordLogin } from '../../application/sessions.js';
import { renderAccountPage } from '../web/pages.js';
import {
  clearedSessionCookie,
  clearedSsoBindingCookie,
  deviceCookie,
  deviceFromCookies,
  sessionCookie,
  sessionIdFromCookies,
  ssoBindingCookie,
  ssoBindingFromCookies,
} from './session-cookie.js';

const SSO_ERRORS: ReadonlySet<string> = new Set<SsoLoginError>([
  'invalid_state',
  'not_allowed',
  'disabled',
  'idp_unavailable',
  'rate_limited',
]);

/** Where the browser goes after a failed single sign-on: the login page with a fixed code. */
const loginErrorUrl = (code: string): string => `/login?loginError=${SSO_ERRORS.has(code) ? code : 'internal'}`;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export interface IdentityRouteOptions {
  /** `LORE_COOKIE_SECURE=true`: cookies are always `Secure` (they also are on https requests). */
  cookieSecure: boolean;
}

/** 401 for a request that carries no valid credentials. */
export function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'authentication required' });
}

export function identityRoutes(d: IdentityDeps, opts: IdentityRouteOptions): FastifyPluginAsync {
  const secure = (req: FastifyRequest) => opts.cookieSecure || req.protocol === 'https';
  /** A new sign-in replaces the browser's earlier session: delete it server-side too. */
  const endPreviousSession = async (req: FastifyRequest) => {
    const previous = sessionIdFromCookies(req.headers.cookie);
    if (previous) await logout(d, previous);
  };

  return async (app) => {
    app.get('/login', async (_req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return reply.type('text/html; charset=utf-8').send(renderAccountPage('login', 'Sign in'));
    });

    app.get('/api/auth/config', async (): Promise<AuthConfigResponse> => ({ method: d.sso ? 'sso' : 'password' }));

    // Single sign-on. Every outcome is a redirect: the browser is navigating, not calling an API.
    app.get<{ Querystring: Record<string, unknown> }>('/api/auth/sso/login', async (req, reply) => {
      if (!d.sso) return reply.code(404).send({ error: 'single sign-on is not configured' });
      reply.header('Cache-Control', 'no-store');
      let started;
      try {
        started = await startSsoLogin(d, { returnTo: str(req.query.returnTo) ?? '/', ip: req.ip });
      } catch (e) {
        req.log.error({ err: e }, 'sso login start failed');
        return reply.redirect(loginErrorUrl('internal'), 302);
      }
      if (!started.ok) return reply.redirect(loginErrorUrl(started.error.code), 302);
      reply.header('Set-Cookie', ssoBindingCookie(started.value.state, secure(req)));
      return reply.redirect(started.value.url.toString(), 302);
    });

    app.get<{ Querystring: Record<string, unknown> }>('/api/auth/sso/callback', async (req, reply) => {
      if (!d.sso) return reply.code(404).send({ error: 'single sign-on is not configured' });
      reply.header('Cache-Control', 'no-store');
      // The binding is single-use: cleared whatever the outcome (no renewed session cookie either).
      reply.removeHeader('Set-Cookie');
      const cookies = [clearedSsoBindingCookie(secure(req))];
      const fail = (code: string) => reply.header('Set-Cookie', cookies).redirect(loginErrorUrl(code), 302);
      const state = str(req.query.state);
      const code = str(req.query.code);
      const iss = str(req.query.iss);
      // A cancelled or broken provider answer (`error=…`) carries no usable code or state.
      if (!state || !code || ssoBindingFromCookies(req.headers.cookie) !== state) return fail('invalid_state');
      let r;
      try {
        r = await completeSsoLogin(d, { state, code, ip: req.ip, ...(iss === undefined ? {} : { iss }) });
      } catch (e) {
        req.log.error({ err: e }, 'sso callback failed');
        return fail('internal');
      }
      if (!r.ok) return fail(r.error.code);
      await endPreviousSession(req);
      cookies.push(sessionCookie(r.value.sessionId, secure(req)));
      return reply.header('Set-Cookie', cookies).redirect(r.value.returnTo, 302);
    });

    app.post<{ Body: unknown }>('/api/auth/login', async (req, reply) => {
      const body = req.body as { login?: unknown; password?: unknown } | null | undefined;
      if (typeof body?.login !== 'string' || typeof body.password !== 'string') {
        return reply.code(400).send({ error: 'login and password are required' });
      }
      const r = await passwordLogin(d, {
        login: body.login,
        password: body.password,
        ip: req.ip,
        deviceCookie: deviceFromCookies(req.headers.cookie),
      });
      if (!r.ok) {
        if (r.error.code === 'sso_only') return reply.code(403).send({ error: 'sso_only' });
        if (r.error.code === 'rate_limited') {
          return reply.code(429).header('Retry-After', String(r.error.retryAfterSec ?? 1)).send({ error: 'rate_limited' });
        }
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      await endPreviousSession(req);
      reply.header('Cache-Control', 'no-store');
      reply.removeHeader('Set-Cookie'); // replaces a renewed cookie of an earlier session
      const cookies = [sessionCookie(r.value.sessionId, secure(req))];
      if (r.value.deviceCookie) cookies.push(deviceCookie(r.value.deviceCookie, secure(req)));
      return reply.code(204).header('Set-Cookie', cookies).send();
    });

    app.post('/api/auth/logout', async (req, reply) => {
      const sessionId = sessionIdFromCookies(req.headers.cookie);
      if (sessionId) await logout(d, sessionId);
      reply.removeHeader('Set-Cookie'); // the session ends: no renewed cookie
      return reply.code(204).header('Set-Cookie', clearedSessionCookie(secure(req))).send();
    });

    app.get('/api/auth/me', async (req, reply) => {
      const caller = req.caller;
      if (!caller) return unauthenticated(reply);
      reply.header('Cache-Control', 'no-store');
      const me: MeResponse =
        caller.kind === 'user'
          ? { kind: 'user', login: caller.login, display_name: caller.displayName, role: caller.role }
          : caller.kind === 'project'
            ? { kind: 'project', namespace: caller.namespaceId, key_name: caller.name, library_id: caller.libraryId }
            : { kind: 'admin-key', role: 'admin' };
      return me;
    });
  };
}
