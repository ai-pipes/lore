import { describe, expect, it } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { registerLibrary } from './libraries.js';
import { uploadImage } from './images.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 4]);
import { createVersion, deleteVersion, listVersions, promoteVersion } from './versions.js';

async function withLibrary() {
  const fake = createFakeCatalog();
  await registerLibrary(fake.deps, { id: 'lib', displayName: 'Lib' });
  return fake;
}

describe('versions', () => {
  it('creating a version of an unknown library reports library_not_found', async () => {
    const { deps } = createFakeCatalog();
    expect(await createVersion(deps, 'nope', { id: 'v1' })).toBe('library_not_found');
  });

  it('creates, lists and promotes versions', async () => {
    const { deps } = await withLibrary();
    const v1 = await createVersion(deps, 'lib', { id: 'v1', branch: 'main' });
    expect(v1).toMatchObject({ id: 'v1', library_id: 'lib', branch: 'main', is_current: false });
    await createVersion(deps, 'lib', { id: 'v2' });
    expect(await promoteVersion(deps, 'lib', 'v2')).toBe('ok');
    const list = await listVersions(deps, 'lib');
    expect(list === 'library_not_found' ? [] : list.filter((v) => v.is_current).map((v) => v.id)).toEqual(['v2']);
  });

  it('creating an existing version again is idempotent; another branch moves it, no branch keeps it', async () => {
    const { deps, state } = await withLibrary();
    await createVersion(deps, 'lib', { id: 'v1', branch: 'feat' });
    expect(await createVersion(deps, 'lib', { id: 'v1', branch: 'feat' })).toMatchObject({ id: 'v1', branch: 'feat' });
    expect(await createVersion(deps, 'lib', { id: 'v1', branch: 'main' })).toMatchObject({ id: 'v1', branch: 'main' });
    expect(await createVersion(deps, 'lib', { id: 'v1' })).toMatchObject({ id: 'v1', branch: 'main' });
    await createVersion(deps, 'lib', { id: 'v2' });
    expect(await createVersion(deps, 'lib', { id: 'v2', branch: 'feat' })).toMatchObject({ id: 'v2', branch: 'feat' });
    expect(state.versions.map((v) => [v.id, v.branch])).toEqual([['v2', 'feat'], ['v1', 'main']]);
  });

  it('refuses an invalid version id or branch before writing anything', async () => {
    const { deps, state } = await withLibrary();
    expect(await createVersion(deps, 'lib', { id: '../../x' })).toBe('invalid_version_id');
    expect(await createVersion(deps, 'lib', { id: 'v1', branch: 'a//b' })).toBe('invalid_branch');
    expect(state.versions).toEqual([]);
  });

  it('lists and promotes report library_not_found for an unknown library', async () => {
    const { deps } = createFakeCatalog();
    expect(await listVersions(deps, 'nope')).toBe('library_not_found');
    expect(await promoteVersion(deps, 'nope', 'v1')).toBe('library_not_found');
  });

  it('promoting an unknown version reports version_not_found and keeps the current version', async () => {
    const { deps } = await withLibrary();
    await createVersion(deps, 'lib', { id: 'v1' });
    await promoteVersion(deps, 'lib', 'v1');
    expect(await promoteVersion(deps, 'lib', 'typo')).toBe('version_not_found');
    const list = await listVersions(deps, 'lib');
    expect(list === 'library_not_found' ? [] : list.filter((v) => v.is_current).map((v) => v.id)).toEqual(['v1']);
  });

  it('deletes only non-current versions', async () => {
    const { deps } = await withLibrary();
    await createVersion(deps, 'lib', { id: 'v1' });
    await createVersion(deps, 'lib', { id: 'v2' });
    await promoteVersion(deps, 'lib', 'v2');
    expect(await deleteVersion(deps, 'lib', 'v2')).toBe('is_current');
    expect(await deleteVersion(deps, 'lib', 'v1')).toBe('ok');
    expect(await deleteVersion(deps, 'lib', 'v1')).toBe('not_found');
  });

  it('deleting a version removes its images and the blobs no other image references', async () => {
    const { deps, state } = await withLibrary();
    await createVersion(deps, 'lib', { id: 'v1' });
    await createVersion(deps, 'lib', { id: 'v2' });
    await promoteVersion(deps, 'lib', 'v2');
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'shared.png', data: PNG });
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'only.png', data: PNG2 });
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v2', slug: 'a', filename: 'shared.png', data: PNG });

    expect(await deleteVersion(deps, 'lib', 'v1')).toBe('ok');
    expect(state.images.filter((i) => i.version_id === 'v1')).toEqual([]);
    expect(state.deletedBlobs).toEqual([deps.blobs.path('lib', deps.blobs.hash(PNG2))]);
    expect(state.blobs.has(deps.blobs.path('lib', deps.blobs.hash(PNG)))).toBe(true);
  });

  it('the same image in another library does not keep the blob of this library', async () => {
    const { deps, state } = await withLibrary();
    await registerLibrary(deps, { id: 'other', displayName: 'Other' });
    await createVersion(deps, 'lib', { id: 'v1' });
    await createVersion(deps, 'lib', { id: 'v2' });
    await promoteVersion(deps, 'lib', 'v2');
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    await uploadImage(deps, { libraryId: 'other', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });

    expect(await deleteVersion(deps, 'lib', 'v1')).toBe('ok');
    expect(state.deletedBlobs).toEqual([deps.blobs.path('lib', deps.blobs.hash(PNG))]);
    expect(state.blobs.has(deps.blobs.path('other', deps.blobs.hash(PNG)))).toBe(true);
  });

  it('a blob already missing from storage does not fail the version delete', async () => {
    const { deps, state } = await withLibrary();
    await createVersion(deps, 'lib', { id: 'v1' });
    await createVersion(deps, 'lib', { id: 'v2' });
    await promoteVersion(deps, 'lib', 'v2');
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    state.blobs.clear();
    expect(await deleteVersion(deps, 'lib', 'v1')).toBe('ok');
    expect(state.images).toEqual([]);
  });

  it('a blob the store refuses to address (a legacy id) is skipped; the version still goes', async () => {
    const { deps, state } = await withLibrary();
    await createVersion(deps, 'lib', { id: 'v1' });
    await createVersion(deps, 'lib', { id: 'v2' });
    await promoteVersion(deps, 'lib', 'v2');
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    deps.blobs.path = () => {
      throw new Error('invalid library id');
    };
    expect(await deleteVersion(deps, 'lib', 'v1')).toBe('ok');
    expect(state.images).toEqual([]);
    expect(state.deletedBlobs).toEqual([]);
  });
});
