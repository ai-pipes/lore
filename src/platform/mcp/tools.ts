import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  diffVersions,
  findByAnyMetadataKey,
  findRelatedDocs,
  getCategoryStats,
  getDocumentBySlug,
  getLibraryOverview,
  getTopology,
  inferRelatedDocs,
  listDocuments,
  type CatalogDeps,
} from '../../modules/catalog/index.js';
import { searchDocuments, type SearchDeps } from '../../modules/search/index.js';
import { renderPrompt } from '../../modules/llm/index.js';

/** Log the real error server-side (stderr, safe for stdio MCP) and return a generic tool error. */
function toolError(tool: string, err: unknown) {
  console.error(`[mcp] ${tool} failed:`, err);
  return {
    content: [{ type: 'text' as const, text: `${tool} failed due to an internal error. Check the Lore server logs.` }],
    isError: true,
  };
}

/**
 * Wraps a tool handler: anything it throws (a failed query carries its SQL and parameters) becomes
 * the generic tool error, logged server-side. Results the handler returns, including its own
 * user-facing `isError` messages, pass through unchanged.
 */
function guarded<Args extends ZodRawShapeCompat>(tool: string, cb: ToolCallback<Args>): ToolCallback<Args> {
  const run = cb as (...args: unknown[]) => CallToolResult | Promise<CallToolResult>;
  const wrapped = async (...args: unknown[]): Promise<CallToolResult> => {
    try {
      return await run(...args);
    } catch (err) {
      return toolError(tool, err);
    }
  };
  return wrapped as unknown as ToolCallback<Args>;
}

const branchOrVersion = {
  version_id: z.string().optional().describe('Specific version id (defaults to current)'),
  branch: z.string().optional().describe('Git branch name (e.g. feature/new-payment). Overrides current version.'),
};

const DEFAULT_ENDPOINTS_PAGE = 100;
/** The catalog's own cap on one page of documents. */
const MAX_ENDPOINTS_PAGE = 500;

/** search_docs and ask_lore search across libraries: a version or branch only exists within one. */
const libraryBranchOrVersion = {
  version_id: z.string().optional().describe('Specific version id of library_id (defaults to current; needs library_id)'),
  branch: z.string().optional().describe('Git branch name of library_id (e.g. feature/new-payment; needs library_id)'),
};

/** A version or branch without its library would be ignored or applied to the wrong library. */
function versionNeedsLibrary(a: { library_id?: string; version_id?: string; branch?: string }): CallToolResult | null {
  if (a.library_id || (a.version_id === undefined && a.branch === undefined)) return null;
  return {
    content: [{ type: 'text', text: 'branch and version_id need library_id: versions belong to one library' }],
    isError: true,
  };
}

