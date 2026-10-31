import { describe, it, expect, beforeEach } from 'vitest';
import { insertDocument } from '../../modules/catalog/infrastructure/pg-documents.js';
import { findRelatedDocs, inferRelatedDocs } from '../../modules/catalog/infrastructure/pg-relationships.js';
import { linksFrom } from '../../modules/catalog/infrastructure/pg-document-search.js';
import { createVersion } from '../../modules/catalog/infrastructure/pg-versions.js';
import type { SearchResult } from '../../modules/catalog/domain/document.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
  await createTestVersion();
});

describe('findRelatedDocs', () => {
  it('returns outbound links with resolved metadata', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/handler', content: 'A',
      links: [{ slug: 'b/service', type: 'calls' }],
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'b/service', content: 'B',
      summary: 'Service B',
    });

    const links = await findRelatedDocs({ library_id: 'test-lib', slug: 'a/handler', direction: 'outbound' });
    expect(links).toHaveLength(1);
    expect(links[0].slug).toBe('b/service');
    expect(links[0].link_type).toBe('calls');
    expect(links[0].direction).toBe('outbound');
    expect(links[0].summary).toBe('Service B');
  });

  it('returns inbound links', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/handler', content: 'A',
      links: [{ slug: 'b/service', type: 'depends_on' }],
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'b/service', content: 'B',
    });

    const links = await findRelatedDocs({ library_id: 'test-lib', slug: 'b/service', direction: 'inbound' });
    expect(links).toHaveLength(1);
    expect(links[0].slug).toBe('a/handler');
    expect(links[0].link_type).toBe('depends_on');
    expect(links[0].direction).toBe('inbound');
  });

  it('returns both directions by default', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/src', content: 'A',
      links: [{ slug: 'b/target', type: 'calls' }],
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'b/target', content: 'B',
      links: [{ slug: 'a/src', type: 'related_to' }],
    });

    const links = await findRelatedDocs({ library_id: 'test-lib', slug: 'a/src' });
    expect(links.some((l) => l.direction === 'outbound')).toBe(true);
    expect(links.some((l) => l.direction === 'inbound')).toBe(true);
  });

  it('filters by link_type', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/src', content: 'A',
      links: [
        { slug: 'b/target', type: 'calls' },
        { slug: 'c/other', type: 'references' },
      ],
    });

    const links = await findRelatedDocs({ library_id: 'test-lib', slug: 'a/src', link_type: 'calls', direction: 'outbound' });
    expect(links).toHaveLength(1);
    expect(links[0].link_type).toBe('calls');
    expect(links[0].slug).toBe('b/target');
  });

  it('returns empty array for document with no links', async () => {
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'lone/doc', content: 'X' });
    const links = await findRelatedDocs({ library_id: 'test-lib', slug: 'lone/doc' });
    expect(links).toHaveLength(0);
  });

  it('returns empty array for non-existent document', async () => {
    const links = await findRelatedDocs({ library_id: 'test-lib', slug: 'no/such' });
    expect(links).toHaveLength(0);
  });

  it('replaces links on re-upsert', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/doc', content: 'v1',
      links: [{ slug: 'x/old', type: 'references' }],
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/doc', content: 'v2',
      links: [{ slug: 'y/new', type: 'calls' }],
    });

    const links = await findRelatedDocs({ library_id: 'test-lib', slug: 'a/doc', direction: 'outbound' });
    expect(links).toHaveLength(1);
    expect(links[0].slug).toBe('y/new');
    expect(links[0].link_type).toBe('calls');
  });

  it('removes manual links when links field is undefined (missing means none, as in the content hash)', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/doc', content: 'v1',
      links: [{ slug: 'x/dep', type: 'depends_on' }],
    });
    // Re-insert without links field: the stored links must match what the content hash says
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/doc', content: 'v2',
    });

    const links = await findRelatedDocs({ library_id: 'test-lib', slug: 'a/doc', direction: 'outbound' });
    expect(links).toHaveLength(0);
  });
});

function hit(library_id: string, slug: string): SearchResult {
  return { slug, library_id, domain: null, entry_type: null, http_method: null, route: null, summary: null, score: 1 };
}

