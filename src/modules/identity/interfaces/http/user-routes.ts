/** Users administration: the Users page and its API. Every route is `admin` in the route policy. */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { UserSummary } from '../../../../contracts/users.js';
import type { IdentityDeps } from '../../application/ports.js';
import { unlockLogin } from '../../application/sessions.js';
import { createUser, listUsers, resetPassword, updateUser } from '../../application/users.js';
import { isInteractiveAdmin, type IdentityError, type Role, type User } from '../../domain/user.js';
import { IDENTITY_ERROR_STATUS } from './error-status.js';
import { renderAccountPage } from '../web/pages.js';

function summary(u: User): UserSummary {
  return {
    id: u.id,
    login: u.login,
    display_name: u.displayName,
    role: u.role,
    disabled: u.disabled,
    sso: u.oidcSub !== null,
    created_at: u.createdAt.toISOString(),
    last_login_at: u.lastLoginAt?.toISOString() ?? null,
  };
}


function fail(reply: FastifyReply, e: IdentityError): FastifyReply {
  if (e.code === 'rate_limited') reply.header('Retry-After', String(e.retryAfterSec ?? 1));
  return reply.code(IDENTITY_ERROR_STATUS[e.code]).send({ error: e.message, code: e.code });
}

const badRequest = (reply: FastifyReply, message: string) =>
  reply.code(400).send({ error: message, code: 'invalid_input' });

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b !== null && typeof b === 'object' ? (b as Body) : {});
const optionalString = (v: unknown) => v === undefined || typeof v === 'string';

export function userRoutes(d: IdentityDeps): FastifyPluginAsync {
  return async (app) => {
    app.get('/admin/users', async (_req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return reply.type('text/html; charset=utf-8').send(renderAccountPage('users', 'Users'));
    });

    app.get('/api/users', async (_req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return (await listUsers(d)).map(summary);
    });

    app.post<{ Body: unknown }>('/api/users', async (req, reply) => {
      const b = bodyOf(req.body);
      if (typeof b.login !== 'string' || typeof b.password !== 'string' || typeof b.role !== 'string' || !optionalString(b.display_name)) {
        return badRequest(reply, 'login, password and role are required strings');
      }
      const r = await createUser(d, {
        login: b.login,
        displayName: (b.display_name as string | undefined) ?? '',
        password: b.password,
        role: b.role as Role,
      });
      if (!r.ok) return fail(reply, r.error);
      return reply.code(201).send(summary(r.value));
    });

    app.patch<{ Params: { id: string }; Body: unknown }>('/api/users/:id', async (req, reply) => {
      const b = bodyOf(req.body);
      const caller = req.caller;
      // Like creating users: a role change needs an admin web session or the admin key, not an sk_ token.
      if (b.role !== undefined && !(caller && caller.kind !== 'project' && isInteractiveAdmin(caller))) {
        return reply.code(403).send({ error: 'changing a role needs a signed-in admin (web session) or the admin key', code: 'forbidden' });
      }
      const actorId = caller?.kind === 'user' ? caller.userId : null;
      const r = await updateUser(d, actorId, req.params.id, {
        ...(b.display_name !== undefined ? { displayName: b.display_name as string } : {}),
        ...(b.role !== undefined ? { role: b.role as Role } : {}),
        ...(b.disabled !== undefined ? { disabled: b.disabled as boolean } : {}),
      });
      if (!r.ok) return fail(reply, r.error);
      return summary(r.value);
    });

    // Lifts the password sign-in lock of the user's login (after too many failed attempts).
    app.post<{ Params: { id: string } }>('/api/users/:id/unlock', async (req, reply) => {
      const r = await unlockLogin(d, req.params.id);
      if (!r.ok) return fail(reply, r.error);
      return reply.code(204).send();
    });

    app.post<{ Params: { id: string }; Body: unknown }>('/api/users/:id/password', async (req, reply) => {
      const b = bodyOf(req.body);
      if (typeof b.password !== 'string') return badRequest(reply, 'password is required');
      if (!optionalString(b.current_password)) return badRequest(reply, 'current_password must be a string');
      const caller = req.caller;
      const actorId = caller?.kind === 'user' ? caller.userId : null;
      const r = await resetPassword(d, actorId, req.params.id, b.password, b.current_password as string | undefined);
      if (!r.ok) return fail(reply, r.error);
      return reply.code(204).send();
    });
  };
}
