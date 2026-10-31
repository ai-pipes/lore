import type { FastifyInstance } from 'fastify';
import type { CatalogDeps } from '../../application/ports.js';
import { getTopology } from '../../application/topology.js';

export async function topologyRoutes(app: FastifyInstance, d: CatalogDeps): Promise<void> {
  app.get<{
    Params: { libraryId: string; service: string };
    Querystring: { version?: string };
  }>(
    '/api/libraries/:libraryId/topology/:service',
    async (request, reply) => {
      const { libraryId, service } = request.params;
      const { version } = request.query;
      try {
        const topology = await getTopology(d, libraryId, service, version);
        return reply.send(topology);
      } catch (err) {
        request.log.error({ err, libraryId, service }, 'topology lookup failed');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}
