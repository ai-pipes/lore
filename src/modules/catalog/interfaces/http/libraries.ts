import type { FastifyInstance } from 'fastify';
import type { CatalogDeps } from '../../application/ports.js';
import { getLibrary, listLibraries, pushLibrary } from '../../application/libraries.js';
import type { CatalogRouteOptions } from './push-guard.js';

/** Libraries. Who may call each route is decided by the platform's route policy and the push guard. */
export async function libraryRoutes(app: FastifyInstance, d: CatalogDeps, opts: CatalogRouteOptions): Promise<void> {
  app.post('/api/libraries', async (request, reply) => {
    const { id, display_name, namespace_id } = (request.body ?? {}) as { id?: unknown; display_name?: unknown; namespace_id?: unknown };
    if (!id || !display_name) {
      return reply.code(400).send({ error: 'id and display_name are required' });
    }
    if (typeof id !== 'string' || typeof display_name !== 'string') {
      return reply.code(400).send({ error: 'id and display_name must be strings' });
    }
    if (namespace_id !== undefined && typeof namespace_id !== 'string') {
      return reply.code(400).send({ error: 'namespace_id must be a string' });
    }
    // Re-registering an existing library (e.g. on every `lore push`) only updates its name.
    const r = await pushLibrary(d, opts.pushActorOf(request), { id, displayName: display_name, namespaceId: namespace_id });
    if (!r.ok) return reply.code(r.error.status).send({ error: r.error.error });
    return reply.code(r.value.created ? 201 : 200).send(r.value.library);
  });

  // A project key lists only the libraries it may push (its namespace, or its one library).
  app.get('/api/libraries', async (request) => {
    const actor = opts.pushActorOf(request);
    if (actor.kind !== 'project') return listLibraries(d);
    const libraries = await listLibraries(d, actor.namespaceId);
    return actor.libraryId === null ? libraries : libraries.filter((l) => l.id === actor.libraryId);
  });

  app.get<{ Params: { id: string } }>('/api/libraries/:id', async (request, reply) => {
    const library = await getLibrary(d, request.params.id);
    if (!library) return reply.code(404).send({ error: 'Library not found' });
    return library;
  });
}