describe('linksFrom version scope', () => {
  beforeEach(async () => {
    // v1 is current; fb is the head of branch `feat`.
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'a/src', content: 'A', links: [{ slug: 'dep', type: 'calls' }] });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'dep', content: 'D', summary: 'CURRENT' });
    await createVersion('fb', 'test-lib', 'feat');
    await insertDocument({
      library_id: 'test-lib', version_id: 'fb', slug: 'a/src', content: 'A2',
      links: [{ slug: 'dep', type: 'calls' }, { slug: 'dep-new', type: 'calls' }],
    });
    await insertDocument({ library_id: 'test-lib', version_id: 'fb', slug: 'dep', content: 'D2', summary: 'BRANCH' });
    await insertDocument({ library_id: 'test-lib', version_id: 'fb', slug: 'dep-new', content: 'N', summary: 'BRANCH NEW' });
  });

  it('follows links of the current versions by default', async () => {
    const linked = await linksFrom([hit('test-lib', 'a/src')]);
    expect(linked.map((l) => [l.slug, l.summary])).toEqual([['dep', 'CURRENT']]);
  });

  it('follows links in the version of the search scope', async () => {
    const linked = await linksFrom([hit('test-lib', 'a/src')], { scopes: [{ library_id: 'test-lib', branch: 'feat' }] });
    expect(linked.map((l) => [l.slug, l.summary]).sort()).toEqual([['dep', 'BRANCH'], ['dep-new', 'BRANCH NEW']]);
    const pinned = await linksFrom([hit('test-lib', 'a/src')], { scopes: [{ library_id: 'test-lib', version_id: 'v1' }] });
    expect(pinned.map((l) => [l.slug, l.summary])).toEqual([['dep', 'CURRENT']]);
  });
});

// A link without a target library points into the library of its source document.
describe('links without a target library', () => {
  beforeEach(async () => {
    await createTestLibrary('lib-b', 'Lib B');
    await createTestVersion('lib-b', 'v1');
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/src', content: 'A',
      links: [{ slug: 'shared', type: 'calls' }],
    });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'shared', content: 'S', summary: 'test-lib shared' });
    await insertDocument({ library_id: 'lib-b', version_id: 'v1', slug: 'b/first', content: 'B' });
    await insertDocument({ library_id: 'lib-b', version_id: 'v1', slug: 'shared', content: 'S', summary: 'lib-b shared' });
  });

  it('link expansion resolves them in the source document library, not the first hit library', async () => {
    const linked = await linksFrom([hit('lib-b', 'b/first'), hit('test-lib', 'a/src')]);
    expect(linked.map((l) => [l.library_id, l.slug, l.from_slug])).toEqual([['test-lib', 'shared', 'a/src']]);
  });

  it('inbound relationships ignore them when the source document is in another library', async () => {
    expect(await findRelatedDocs({ library_id: 'lib-b', slug: 'shared', direction: 'inbound' })).toEqual([]);
    const own = await findRelatedDocs({ library_id: 'test-lib', slug: 'shared', direction: 'inbound' });
    expect(own.map((l) => [l.library_id, l.slug])).toEqual([['test-lib', 'a/src']]);
  });
});

