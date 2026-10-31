import { describe, expect, it } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { deleteImage, findImage, listImages, uploadImage } from './images.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

async function setup() {
  const fake = createFakeCatalog();
  await fake.deps.libraries.upsert('lib', 'Lib');
  return fake;
}

describe('uploadImage', () => {
  it('stores the blob by hash and records the detected type', async () => {
    const { deps, state } = await setup();
    const r = await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a/b', filename: 'x.png', data: PNG });
    expect(r).toEqual({ filename: 'x.png', url: '/api/libraries/lib/versions/v1/images/a/b/x.png' });
    const hash = deps.blobs.hash(PNG);
    expect(state.blobs.has(deps.blobs.path('lib', hash))).toBe(true);
    expect(state.images).toEqual([
      { library_id: 'lib', version_id: 'v1', slug: 'a/b', filename: 'x.png', file_size: PNG.length, image_hash: hash, mime_type: 'image/png' },
    ]);
  });

  it('rejects unsupported types before checking the library', async () => {
    const { deps } = await setup();
    const svg = new TextEncoder().encode('<svg/>');
    expect(await uploadImage(deps, { libraryId: 'nope', versionId: 'v1', slug: 'a', filename: 'x.svg', data: svg })).toBe('unsupported_type');
    expect(await uploadImage(deps, { libraryId: 'nope', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG })).toBe('library_not_found');
  });
});

describe('uploadImage and the filename extension', () => {
  it('refuses a filename whose extension does not match the detected type, and stores nothing', async () => {
    const { deps, state } = await setup();
    expect(await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.html', data: PNG })).toBe('extension_mismatch');
    expect(await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.jpg', data: PNG })).toBe('extension_mismatch');
    expect(state.images).toEqual([]);
    expect(state.blobs.size).toBe(0);
  });
});

describe('findImage / listImages', () => {
  it('resolves the blob path and type, or null', async () => {
    const { deps } = await setup();
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    expect(await findImage(deps, 'lib', 'v1', 'a', 'x.png')).toEqual({
      path: deps.blobs.path('lib', deps.blobs.hash(PNG)), mimeType: 'image/png',
    });
    expect(await findImage(deps, 'lib', 'v1', 'a', 'missing.png')).toBeNull();
    expect((await listImages(deps, 'lib', 'v1', 'a')).map((i) => i.filename)).toEqual(['x.png']);
  });
});

describe('deleteImage', () => {
  it('deletes the file only when no other record references the hash', async () => {
    const { deps, state } = await setup();
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v2', slug: 'a', filename: 'x.png', data: PNG });
    await deleteImage(deps, 'lib', 'v1', 'a', 'x.png');
    expect(state.deletedBlobs).toEqual([]);
    await deleteImage(deps, 'lib', 'v2', 'a', 'x.png');
    expect(state.deletedBlobs).toEqual([deps.blobs.path('lib', deps.blobs.hash(PNG))]);
    expect(state.images).toEqual([]);
  });

  it('a record of the same image in another library does not keep the file of this library', async () => {
    const { deps, state } = await setup();
    await deps.libraries.upsert('other', 'Other');
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    await uploadImage(deps, { libraryId: 'other', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    await deleteImage(deps, 'lib', 'v1', 'a', 'x.png');
    expect(state.deletedBlobs).toEqual([deps.blobs.path('lib', deps.blobs.hash(PNG))]);
    expect(state.blobs.has(deps.blobs.path('other', deps.blobs.hash(PNG)))).toBe(true);
  });

  it('a record of a library whose id differs only by case keeps the file (one directory on case-insensitive disks)', async () => {
    const { deps, state } = await setup();
    await deps.libraries.upsert('Lib', 'Legacy');
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    await uploadImage(deps, { libraryId: 'Lib', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    await deleteImage(deps, 'lib', 'v1', 'a', 'x.png');
    expect(state.deletedBlobs).toEqual([]);
  });

  it('ignores a missing record and a file that is already gone', async () => {
    const { deps, state } = await setup();
    await expect(deleteImage(deps, 'lib', 'v1', 'a', 'none.png')).resolves.toBeUndefined();
    await uploadImage(deps, { libraryId: 'lib', versionId: 'v1', slug: 'a', filename: 'x.png', data: PNG });
    state.blobs.clear();
    await expect(deleteImage(deps, 'lib', 'v1', 'a', 'x.png')).resolves.toBeUndefined();
  });
});

describe('legacy records whose library id or hash the blob store refuses', () => {
  async function legacySetup() {
    const fake = await setup();
    fake.state.images.push({
      library_id: 'Legacy/Lib', version_id: 'v1', slug: 'a', filename: 'x.png', file_size: PNG.length,
      image_hash: fake.deps.blobs.hash(PNG), mime_type: 'image/png',
    });
    const path = fake.deps.blobs.path;
    fake.deps.blobs.path = (libraryId, imageHash) => {
      if (libraryId === 'Legacy/Lib') throw new Error(`invalid library id "${libraryId}"`);
      return path(libraryId, imageHash);
    };
    return fake;
  }

  it('findImage reports the image as not available instead of throwing', async () => {
    const { deps } = await legacySetup();
    expect(await findImage(deps, 'Legacy/Lib', 'v1', 'a', 'x.png')).toBeNull();
  });

  it('uploadImage answers invalid_library_id instead of throwing, and records nothing', async () => {
    const { deps, state } = await legacySetup();
    await deps.libraries.upsert('Legacy/Lib', 'Legacy');
    const before = state.images.length;
    expect(await uploadImage(deps, { libraryId: 'Legacy/Lib', versionId: 'v1', slug: 'a', filename: 'y.png', data: PNG })).toBe('invalid_library_id');
    expect(state.images).toHaveLength(before);
    expect(state.blobs.size).toBe(0);
  });

  it('deleteImage removes the record and leaves storage alone', async () => {
    const { deps, state } = await legacySetup();
    await expect(deleteImage(deps, 'Legacy/Lib', 'v1', 'a', 'x.png')).resolves.toBeUndefined();
    expect(state.images).toEqual([]);
    expect(state.deletedBlobs).toEqual([]);
  });
});
