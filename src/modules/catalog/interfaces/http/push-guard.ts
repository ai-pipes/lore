/**
 * The library-level half of push authorization. The platform's route policy decides who may use a
 * push route at all; this guard decides, per library, using the push policy:
 *
 * - reads (`GET`) under `/api/libraries/:id…`: a project key sees only libraries of its namespace
 *   (403 for another namespace, 404 for a library that does not exist yet);
 * - writes: `decidePush` against the library's namespace, looked up on every request (nothing is
 *   cached, so moving the library or revoking the key takes effect at once).
 *
 * `POST /api/libraries` decides in its handler (it may create the library).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CatalogDeps } from '../../application/ports.js';
import { decidePush, type PushActor } from '../../domain/push-policy.js';

export interface CatalogRouteOptions {
  /** The pushing side of the request's caller. */
  pushActorOf(req: FastifyRequest): PushActor;
  /** The user id of the request's caller, recorded as a project key's creator; null for the admin key. */
  userIdOf?(req: FastifyRequest): string | null;
}

/** Routes the guard checks: everything under one library, except the admin's namespace assignment. */
function guardedLibraryId(req: FastifyRequest): string | undefined {
  const url = req.routeOptions.url;
  if (url === undefined || !url.startsWith('/api/libraries/:id') || url === '/api/libraries/:id/namespace') return undefined;
  return (req.params as { id?: string }).id;
}

export function pushGuard(d: CatalogDeps, opts: CatalogRouteOptions) {
  return async function guard(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    const libraryId = guardedLibraryId(req);
    if (libraryId === undefined) return undefined;
    const actor = opts.pushActorOf(req);
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (actor.kind !== 'project') return undefined;
      // A project key reads only libraries it may push; it learns nothing beyond "not found".
      const library = await d.libraries.get(libraryId);
      if (!library) return reply.code(404).send({ error: 'Library not found' });
      if (library.namespace_id === actor.namespaceId && (actor.libraryId === null || actor.libraryId === libraryId)) return undefined;
      return reply.code(403).send({ error: 'forbidden' });
    }
    const library = await d.libraries.get(libraryId);
    if (!library) {
      // Libraries are created only by `POST /api/libraries`; others reach the handler's own 404.
      return actor.kind === 'project' ? reply.code(404).send({ error: 'Library not found' }) : undefined;
    }
    const decision = decidePush(actor, { libraryId, namespaceId: library.namespace_id }, undefined, d.reservedLibraryIds);
    if (!decision.ok) return reply.code(decision.status).send({ error: decision.error });
    return undefined;
  };
}