describe('findRelatedDocs version scope', () => {
  beforeEach(async () => {
    // v1 is current; fb is the head of branch `feat`. On the branch, a/src also
    // links to dep-new, and gone exists only in the current version.
    await createTestLibrary('lib-b', 'Lib B');
    await createTestVersion('lib-b', 'v1');
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'a/src', content: 'A',
      links: [{ slug: 'dep', type: 'calls' }, { slug: 'gone', type: 'calls' }, { slug: 'ext', type: 'calls', library: 'lib-b' }],
    });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'dep', content: 'D', summary: 'CURRENT' });
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'gone', content: 'G', summary: 'CURRENT GONE' });
    await createVersion('fb', 'test-lib', 'feat');
    await insertDocument({
      library_id: 'test-lib', version_id: 'fb', slug: 'a/src', content: 'A2',
      links: [
        { slug: 'dep', type: 'calls' },
        { slug: 'gone', type: 'calls' },
        { slug: 'dep-new', type: 'calls' },
        { slug: 'ext', type: 'calls', library: 'lib-b' },
      ],
    });
    await insertDocument({ library_id: 'test-lib', version_id: 'fb', slug: 'dep', content: 'D2', summary: 'BRANCH' });
    await insertDocument({ library_id: 'test-lib', version_id: 'fb', slug: 'dep-new', content: 'N', summary: 'BRANCH NEW' });
    // lib-b: current v1 and a `feat` branch head of its own.
    await insertDocument({ library_id: 'lib-b', version_id: 'v1', slug: 'ext', content: 'E', summary: 'B CURRENT' });
    await insertDocument({
      library_id: 'lib-b', version_id: 'v1', slug: 'b/caller', content: 'C',
      links: [{ slug: 'dep', type: 'uses', library: 'test-lib' }],
    });
    await createVersion('bfb', 'lib-b', 'feat');
    await insertDocument({ library_id: 'lib-b', version_id: 'bfb', slug: 'ext', content: 'E2', summary: 'B BRANCH' });
  });

  const outbound = async (filter: { branch?: string; version_id?: string }) =>
    (await findRelatedDocs({ library_id: 'test-lib', slug: 'a/src', direction: 'outbound', ...filter }))
      .map((l) => [l.library_id, l.slug, l.summary])
      .sort();

  it('reads outbound targets in the current version by default', async () => {
    expect(await outbound({})).toEqual([
      ['lib-b', 'ext', 'B CURRENT'],
      ['test-lib', 'dep', 'CURRENT'],
      ['test-lib', 'gone', 'CURRENT GONE'],
    ]);
  });

  it('reads outbound targets in the requested branch; other libraries in their current version', async () => {
    expect(await outbound({ branch: 'feat' })).toEqual([
      ['lib-b', 'ext', 'B CURRENT'],
      ['test-lib', 'dep', 'BRANCH'],
      ['test-lib', 'dep-new', 'BRANCH NEW'],
      ['test-lib', 'gone', null],
    ]);
  });

  it('reads outbound targets in the pinned version', async () => {
    expect(await outbound({ version_id: 'fb' })).toEqual([
      ['lib-b', 'ext', 'B CURRENT'],
      ['test-lib', 'dep', 'BRANCH'],
      ['test-lib', 'dep-new', 'BRANCH NEW'],
      ['test-lib', 'gone', null],
    ]);
  });

  it('reads inbound sources of other libraries in their current version', async () => {
    const inbound = async (filter: { branch?: string; version_id?: string }) =>
      (await findRelatedDocs({ library_id: 'test-lib', slug: 'dep', direction: 'inbound', ...filter }))
        .map((l) => [l.library_id, l.slug])
        .sort();
    expect(await inbound({})).toEqual([['lib-b', 'b/caller'], ['test-lib', 'a/src']]);
    expect(await inbound({ branch: 'feat' })).toEqual([['lib-b', 'b/caller'], ['test-lib', 'a/src']]);
    expect(await inbound({ version_id: 'fb' })).toEqual([['lib-b', 'b/caller'], ['test-lib', 'a/src']]);
  });
});

describe('inferRelatedDocs inbound', () => {
  beforeEach(async () => {
    await createTestLibrary('api-gateway', 'API Gateway');
    await createTestVersion('api-gateway', 'v1');
    await insertDocument({ library_id: 'api-gateway', version_id: 'v1', slug: 'routes', content: 'R' });
    await insertDocument({ library_id: 'api-gateway', version_id: 'v1', slug: 'pay', content: 'P', handler_class: 'Pay_Handler' });
    const caller = async (lib: string, slug: string, key: 'grpc_service' | 'http_service' | 'message_queue', value: string) => {
      await createTestLibrary(lib, lib);
      await createTestVersion(lib, 'v1');
      await insertDocument({ library_id: lib, version_id: 'v1', slug, content: slug, metadata: [{ key, value }] });
    };
    await caller('lib-host', 'uses-gateway', 'http_service', 'api-gateway.internal');
    await caller('lib-grpc', 'uses-gateway-grpc', 'grpc_service', 'grpc-api-gateway:443');
    await caller('lib-rapid', 'rapid', 'grpc_service', 'rapid-api');
    await caller('lib-apiq', 'api-queue', 'message_queue', 'api.events');
    await caller('lib-payx', 'payx', 'http_service', 'payx-service');
    await caller('lib-pay', 'pay-caller', 'message_queue', 'pay_.requests');
  });

  const inbound = async (slug: string) =>
    (await inferRelatedDocs({ library_id: 'api-gateway', slug, direction: 'inbound' })).map((l) => l.slug).sort();

  it('matches the whole library id, not its first dash-separated part', async () => {
    expect(await inbound('routes')).toEqual(['uses-gateway', 'uses-gateway-grpc']);
  });

  it('treats LIKE wildcards in a handler name literally', async () => {
    expect(await inbound('pay')).toEqual(['pay-caller', 'uses-gateway', 'uses-gateway-grpc']);
  });
});
