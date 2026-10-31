import type { FastifyInstance } from 'fastify';
import type { CatalogDeps } from '../../application/ports.js';
import { listServices } from '../../application/search.js';

/** The services (domains) documented in a library, or in all libraries. */
export async function serviceRoutes(app: FastifyInstance, d: CatalogDeps): Promise<void> {
  app.get<{ Querystring: { library_id?: string; branch?: string } }>('/api/services', async (req, reply) => {
    const { library_id, branch } = req.query;
    return reply.send(await listServices(d, library_id, { branch }));
  });
}