/** The MCP tools over the catalog and search modules of the platform composition. */
export function registerTools(server: McpServer, deps: { catalog: CatalogDeps; search: SearchDeps }): void {
  const { catalog, search } = deps;
  // Every tool is registered through here, so no handler can leak an internal error to the client.
  const tool = <Args extends ZodRawShapeCompat>(name: string, description: string, schema: Args, cb: ToolCallback<Args>) =>
    server.tool(name, description, schema, guarded(name, cb));

  tool(
    'search_docs',
    renderPrompt('mcp/search_docs'),
    {
      query: z.string().describe('Search query (any language)'),
      library_id: z.string().optional().describe('Filter by library slug'),
      ...libraryBranchOrVersion,
    },
    async ({ query, library_id, version_id, branch }) => {
      const invalid = versionNeedsLibrary({ library_id, version_id, branch });
      if (invalid) return invalid;
      const services = library_id ? [{ library_id, version_id, branch }] : [];
      const results = await searchDocuments(search, query, { services });
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  tool(
    'get_document',
    renderPrompt('mcp/get_document'),
    {
      library_id: z.string().describe('Library slug'),
      slug: z.string().describe('Document slug'),
      include_links: z.boolean().optional().describe('Also return linked documents (default: false)'),
      ...branchOrVersion,
    },
    async ({ library_id, slug, include_links, version_id, branch }) => {
      const doc = await getDocumentBySlug(catalog, library_id, slug, { version_id, branch });
      if (!doc) {
        return {
          content: [{ type: 'text', text: `Document not found: ${slug}` }],
          isError: true,
        };
      }
      if (!include_links) {
        return { content: [{ type: 'text', text: doc.content }] };
      }
      const links = await findRelatedDocs(catalog, { library_id, slug, version_id, branch });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ content: doc.content, category: doc.category, links }, null, 2),
        }],
      };
    },
  );

  tool(
    'list_libraries',
    renderPrompt('mcp/list_libraries'),
    {},
    async () => {
      const libs = await catalog.libraries.list();
      return {
        content: [{ type: 'text', text: JSON.stringify(libs, null, 2) }],
      };
    },
  );

  tool(
    'list_endpoints',
    renderPrompt('mcp/list_endpoints'),
    {
      library_id: z.string().describe('Library slug'),
      domain: z.string().optional().describe('Filter by domain'),
      entry_type: z.string().optional().describe('Filter by entry type'),
      category: z.string().optional().describe('Filter by category (e.g. architecture, decision, specification)'),
      limit: z.number().int().min(1).max(MAX_ENDPOINTS_PAGE).optional()
        .describe(`Documents per page (default ${DEFAULT_ENDPOINTS_PAGE}, max ${MAX_ENDPOINTS_PAGE})`),
      offset: z.number().int().min(0).optional().describe('Documents to skip (default 0)'),
      ...branchOrVersion,
    },
    async ({ library_id, domain, entry_type, category, version_id, branch, limit = DEFAULT_ENDPOINTS_PAGE, offset = 0 }) => {
      const filter = { library_id, domain, entry_type, category, version_id, branch };
      const docs = await listDocuments(catalog, { ...filter, limit, offset });
      // A full page may be the last one: look one document further.
      const more = docs.length === limit
        && (await listDocuments(catalog, { ...filter, limit: 1, offset: offset + limit })).length > 0;
      const summary = docs.map((d) => ({
        slug: d.slug,
        domain: d.domain,
        entry_type: d.entry_type,
        category: d.category,
        http_method: d.http_method,
        route: d.route,
        summary: d.summary,
      }));
      const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(summary, null, 2) }];
      if (more) {
        content.push({ type: 'text', text: `More documents exist: call list_endpoints again with offset=${offset + limit}.` });
      }
      return { content };
    },
  );

  tool(
    'get_library_overview',
    renderPrompt('mcp/get_library_overview'),
    {
      library_id: z.string().describe('Library slug'),
      ...branchOrVersion,
    },
    async ({ library_id, version_id, branch }) => {
      const [domains, categories] = await Promise.all([
        getLibraryOverview(catalog, library_id, { version_id, branch }),
        getCategoryStats(catalog, library_id, { version_id, branch }),
      ]);
      return {
        content: [{ type: 'text', text: JSON.stringify({ domains, categories }, null, 2) }],
      };
    },
  );

  tool(
    'find_related_docs',
    renderPrompt('mcp/find_related_docs'),
    {
      library_id: z.string().describe('Library slug'),
      slug: z.string().describe('Document slug'),
      direction: z.enum(['outbound', 'inbound', 'both'])
        .optional()
        .describe('outbound = this doc depends on others, inbound = others depend on this doc (default: both)'),
      include_inferred: z.boolean().optional()
        .describe('Include inferred links from metadata (default: true)'),
      ...branchOrVersion,
    },
    async ({ library_id, slug, direction, include_inferred = true, version_id, branch }) => {
      const [explicit, inferred] = await Promise.all([
        findRelatedDocs(catalog, { library_id, slug, direction, version_id, branch }),
        include_inferred
          ? inferRelatedDocs(catalog, { library_id, slug, direction, version_id, branch })
          : Promise.resolve([]),
      ]);

      // Deduplicate: if an inferred link points to a slug already covered by an explicit link, drop the inferred one
      const explicitKeys = new Set(explicit.map((l) => `${l.direction}:${l.library_id}:${l.slug}`));
      const dedupedInferred = inferred.filter(
        (l) => !explicitKeys.has(`${l.direction}:${l.library_id}:${l.slug}`),
      );

      const all = [...explicit, ...dedupedInferred];

      if (all.length === 0) {
        return { content: [{ type: 'text', text: 'No related documents found.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(all, null, 2) }] };
    },
  );

  tool(
    'find_by_data_source',
    renderPrompt('mcp/find_by_data_source'),
    {
      dal_interface: z.string().optional().describe('DAL interface name, e.g. IOrderDal'),
      table_name: z.string().optional().describe('Database table name'),
      stored_proc: z.string().optional().describe('Stored procedure name'),
      library_id: z.string().optional().describe('Limit to specific library'),
      ...branchOrVersion,
    },
    async ({ dal_interface, table_name, stored_proc, library_id, version_id, branch }) => {
      const keys: Record<string, string> = {};
      if (dal_interface) keys.dal_interface = dal_interface;
      if (table_name) keys.table_name = table_name;
      if (stored_proc) keys.stored_proc = stored_proc;

      if (Object.keys(keys).length === 0) {
        return {
          content: [{ type: 'text', text: 'At least one filter is required' }],
          isError: true,
        };
      }

      const docs = await findByAnyMetadataKey(catalog, keys, library_id, { version_id, branch });
      return {
        content: [{ type: 'text', text: JSON.stringify(docs.map(docSummary), null, 2) }],
      };
    },
  );

  tool(
    'find_by_external_dependency',
    renderPrompt('mcp/find_by_external_dependency'),
    {
      grpc_service: z.string().optional().describe('gRPC service name'),
      message_queue: z.string().optional().describe('Queue or topic name'),
      http_service: z.string().optional().describe('External HTTP service hostname'),
      library_id: z.string().optional().describe('Limit to specific library'),
      ...branchOrVersion,
    },
    async ({ grpc_service, message_queue, http_service, library_id, version_id, branch }) => {
      const keys: Record<string, string> = {};
      if (grpc_service) keys.grpc_service = grpc_service;
      if (message_queue) keys.message_queue = message_queue;
      if (http_service) keys.http_service = http_service;

      if (Object.keys(keys).length === 0) {
        return {
          content: [{ type: 'text', text: 'At least one filter is required' }],
          isError: true,
        };
      }

      const docs = await findByAnyMetadataKey(catalog, keys, library_id, { version_id, branch });
      return {
        content: [{ type: 'text', text: JSON.stringify(docs.map(docSummary), null, 2) }],
      };
    },
  );

  tool(
    'ask_lore',
    renderPrompt('mcp/ask_lore'),
    {
      question: z.string().describe('Natural language question (any language)'),
      library_id: z.string().optional().describe('Limit to specific library'),
      ...libraryBranchOrVersion,
    },
    async ({ question, library_id, version_id, branch }) => {
      const invalid = versionNeedsLibrary({ library_id, version_id, branch });
      if (invalid) return invalid;
      const services = library_id ? [{ library_id, version_id, branch }] : [];
      const results = await searchDocuments(search, question, { services });
      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No documents found.' }] };
      }
      const docs = await Promise.all(
        results.map(async (r) => {
          const doc = await getDocumentBySlug(catalog, r.library_id, r.slug, { version_id, branch });
          if (!doc) return null;
          return { slug: doc.slug, library_id: doc.library_id, domain: doc.domain, entry_type: doc.entry_type, summary: doc.summary, content: doc.content };
        }),
      );
      const found = docs.filter(Boolean);
      if (found.length === 0) return { content: [{ type: 'text', text: 'No documents found.' }] };
      return { content: [{ type: 'text', text: JSON.stringify(found, null, 2) }] };
    },
  );

  tool(
    'get_service_topology',
    renderPrompt('mcp/get_service_topology'),
    {
      library_id: z.string().describe('Library slug'),
      service: z.string().describe('Service domain name (e.g. "payments", "inventory")'),
      version_id: z.string().optional().describe('Specific version id (defaults to current)'),
    },
    async ({ library_id, service, version_id }) => {
      const topology = await getTopology(catalog, library_id, service, version_id);
      return {
        content: [{ type: 'text', text: JSON.stringify(topology, null, 2) }],
      };
    },
  );

  tool(
    'get_document_diff',
    renderPrompt('mcp/get_document_diff'),
    {
      library_id: z.string().describe('Library slug'),
      slug: z.string().describe('Document slug'),
      from_version: z.string().describe('Source version id to compare from'),
      to_version: z.string().optional().describe('Target version id (defaults to current)'),
    },
    async ({ library_id, slug, from_version, to_version }) => {
      let toVersionId = to_version;
      if (!toVersionId) {
        const current = await catalog.versions.current(library_id);
        if (!current) {
          return {
            content: [{ type: 'text', text: `No current version found for library ${library_id}` }],
            isError: true,
          };
        }
        toVersionId = current.id;
      }

      const diff = await diffVersions(catalog, library_id, slug, from_version, toVersionId);
      return {
        content: [{ type: 'text', text: JSON.stringify(diff, null, 2) }],
      };
    },
  );
}

function docSummary(d: {
  slug: string;
  library_id: string;
  domain: string | null;
  entry_type: string | null;
  summary: string | null;
}) {
  return {
    slug: d.slug,
    library_id: d.library_id,
    domain: d.domain,
    entry_type: d.entry_type,
    summary: d.summary,
  };
}
