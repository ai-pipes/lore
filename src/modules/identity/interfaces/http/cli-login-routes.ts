/** CLI device login: start and poll (the CLI, public), the approval page and its API (web sessions). */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type {
  DecideDeviceLoginRequest,
  DescribeDeviceLoginResponse,
  PollDeviceLoginRequest,
  StartDeviceLoginRequest,
} from '../../../../contracts/cli-login.js';
import {
  decideDeviceLogin,
  describeDeviceLogin,
  pollDeviceLogin,
  startDeviceLogin,
} from '../../application/device-login.js';
import type { IdentityDeps } from '../../application/ports.js';
import type { IdentityError } from '../../domain/user.js';
import { IDENTITY_ERROR_STATUS } from './error-status.js';
import { renderCliLoginPage } from '../web/pages.js';

export interface CliLoginRouteOptions {
  /** `PUBLIC_URL`: where people open the approval page; the request's origin when unset. */
  publicUrl?: string;
}


function sendError(reply: FastifyReply, e: IdentityError): FastifyReply {
  if (e.code === 'rate_limited') {
    return reply.code(429).header('Retry-After', String(e.retryAfterSec ?? 1)).send({ error: 'rate_limited' });
  }
  return reply.code(IDENTITY_ERROR_STATUS[e.code]).send({ error: e.code, message: e.message });
}

const origin = (req: FastifyRequest) => `${req.protocol}://${req.host}`;

export function cliLoginRoutes(d: IdentityDeps, opts: CliLoginRouteOptions = {}): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: unknown }>('/api/cli/login/start', async (req, reply) => {
      const body = req.body as Partial<StartDeviceLoginRequest> | null | undefined;
      if (typeof body?.hostname !== 'string') return reply.code(400).send({ error: 'hostname is required' });
      const r = await startDeviceLogin(d, { hostname: body.hostname, ip: req.ip, baseUrl: opts.publicUrl || origin(req) });
      if (!r.ok) return sendError(reply, r.error);
      reply.header('Cache-Control', 'no-store');
      return r.value;
    });

    app.post<{ Body: unknown }>('/api/cli/login/poll', async (req, reply) => {
      const body = req.body as Partial<PollDeviceLoginRequest> | null | undefined;
      if (typeof body?.device_code !== 'string') return reply.code(400).send({ error: 'device_code is required' });
      reply.header('Cache-Control', 'no-store');
      return pollDeviceLogin(d, body.device_code);
    });

    app.get<{ Params: { userCode: string } }>('/api/cli/login/:userCode', async (req, reply) => {
      const r = await describeDeviceLogin(d, req.params.userCode);
      if (!r.ok) return sendError(reply, r.error);
      reply.header('Cache-Control', 'no-store');
      const body: DescribeDeviceLoginResponse = r.value;
      return body;
    });

    app.post<{ Body: unknown }>('/api/cli/login/approve', async (req, reply) => {
      const body = req.body as Partial<DecideDeviceLoginRequest> | null | undefined;
      if (typeof body?.user_code !== 'string' || typeof body.approve !== 'boolean') {
        return reply.code(400).send({ error: 'user_code and approve (boolean) are required' });
      }
      // The policy admits web sessions only, so the caller is always a user here.
      const caller = req.caller;
      if (caller?.kind !== 'user') return reply.code(403).send({ error: 'forbidden' });
      const r = await decideDeviceLogin(d, caller.userId, body.user_code, body.approve);
      if (!r.ok) return sendError(reply, r.error);
      return reply.code(204).send();
    });

    // Always the blank code form: any `?code=` in a link is ignored.
    app.get('/cli/login', async (_req, reply) => {
      reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8');
      return reply.send(renderCliLoginPage());
    });
  };
}
