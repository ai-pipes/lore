import type { FastifyInstance } from 'fastify';
import type { DocumentHashItem } from '../../../../contracts/catalog.js';
import type { LinkInput } from '../../domain/document.js';
import type { CatalogDeps } from '../../application/ports.js';
import {
  deleteDocument,
  ingestBulk,
  ingestDocument,
  listDocuments,
  versionDocumentHashes,
  type DocumentUpload,
} from '../../application/documents.js';

/** A query number: undefined when absent, null when not an integer >= `min`. */
function queryInt(value: string | undefined, min: number): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min ? n : null;
}

export async function documentRoutes(app: FastifyInstance, d: CatalogDeps): Promise<void> {
  app.post<{ Params: { id: string; versionId: string } }>(
    '/api/libraries/:id/versions/:versionId/documents',
    {
      handler: async (request, reply) => {
        const { id: library_id, versionId: version_id } = request.params;

        const fields: Record<string, string> = {};
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            fields[part.fieldname] = part.value as string;
          }
        }

        const { slug, domain, project_name, entry_type, summary, content, ...rest } = fields;
        if (!slug || !content) {
          return reply.code(400).send({ error: 'slug and content are required' });
        }

        const doc = await ingestDocument(d, {
          library_id,
          version_id,
          slug,
          domain,
          project_name,
          entry_type,
          summary,
          content,
          handler_class: rest.handler_class,
          http_method: rest.http_method,
          route: rest.route,
          generated_at: rest.generated_at,
          category: rest.category,
        });

        return reply.code(201).send(doc);
      },
    },
  );

  // Bulk insert: accepts a JSON array of documents and generates embeddings in one batch call.
  app.post<{ Params: { id: string; versionId: string }; Querystring: { noEnrich?: string } }>(
    '/api/libraries/:id/versions/:versionId/documents/bulk',
    {
      bodyLimit: 50 * 1024 * 1024, // 50 MB
      handler: async (request, reply) => {
        const { id: library_id, versionId: version_id } = request.params;
        const items = request.body as Array<Record<string, unknown>>;
        if (!Array.isArray(items) || items.length === 0) {
          return reply.code(400).send({ error: 'Request body must be a non-empty array of documents' });
        }

        const inputs: Omit<DocumentUpload, 'library_id' | 'version_id'>[] = items.map((item) => {
          const slug = item.slug as string | undefined;
          const content = item.content as string | undefined;
          if (!slug || !content) throw Object.assign(new Error('slug and content are required'), { statusCode: 400 });

          let links: LinkInput[] | undefined;
          if (Array.isArray(item.links)) {
            links = (item.links as Array<Record<string, unknown>>)
              .filter((l) => l !== null && typeof l === 'object' && typeof l.slug === 'string' && l.slug)
              .map((l) => ({
                slug: String(l.slug),
                library: l.library ? String(l.library) : undefined,
                type: String(l.type ?? 'references'),
              }));
          }

          return {
            slug,
            content,
            domain: item.domain as string | undefined,
            project_name: item.project_name as string | undefined,
            entry_type: item.entry_type as string | undefined,
            summary: item.summary as string | undefined,
            handler_class: item.handler_class as string | undefined,
            http_method: item.http_method as string | undefined,
            route: item.route as string | undefined,
            generated_at: item.generated_at as string | undefined,
            category: item.category as string | undefined,
            links,
          };
        });

        // Enrichment runs in the background (fire-and-forget): it never blocks the push response.
        const noEnrich = request.query.noEnrich === 'true';
        const { documents } = await ingestBulk(d, library_id, version_id, inputs, { enrich: !noEnrich });

        return reply.code(201).send({ inserted: documents.length });
      },
    },
  );

  app.delete<{ Params: { id: string; versionId: string; slug: string } }>(
    '/api/libraries/:id/versions/:versionId/documents/:slug',
    {
      handler: async (request, reply) => {
        const { id: library_id, versionId: version_id, slug } = request.params;
        const deleted = await deleteDocument(d, library_id, version_id, slug);
        if (!deleted) return reply.code(404).send({ error: 'Document not found' });
        return reply.code(200).send({ deleted: slug });
      },
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { domain?: string; entry_type?: string; version?: string; branch?: string; limit?: string; offset?: string };
  }>('/api/libraries/:id/documents', async (request, reply) => {
    // The page size is clamped by listDocuments; a malformed limit or offset is the caller's error.
    const limit = queryInt(request.query.limit, 1);
    const offset = queryInt(request.query.offset, 0);
    if (limit === null) return reply.code(400).send({ error: 'limit must be a positive integer' });
    if (offset === null) return reply.code(400).send({ error: 'offset must be a non-negative integer' });
    return listDocuments(d, {
      library_id: request.params.id,
      domain: request.query.domain,
      entry_type: request.query.entry_type,
      version_id: request.query.version,
      branch: request.query.branch,
      limit,
      offset,
    });
  });

  // Every (slug, content_hash) of one version, unpaginated: `lore push` diffs against it.
  app.get<{ Params: { id: string; versionId: string } }>(
    '/api/libraries/:id/versions/:versionId/document-hashes',
    async (request): Promise<DocumentHashItem[]> => versionDocumentHashes(d, request.params.id, request.params.versionId),
  );
}
