import { describe, expect, it } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { diffVersions } from './diff.js';

async function setup() {
  const fake = createFakeCatalog();
  await fake.deps.libraries.upsert('lib', 'Lib');
  await fake.deps.versions.create('v1', 'lib');
  await fake.deps.versions.create('v2', 'lib');
  return fake;
}

describe('diffVersions', () => {
  it('returns an empty content diff and no changes for identical documents', async () => {
    const { deps } = await setup();
    for (const v of ['v1', 'v2']) await deps.documents.insert({ library_id: 'lib', version_id: v, slug: 's', content: 'same' });
    const diff = await diffVersions(deps, 'lib', 's', 'v1', 'v2');
    expect(diff).toEqual({
      slug: 's', libraryId: 'lib', fromVersion: 'v1', toVersion: 'v2', contentDiff: '', contentDiffError: null,
      metadataChanges: [], linkChanges: { added: [], removed: [] }, fromExists: true, toExists: true,
    });
  });

  it('reports a unified content diff, metadata changes and added/removed links', async () => {
    const { deps } = await setup();
    await deps.documents.insert({
      library_id: 'lib', version_id: 'v1', slug: 's', content: '# Old', domain: 'orders', summary: 'a',
      links: [{ slug: 'gone', type: 'references' }, { slug: 'kept', type: 'calls' }],
    });
    await deps.documents.insert({
      library_id: 'lib', version_id: 'v2', slug: 's', content: '# New', domain: 'orders', summary: 'b', category: 'api',
      links: [{ slug: 'kept', type: 'calls' }, { slug: 'new', library: 'other', type: 'references' }],
    });
    const diff = await diffVersions(deps, 'lib', 's', 'v1', 'v2');
    expect(diff.contentDiff).toContain('-# Old');
    expect(diff.contentDiff).toContain('+# New');
    expect(diff.contentDiff).toContain('v1');
    expect(diff.metadataChanges).toEqual([
      { field: 'summary', from: 'a', to: 'b' },
      { field: 'category', from: null, to: 'api' },
    ]);
    expect(diff.linkChanges.added).toEqual([{ toSlug: 'new', toLibraryId: 'other', linkType: 'references', source: 'manual' }]);
    expect(diff.linkChanges.removed).toEqual([{ toSlug: 'gone', toLibraryId: null, linkType: 'references', source: 'manual' }]);
  });

  it('handles a document that exists in only one version', async () => {
    const { deps } = await setup();
    await deps.documents.insert({ library_id: 'lib', version_id: 'v2', slug: 's', content: 'added', links: [{ slug: 'x', type: 'references' }] });
    const diff = await diffVersions(deps, 'lib', 's', 'v1', 'v2');
    expect(diff.fromExists).toBe(false);
    expect(diff.toExists).toBe(true);
    expect(diff.contentDiff).toContain('+added');
    expect(diff.linkChanges.added).toHaveLength(1);
    const none = await diffVersions(deps, 'lib', 'missing', 'v1', 'v2');
    expect(none).toMatchObject({ fromExists: false, toExists: false, contentDiff: '', metadataChanges: [] });
  });

  it('gives up quickly on a pathologically large edit and says the diff is too large', async () => {
    const { deps } = await setup();
    const lines = (prefix: string) => Array.from({ length: 8000 }, (_, i) => `${prefix} line ${i}`).join('\n');
    await deps.documents.insert({ library_id: 'lib', version_id: 'v1', slug: 's', content: lines('old'), summary: 'a' });
    await deps.documents.insert({ library_id: 'lib', version_id: 'v2', slug: 's', content: lines('new'), summary: 'b' });
    const started = Date.now();
    const diff = await diffVersions(deps, 'lib', 's', 'v1', 'v2');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(diff.contentDiff).toBe('');
    expect(diff.contentDiffError).toMatch(/too large/i);
    expect(diff.metadataChanges).toEqual([{ field: 'summary', from: 'a', to: 'b' }]);
  });

  it('refuses to diff documents above the size cap without running the diff', async () => {
    const { deps } = await setup();
    const big = 'x'.repeat(3_000_000);
    await deps.documents.insert({ library_id: 'lib', version_id: 'v1', slug: 's', content: big });
    await deps.documents.insert({ library_id: 'lib', version_id: 'v2', slug: 's', content: big + 'y' });
    const started = Date.now();
    const diff = await diffVersions(deps, 'lib', 's', 'v1', 'v2');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(diff.contentDiff).toBe('');
    expect(diff.contentDiffError).toMatch(/too large/i);
  });

  it('keeps contentDiffError null for an ordinary diff', async () => {
    const { deps } = await setup();
    await deps.documents.insert({ library_id: 'lib', version_id: 'v1', slug: 's', content: 'a\nb' });
    await deps.documents.insert({ library_id: 'lib', version_id: 'v2', slug: 's', content: 'a\nc' });
    const diff = await diffVersions(deps, 'lib', 's', 'v1', 'v2');
    expect(diff.contentDiffError).toBeNull();
    expect(diff.contentDiff).toContain('+c');
  });
});
