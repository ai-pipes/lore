import type { FastifyInstance } from 'fastify';
import type { CatalogDeps } from '../../application/ports.js';
import { getLibrary } from '../../application/libraries.js';
import { createVersion, deleteVersion, listVersions, promoteVersion } from '../../application/versions.js';
import { cloneVersion } from '../../application/documents.js';

export async function versionRoutes(app: FastifyInstance, d: CatalogDeps): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/libraries/:id/versions', async (request, reply) => {
    const versions = await listVersions(d, request.params.id);
    if (versions === 'library_not_found') return reply.code(404).send({ error: 'Library not found' });
    return versions;
  });

  app.post<{ Params: { id: string } }>('/api/libraries/:id/versions', {
    handler: async (request, reply) => {
      const library_id = request.params.id;
      if (!(await getLibrary(d, library_id))) {
        return reply.code(404).send({ error: 'Library not found' });
      }
      const body = (request.body ?? {}) as { id?: unknown; branch?: unknown };
      const { id } = body;
      const branch = body.branch ?? undefined;
      if (typeof id !== 'string' || id === '') return reply.code(400).send({ error: 'version id is required and must be a string' });
      if (branch !== undefined && typeof branch !== 'string') return reply.code(400).send({ error: 'branch must be a string' });
      const version = await createVersion(d, library_id, { id, branch });
      if (version === 'library_not_found') return reply.code(404).send({ error: 'Library not found' });
      if (version === 'invalid_version_id') {
        return reply.code(400).send({
          error: 'invalid version id: use up to 128 letters, digits, ".", "_", "+" and "-", starting with a letter or digit, without ".."',
        });
      }
      if (version === 'invalid_branch') {
        return reply.code(400).send({
          error: 'invalid branch: use up to 255 characters of "/"-separated segments of letters, digits, ".", "_", "-", "+", "@" and "#" (no empty segment, no "..", no segment starting with ".")',
        });
      }
      return reply.code(201).send(version);
    },
  });

  app.post<{ Params: { id: string; versionId: string; sourceVersionId: string } }>(
    '/api/libraries/:id/versions/:versionId/clone-from/:sourceVersionId',
    {
      handler: async (request, reply) => {
        const { id: library_id, versionId, sourceVersionId } = request.params;
        const result = await cloneVersion(d, library_id, versionId, sourceVersionId);
        if (result === 'library_not_found') {
          return reply.code(404).send({ error: 'Library not found' });
        }
        return reply.code(200).send(result);
      },
    },
  );

  app.delete<{ Params: { id: string; versionId: string } }>(
    '/api/libraries/:id/versions/:versionId',
    {
      handler: async (request, reply) => {
        const { id: library_id, versionId } = request.params;
        const result = await deleteVersion(d, library_id, versionId);
        if (result === 'not_found') return reply.code(404).send({ error: 'Version not found' });
        if (result === 'is_current') return reply.code(409).send({ error: 'Cannot delete the current version. Promote another version first.' });
        return reply.code(200).send({ deleted: versionId });
      },
    },
  );

  app.post<{ Params: { id: string; versionId: string } }>(
    '/api/libraries/:id/versions/:versionId/promote',
    {
      handler: async (request, reply) => {
        const { id: library_id, versionId } = request.params;
        const result = await promoteVersion(d, library_id, versionId);
        if (result === 'library_not_found') return reply.code(404).send({ error: 'Library not found' });
        if (result === 'version_not_found') return reply.code(404).send({ error: 'Version not found' });
        return reply.code(200).send({ promoted: versionId });
      },
    },
  );
}
