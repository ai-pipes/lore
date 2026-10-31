/** Personal `sk_` tokens: the Tokens page and its API. */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { CreateTokenResponse, TokenSummary } from '../../../../contracts/tokens.js';
import type { ApiTokenRecord, IdentityDeps } from '../../application/ports.js';
import { createToken, listTokens, mcpAddCommand, revokeToken } from '../../application/tokens.js';
import { IdentityError } from '../../domain/user.js';
import { renderAccountPage } from '../web/pages.js';
import { unauthenticated } from './auth-routes.js';

export interface TokenRouteOptions {
  /** The MCP endpoint clients connect to, for the `claude mcp add` command. */
  mcpUrl: string;
}

function summary(r: ApiTokenRecord): TokenSummary {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    created_at: r.createdAt.toISOString(),
    last_used_at: r.lastUsedAt?.toISOString() ?? null,
    revoked_at: r.revokedAt?.toISOString() ?? null,
    expires_at: r.expiresAt?.toISOString() ?? null,
  };
}

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

/**
 * `GET /tokens` and `GET|POST /api/tokens`, `DELETE /api/tokens/:id` need a web session (the route
 * policy says `session`), so a leaked token cannot mint more. `DELETE /api/tokens/current` revokes
 * the token the request is made with (for `lore logout`).
 */
export function tokenRoutes(d: IdentityDeps, opts: TokenRouteOptions): FastifyPluginAsync {
  return async (app) => {
    app.get('/tokens', async (_req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return reply.type('text/html; charset=utf-8').send(renderAccountPage('tokens', 'Tokens'));
    });

    app.get('/api/tokens', async (req, reply) => {
      const caller = req.caller;
      if (caller?.kind !== 'user') return unauthenticated(reply);
      reply.header('Cache-Control', 'no-store');
      return (await listTokens(d, caller.userId)).map(summary);
    });

    app.post<{ Body: unknown }>('/api/tokens', async (req, reply) => {
      const caller = req.caller;
      if (caller?.kind !== 'user') return unauthenticated(reply);
      const name = (req.body as { name?: unknown } | null | undefined)?.name;
      if (typeof name !== 'string') return reply.code(400).send({ error: 'name is required' });
      try {
        const { token, record } = await createToken(d, caller.userId, name);
        const body: CreateTokenResponse = { ...summary(record), token, mcp_command: mcpAddCommand(opts.mcpUrl, token) };
        return reply.code(201).header('Cache-Control', 'no-store').send(body);
      } catch (e) {
        if (e instanceof IdentityError && e.code === 'invalid_input') return reply.code(400).send({ error: e.message });
        throw e;
      }
    });

    // Registered before `/:id`, though Fastify prefers the static segment anyway.
    app.delete('/api/tokens/current', async (req, reply) => {
      const caller = req.caller;
      if (caller?.kind !== 'user' || caller.via !== 'token' || caller.tokenId === undefined) {
        return reply.code(400).send({ error: 'the request is not made with a personal token' });
      }
      if (!(await revokeToken(d, caller.userId, caller.tokenId))) return notFound(reply);
      return reply.code(204).send();
    });

    app.delete<{ Params: { id: string } }>('/api/tokens/:id', async (req, reply) => {
      const caller = req.caller;
      if (caller?.kind !== 'user') return unauthenticated(reply);
      if (!(await revokeToken(d, caller.userId, req.params.id))) return notFound(reply);
      return reply.code(204).send();
    });
  };
}
