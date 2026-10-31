import type { FastifyInstance } from 'fastify';
import type { CatalogDeps } from '../../application/ports.js';
import { diffVersions } from '../../application/diff.js';
import { getCurrentVersion } from '../../application/versions.js';

export async function diffRoutes(app: FastifyInstance, d: CatalogDeps): Promise<void> {
  // Wildcard route to support multi-segment slugs like "order-service/create-order"
  app.get<{
    Params: { libraryId: string; '*': string };
    Querystring: { from: string; to?: string };
  }>(
    '/api/libraries/:libraryId/diff/*',
    async (request, reply) => {
      const { libraryId } = request.params;
      const slug = (request.params as { '*': string })['*'];
      const { from, to } = request.query;

      if (!from) {
        return reply.code(400).send({ error: 'from query parameter is required' });
      }

      let toVersion = to;
      if (!toVersion) {
        // default to current version
        const current = await getCurrentVersion(d, libraryId);
        if (!current) {
          return reply.code(404).send({ error: `No current version found for library ${libraryId}` });
        }
        toVersion = current.id;
      }

      const diff = await diffVersions(d, libraryId, slug, from, toVersion);
      if (diff.contentDiffError !== null) {
        return reply.code(422).send({ error: diff.contentDiffError });
      }
      return reply.send(diff);
    },
  );
}
