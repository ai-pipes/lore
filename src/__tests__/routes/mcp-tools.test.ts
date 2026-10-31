import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../../platform/mcp/tools.js';
import { buildContainer } from '../../platform/container.js';
import type { CatalogDeps } from '../../modules/catalog/index.js';
import type { SearchDeps } from '../../modules/search/index.js';
import { cleanDb, createTestLibrary, createTestVersion, createTestDocument } from '../helpers.js';

type Deps = { catalog: CatalogDeps; search: SearchDeps };

async function connect(deps: Deps): Promise<Client> {
  const server = new McpServer({ name: 'lore-test', version: '0' });
  registerTools(server, deps);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;
const textOf = (r: ToolResult) => r.content.map((c) => c.text).join('\n');
const slugsOf = (r: ToolResult) => (JSON.parse(r.content[0].text) as { slug: string }[]).map((d) => d.slug);

const leak = () => {
  throw new Error('Failed query: select "secret_column" from "documents" where "id" = $1\nparams: s3cr3t-param');
};

/** Any port call throws an error that carries SQL and parameters, like a failing Drizzle query. */
function throwingDeps(): Deps {
  const deep: object = new Proxy(leak, { get: (_t, prop) => (prop === 'then' ? undefined : deep), apply: leak });
  return { catalog: deep as CatalogDeps, search: deep as SearchDeps };
}

const EVERY_TOOL: [string, Record<string, unknown>][] = [
  ['search_docs', { query: 'payments' }],
  ['get_document', { library_id: 'lib', slug: 'doc' }],
  ['list_libraries', {}],
  ['list_endpoints', { library_id: 'lib' }],
  ['get_library_overview', { library_id: 'lib' }],
  ['find_related_docs', { library_id: 'lib', slug: 'doc' }],
  ['find_by_data_source', { table_name: 'orders' }],
  ['find_by_external_dependency', { grpc_service: 'billing' }],
  ['ask_lore', { question: 'how do payments work?' }],
  ['get_service_topology', { library_id: 'lib', service: 'payments' }],
  ['get_document_diff', { library_id: 'lib', slug: 'doc', from_version: 'v1' }],
];

describe('MCP tools: internal errors', () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(EVERY_TOOL)('%s answers a generic tool error, never the SQL or its parameters', async (name, args) => {
    const client = await connect(throwingDeps());
    const res = await call(client, name, args);
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(`${name} failed due to an internal error. Check the Lore server logs.`);
    // the real error is logged server-side (stderr)
    expect(errorLog).toHaveBeenCalled();
    await client.close();
  });

  it('a real Postgres failure (NUL byte in a parameter) does not leak the query', async () => {
    const client = await connect(buildContainer(process.env, { sso: null }));
    for (const [name, args] of [
      ['get_document', { library_id: 'a\u0000b', slug: 'x' }],
      ['list_endpoints', { library_id: 'a\u0000b' }],
      ['get_library_overview', { library_id: 'a\u0000b' }],
      ['find_by_data_source', { table_name: 'a\u0000b' }],
      ['find_by_external_dependency', { http_service: 'a\u0000b' }],
    ] as const) {
      const res = await call(client, name, args);
      expect(res.isError).toBe(true);
      expect(textOf(res)).not.toMatch(/Failed query|params:|select /i);
    }
    await client.close();
  });
});

describe('MCP tools: branch / version_id need library_id', () => {
  it.each([
    ['search_docs', { query: 'payments', branch: 'feature/x' }],
    ['search_docs', { query: 'payments', version_id: 'v2' }],
    ['ask_lore', { question: 'payments?', branch: 'feature/x' }],
    ['ask_lore', { question: 'payments?', version_id: 'v2' }],
  ] as const)('%s rejects %o without library_id', async (name, args) => {
    const client = await connect(buildContainer(process.env, { sso: null }));
    const res = await call(client, name, args);
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe('branch and version_id need library_id: versions belong to one library');
    await client.close();
  });
});

describe('MCP tools: list_endpoints pages', () => {
  beforeEach(async () => {
    await cleanDb();
    await createTestLibrary('lib');
    await createTestVersion('lib', 'v1');
    for (let i = 0; i < 101; i++) {
      await createTestDocument('lib', 'v1', { slug: `doc-${String(i).padStart(3, '0')}`, domain: 'd' });
    }
  });

  it('says when more documents exist than the default page of 100', async () => {
    const client = await connect(buildContainer(process.env, { sso: null }));
    const res = await call(client, 'list_endpoints', { library_id: 'lib' });
    expect(slugsOf(res)).toHaveLength(100);
    expect(res.content[1]?.text).toBe('More documents exist: call list_endpoints again with offset=100.');
    await client.close();
  });

  it('takes limit and offset, and says nothing more on the last page', async () => {
    const client = await connect(buildContainer(process.env, { sso: null }));
    const first = await call(client, 'list_endpoints', { library_id: 'lib', limit: 2 });
    expect(slugsOf(first)).toEqual(['doc-000', 'doc-001']);
    expect(first.content[1]?.text).toBe('More documents exist: call list_endpoints again with offset=2.');
    const last = await call(client, 'list_endpoints', { library_id: 'lib', limit: 500, offset: 100 });
    expect(slugsOf(last)).toEqual(['doc-100']);
    expect(last.content).toHaveLength(1);
    await client.close();
  });

  it('rejects a limit above 500', async () => {
    const client = await connect(buildContainer(process.env, { sso: null }));
    const res = await call(client, 'list_endpoints', { library_id: 'lib', limit: 501 });
    expect(res.isError).toBe(true);
    await client.close();
  });
});

describe('MCP tools: intentional messages stay', () => {
  beforeEach(async () => {
    await cleanDb();
    await createTestLibrary('lib');
    await createTestVersion('lib', 'v1');
    await createTestDocument('lib', 'v1', { slug: 'doc', content: '# Doc' });
  });

  it('keeps "Document not found" and "At least one filter is required"', async () => {
    const client = await connect(buildContainer(process.env, { sso: null }));
    const missing = await call(client, 'get_document', { library_id: 'lib', slug: 'nope' });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe('Document not found: nope');
    const noFilter = await call(client, 'find_by_data_source', {});
    expect(noFilter.isError).toBe(true);
    expect(textOf(noFilter)).toBe('At least one filter is required');
    const found = await call(client, 'get_document', { library_id: 'lib', slug: 'doc' });
    expect(found.isError).toBeFalsy();
    expect(textOf(found)).toContain('# Doc');
    await client.close();
  });
});
