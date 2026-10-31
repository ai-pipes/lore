import { describe, expect, it } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import {
  embedQuery,
  findByAnyMetadataKey,
  getCategoryStats,
  getLibraryOverview,
  linksFrom,
  listServices,
  searchFullText,
  searchVectors,
} from './search.js';

describe('embedQuery', () => {
  it('returns null without an embedding provider and the vector otherwise', async () => {
    const { deps, state } = createFakeCatalog();
    expect(await embedQuery(deps, 'q')).toBeNull();
    state.embedding = { vector: [1, 0] };
    expect(await embedQuery(deps, 'q')).toEqual([1, 0]);
  });
});

describe('search queries', () => {
  it('delegate to the search port with the same arguments', async () => {
    const { deps, state } = createFakeCatalog();
    const opts = { query: 'refund', library_id: 'lib', limit: 5 };
    await searchFullText(deps, opts);
    await searchVectors(deps, [1], { library_id: 'lib' }, 20, 0.2);
    await findByAnyMetadataKey(deps, { table_name: 'orders' }, 'lib', { branch: 'main' });
    await getLibraryOverview(deps, 'lib', {});
    await getCategoryStats(deps, 'lib');
    await listServices(deps, undefined, { version_id: 'v1' });
    await linksFrom(deps, [], { maxLinked: 3 });
    expect(state.searchCalls).toEqual([
      { method: 'fullText', args: [opts] },
      { method: 'vector', args: [[1], { library_id: 'lib' }, 20, 0.2] },
      { method: 'byMetadata', args: [{ table_name: 'orders' }, 'lib', { branch: 'main' }] },
      { method: 'overview', args: ['lib', {}] },
      { method: 'categories', args: ['lib', {}] },
      { method: 'services', args: [undefined, { version_id: 'v1' }] },
      { method: 'linksFrom', args: [[], { maxLinked: 3 }] },
    ]);
  });
});
