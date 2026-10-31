import { describe, it, expect, beforeEach } from 'vitest';
import { createPgCatalog, diffVersions } from '../../modules/catalog/index.js';

import { createLanguageModel } from '../../modules/llm/index.js';

const llm = createLanguageModel({});
const catalog = createPgCatalog({ llm });
const diffDocument = (libraryId: string, slug: string, from: string, to: string) =>
  diffVersions(catalog, libraryId, slug, from, to);
import { insertDocument } from '../../modules/catalog/infrastructure/pg-documents.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';


beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
  await createTestVersion('test-lib', 'v1');
  await createTestVersion('test-lib', 'v2');
});

describe('diffDocument', () => {
  it('returns empty contentDiff when content is identical', async () => {
    const content = '# Hello\n\nSame content.';
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'api/foo', content });
    await insertDocument({ library_id: 'test-lib', version_id: 'v2', slug: 'api/foo', content });

    const result = await diffDocument('test-lib', 'api/foo', 'v1', 'v2');

    expect(result.contentDiff).toBe('');
    expect(result.fromExists).toBe(true);
    expect(result.toExists).toBe(true);
  });

  it('returns a unified diff when content differs', async () => {
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'api/bar', content: '# Old\n\nOld content.' });
    await insertDocument({ library_id: 'test-lib', version_id: 'v2', slug: 'api/bar', content: '# New\n\nNew content.' });

    const result = await diffDocument('test-lib', 'api/bar', 'v1', 'v2');

    expect(result.contentDiff).not.toBe('');
    expect(result.contentDiff).toContain('-# Old');
    expect(result.contentDiff).toContain('+# New');
  });

  it('detects metadata changes correctly', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'api/meta',
      content: 'content',
      domain: 'payments',
      summary: 'old summary',
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v2', slug: 'api/meta',
      content: 'content',
      domain: 'billing',
      summary: 'new summary',
    });

    const result = await diffDocument('test-lib', 'api/meta', 'v1', 'v2');

    expect(result.metadataChanges).toHaveLength(2);

    const domainChange = result.metadataChanges.find(c => c.field === 'domain');
    expect(domainChange).toBeDefined();
    expect(domainChange?.from).toBe('payments');
    expect(domainChange?.to).toBe('billing');

    const summaryChange = result.metadataChanges.find(c => c.field === 'summary');
    expect(summaryChange).toBeDefined();
    expect(summaryChange?.from).toBe('old summary');
    expect(summaryChange?.to).toBe('new summary');
  });

  it('returns empty metadataChanges when metadata is unchanged', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'api/stable',
      content: 'v1 content',
      domain: 'auth',
      summary: 'same summary',
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v2', slug: 'api/stable',
      content: 'v2 content',
      domain: 'auth',
      summary: 'same summary',
    });

    const result = await diffDocument('test-lib', 'api/stable', 'v1', 'v2');

    expect(result.metadataChanges).toHaveLength(0);
  });

  it('detects added links', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'api/links',
      content: 'content',
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v2', slug: 'api/links',
      content: 'content',
      links: [{ slug: 'other/service', type: 'calls' }],
    });

    const result = await diffDocument('test-lib', 'api/links', 'v1', 'v2');

    expect(result.linkChanges.added).toHaveLength(1);
    expect(result.linkChanges.added[0].toSlug).toBe('other/service');
    expect(result.linkChanges.added[0].linkType).toBe('calls');
    expect(result.linkChanges.removed).toHaveLength(0);
  });

  it('detects removed links', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'api/removed',
      content: 'content',
      links: [{ slug: 'dep/service', type: 'depends_on' }],
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v2', slug: 'api/removed',
      content: 'content',
      links: [],
    });

    const result = await diffDocument('test-lib', 'api/removed', 'v1', 'v2');

    expect(result.linkChanges.removed).toHaveLength(1);
    expect(result.linkChanges.removed[0].toSlug).toBe('dep/service');
    expect(result.linkChanges.removed[0].linkType).toBe('depends_on');
    expect(result.linkChanges.added).toHaveLength(0);
  });

  it('returns fromExists: false when document did not exist in from-version', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v2', slug: 'api/new-doc',
      content: 'brand new content',
    });

    const result = await diffDocument('test-lib', 'api/new-doc', 'v1', 'v2');

    expect(result.fromExists).toBe(false);
    expect(result.toExists).toBe(true);
  });

  it('returns toExists: false when document was deleted in to-version', async () => {
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'api/deleted-doc',
      content: 'content that was removed',
    });

    const result = await diffDocument('test-lib', 'api/deleted-doc', 'v1', 'v2');

    expect(result.fromExists).toBe(true);
    expect(result.toExists).toBe(false);
  });

  it('cross-library links with same slug and type do not collide in diff key', async () => {
    // Both versions have a link to 'shared/util' with type 'calls',
    // but from different libraries. Without to_library_id in the key they would
    // cancel out and appear as no change; with it they must be detected as a swap.
    await insertDocument({
      library_id: 'test-lib', version_id: 'v1', slug: 'api/cross',
      content: 'content',
      links: [{ slug: 'shared/util', library: 'lib-a', type: 'calls' }],
    });
    await insertDocument({
      library_id: 'test-lib', version_id: 'v2', slug: 'api/cross',
      content: 'content',
      links: [{ slug: 'shared/util', library: 'lib-b', type: 'calls' }],
    });

    const result = await diffDocument('test-lib', 'api/cross', 'v1', 'v2');

    // The link changed its target library — must surface as added + removed (not zero changes)
    expect(result.linkChanges.added).toHaveLength(1);
    expect(result.linkChanges.added[0].toLibraryId).toBe('lib-b');
    expect(result.linkChanges.removed).toHaveLength(1);
    expect(result.linkChanges.removed[0].toLibraryId).toBe('lib-a');
  });

  it('returns correct slug, libraryId, fromVersion, toVersion in result', async () => {
    await insertDocument({ library_id: 'test-lib', version_id: 'v1', slug: 'api/meta-check', content: 'c' });
    await insertDocument({ library_id: 'test-lib', version_id: 'v2', slug: 'api/meta-check', content: 'c' });

    const result = await diffDocument('test-lib', 'api/meta-check', 'v1', 'v2');

    expect(result.slug).toBe('api/meta-check');
    expect(result.libraryId).toBe('test-lib');
    expect(result.fromVersion).toBe('v1');
    expect(result.toVersion).toBe('v2');
  });
});
