import type { FastifyInstance } from 'fastify';
import type {
  AssignLibraryRequest,
  CreateNamespaceRequest,
  CreateProjectKeyRequest,
  CreateProjectKeyResponse,
  ProjectKeyResponse,
  RenameNamespaceRequest,
} from '../../../../contracts/namespaces.js';
import { renderAccountPage } from '../../../identity/index.js';
import { assignLibrary, createNamespace, listNamespaces, renameNamespace } from '../../application/namespaces.js';
import { createProjectKey, listProjectKeys, revokeProjectKey } from '../../application/project-keys.js';
import type { CatalogDeps } from '../../application/ports.js';
import type { ProjectKeyRecord } from '../../domain/namespace.js';
import type { CatalogRouteOptions } from './push-guard.js';

const keyResponse = (k: ProjectKeyRecord): ProjectKeyResponse => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  namespace_id: k.namespaceId,
  library_id: k.libraryId,
  created_by: k.createdBy,
  created_at: k.createdAt.toISOString(),
  last_used_at: k.lastUsedAt?.toISOString() ?? null,
  revoked_at: k.revokedAt?.toISOString() ?? null,
});

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Namespaces and project keys (admin). Who may call each route is decided by the platform's route policy. */
export async function namespaceRoutes(app: FastifyInstance, d: CatalogDeps, opts: CatalogRouteOptions): Promise<void> {
  app.get('/admin/namespaces', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(renderAccountPage('namespaces', 'Namespaces & keys'));
  });

  app.get('/api/namespaces', async () => listNamespaces(d));

  app.post<{ Body: Partial<CreateNamespaceRequest> | null }>('/api/namespaces', async (req, reply) => {
    const { id, display_name } = req.body ?? {};
    if (typeof id !== 'string' || !isText(display_name)) return reply.code(400).send({ error: 'id and display_name are required' });
    const r = await createNamespace(d, { id, displayName: display_name });
    if (!r.ok) return reply.code(r.error === 'exists' ? 409 : 400).send({ error: r.error });
    return reply.code(201).send(r.value);
  });

  app.patch<{ Params: { id: string }; Body: Partial<RenameNamespaceRequest> | null }>('/api/namespaces/:id', async (req, reply) => {
    const { display_name } = req.body ?? {};
    if (!isText(display_name)) return reply.code(400).send({ error: 'display_name is required' });
    const r = await renameNamespace(d, req.params.id, display_name);
    if (!r.ok) return reply.code(404).send({ error: r.error });
    return r.value;
  });

  app.put<{ Params: { id: string }; Body: Partial<AssignLibraryRequest> | null }>('/api/libraries/:id/namespace', async (req, reply) => {
    const { namespace_id } = req.body ?? {};
    if (!isText(namespace_id)) return reply.code(400).send({ error: 'namespace_id is required' });
    const r = await assignLibrary(d, req.params.id, namespace_id);
    if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : 400).send({ error: r.error });
    return { id: req.params.id, namespace_id };
  });

  app.get<{ Querystring: { namespace?: string } }>('/api/project-keys', async (req) =>
    (await listProjectKeys(d, req.query.namespace || undefined)).map(keyResponse),
  );

  app.post<{ Body: Partial<CreateProjectKeyRequest> | null }>('/api/project-keys', async (req, reply) => {
    const { namespace_id, name, library_id } = req.body ?? {};
    if (!isText(namespace_id) || !isText(name) || (library_id !== undefined && library_id !== null && !isText(library_id))) {
      return reply.code(400).send({ error: 'namespace_id and name are required' });
    }
    const r = await createProjectKey(d, {
      namespaceId: namespace_id,
      name: name.trim(),
      libraryId: library_id ?? undefined,
      createdBy: opts.userIdOf?.(req) ?? null,
    });
    if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : 400).send({ error: r.error });
    reply.header('Cache-Control', 'no-store');
    const { record, key } = r.value;
    const body: CreateProjectKeyResponse = {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      namespace_id: record.namespaceId,
      library_id: record.libraryId,
      key,
    };
    return reply.code(201).send(body);
  });

  app.delete<{ Params: { id: string } }>('/api/project-keys/:id', async (req, reply) => {
    if (!(await revokeProjectKey(d, req.params.id))) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });
}
