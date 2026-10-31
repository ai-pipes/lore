import { describe, expect, it } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { getTopology } from './topology.js';

async function setup() {
  const fake = createFakeCatalog();
  const { deps } = fake;
  await deps.libraries.upsert('lib', 'Lib');
  await deps.versions.create('v1', 'lib');
  await deps.versions.create('v2', 'lib');
  await deps.versions.promote('lib', 'v2');
  for (const v of ['v1', 'v2']) {
    await deps.documents.insert({ library_id: 'lib', version_id: v, slug: 'orders/a', content: 'a', domain: 'orders', links: [{ slug: 'shared/c', type: 'calls' }] });
    await deps.documents.insert({ library_id: 'lib', version_id: v, slug: 'shared/c', content: 'c', domain: 'shared' });
  }
  await deps.documents.insert({ library_id: 'lib', version_id: 'v2', slug: 'orders/b', content: 'b', project_name: 'orders' });
  return fake;
}

describe('getTopology', () => {
  it('uses the current version by default and includes 1-hop linked documents', async () => {
    const { deps } = await setup();
    const t = await getTopology(deps, 'lib', 'orders');
    expect(t.versionId).toBe('v2');
    expect(t.documents.map((d) => d.slug)).toEqual(['orders/a', 'orders/b', 'shared/c']);
    expect(t.links).toEqual([{ fromSlug: 'orders/a', toSlug: 'shared/c', linkType: 'calls', source: 'manual', confidence: null }]);
  });

  it('uses an explicit version', async () => {
    const { deps } = await setup();
    const t = await getTopology(deps, 'lib', 'orders', 'v1');
    expect(t.versionId).toBe('v1');
    expect(t.documents.map((d) => d.slug)).toEqual(['orders/a', 'shared/c']);
  });

  it('returns an empty graph for an unknown service', async () => {
    const { deps } = await setup();
    expect(await getTopology(deps, 'lib', 'nope')).toEqual({ service: 'nope', libraryId: 'lib', versionId: 'v2', documents: [], links: [] });
  });

  it('throws when the library has no current version', async () => {
    const { deps } = await setup();
    await expect(getTopology(deps, 'unknown', 'orders')).rejects.toThrow('No current version for library unknown');
  });
});
