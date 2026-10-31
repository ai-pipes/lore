import { describe, it, expect, beforeEach } from 'vitest';
import {
  upsertDocumentImage,
  getDocumentImages,
  getDocumentImage,
  deleteDocumentImage,
  cloneVersionImages,
  isImageHashReferenced,
  releaseImageBlob,
} from '../../modules/catalog/infrastructure/pg-images.js';
import { findLibraryCaseVariant } from '../../modules/catalog/infrastructure/pg-libraries.js';
import { sql } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import { cleanDb, createTestLibrary, createTestVersion } from '../helpers.js';

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
  await createTestVersion('test-lib', 'v1');
});

describe('upsertDocumentImage', () => {
  it('inserts a new image record', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'screenshot.png', 1024, 'abc123');
    const images = await getDocumentImages('test-lib', 'v1', 'billing/invoice');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('screenshot.png');
    expect(images[0].image_hash).toBe('abc123');
    expect(images[0].file_size).toBe(1024);
    expect(images[0].mime_type).toBe('image/png');
  });

  it('updates hash and size on conflict', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'screenshot.png', 1024, 'oldhash');
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'screenshot.png', 2048, 'newhash');
    const images = await getDocumentImages('test-lib', 'v1', 'billing/invoice');
    expect(images).toHaveLength(1);
    expect(images[0].image_hash).toBe('newhash');
    expect(images[0].file_size).toBe(2048);
  });

  it('stores multiple images for same slug', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'step-1.png', 100, 'hash1');
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'step-2.png', 200, 'hash2');
    const images = await getDocumentImages('test-lib', 'v1', 'billing/invoice');
    expect(images).toHaveLength(2);
    expect(images.map((i) => i.filename).sort()).toEqual(['step-1.png', 'step-2.png']);
  });
});

describe('getDocumentImage', () => {
  it('returns hash and mime_type for existing image', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'api/orders', 'overview.png', 512, 'deadbeef', 'image/png');
    const img = await getDocumentImage('test-lib', 'v1', 'api/orders', 'overview.png');
    expect(img).toBeDefined();
    expect(img!.image_hash).toBe('deadbeef');
    expect(img!.mime_type).toBe('image/png');
  });

  it('returns undefined for non-existent image', async () => {
    const img = await getDocumentImage('test-lib', 'v1', 'no/slug', 'missing.png');
    expect(img).toBeUndefined();
  });
});

describe('deleteDocumentImage', () => {
  it('removes the record', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'screenshot.png', 100, 'aaa');
    await deleteDocumentImage('test-lib', 'v1', 'billing/invoice', 'screenshot.png');
    const images = await getDocumentImages('test-lib', 'v1', 'billing/invoice');
    expect(images).toHaveLength(0);
  });

  it('deletes only the specified file, not others', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'step-1.png', 100, 'h1');
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'step-2.png', 200, 'h2');
    await deleteDocumentImage('test-lib', 'v1', 'billing/invoice', 'step-1.png');
    const images = await getDocumentImages('test-lib', 'v1', 'billing/invoice');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('step-2.png');
  });
});

describe('cloneVersionImages', () => {
  beforeEach(async () => {
    await createTestVersion('test-lib', 'v2');
  });

  it('copies all image records to the new version', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'step-1.png', 100, 'hash1');
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'step-2.png', 200, 'hash2');
    await upsertDocumentImage('test-lib', 'v1', 'api/orders', 'overview.png', 300, 'hash3');

    const count = await cloneVersionImages('test-lib', 'v1', 'v2');
    expect(count).toBe(3);

    const v2Invoice = await getDocumentImages('test-lib', 'v2', 'billing/invoice');
    expect(v2Invoice).toHaveLength(2);
    expect(v2Invoice.map((i) => i.filename).sort()).toEqual(['step-1.png', 'step-2.png']);

    // hashes are preserved — same files referenced
    expect(v2Invoice.find((i) => i.filename === 'step-1.png')!.image_hash).toBe('hash1');
  });

  it('original version records are not affected', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'screenshot.png', 100, 'hashX');
    await cloneVersionImages('test-lib', 'v1', 'v2');

    const v1Images = await getDocumentImages('test-lib', 'v1', 'billing/invoice');
    expect(v1Images).toHaveLength(1);
    expect(v1Images[0].image_hash).toBe('hashX');
  });

  it('returns 0 when source version has no images', async () => {
    const count = await cloneVersionImages('test-lib', 'v1', 'v2');
    expect(count).toBe(0);
  });

  it('clone is idempotent (onConflictDoNothing)', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'screenshot.png', 100, 'hashA');
    await cloneVersionImages('test-lib', 'v1', 'v2');
    await cloneVersionImages('test-lib', 'v1', 'v2'); // second clone — no error
    const v2Images = await getDocumentImages('test-lib', 'v2', 'billing/invoice');
    expect(v2Images).toHaveLength(1);
  });

  it('updated image in new version does not affect source version', async () => {
    await upsertDocumentImage('test-lib', 'v1', 'billing/invoice', 'screenshot.png', 100, 'hashV1');
    await cloneVersionImages('test-lib', 'v1', 'v2');

    // Simulate updated image in v2
    await upsertDocumentImage('test-lib', 'v2', 'billing/invoice', 'screenshot.png', 200, 'hashV2');

    const v1Images = await getDocumentImages('test-lib', 'v1', 'billing/invoice');
    const v2Images = await getDocumentImages('test-lib', 'v2', 'billing/invoice');
    expect(v1Images[0].image_hash).toBe('hashV1');
    expect(v2Images[0].image_hash).toBe('hashV2');
  });
});

describe('one image file per (library, hash): an upload and a release are serialized', () => {
  it('a release waits for an upload of the same hash in progress and then keeps the file it recorded', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    let storing!: () => void;
    const started = new Promise<void>((r) => (storing = r));
    const upload = upsertDocumentImage('test-lib', 'v1', 'doc', 'b.png', 1, 'h1', 'image/png', async () => {
      storing();
      await gate;
    });
    await started;
    let deleted = false;
    const release = releaseImageBlob('test-lib', 'h1', async () => {
      deleted = true;
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(deleted).toBe(false);
    open();
    await upload;
    expect(await release).toBe(false);
    expect(deleted).toBe(false);
    expect((await getDocumentImage('test-lib', 'v1', 'doc', 'b.png'))?.image_hash).toBe('h1');
  });

  it('releases the file only when no record of the library (or a case variant of its id) references it', async () => {
    let deletes = 0;
    const del = async () => {
      deletes++;
    };
    await upsertDocumentImage('test-lib', 'v1', 'doc', 'a.png', 1, 'h1');
    expect(await releaseImageBlob('test-lib', 'h1', del)).toBe(false);
    expect(await releaseImageBlob('test-lib', 'h2', del)).toBe(true);
    expect(deletes).toBe(1);
  });
});

describe('isImageHashReferenced', () => {
  it('counts records of a library whose id differs only by case (one directory on case-insensitive disks)', async () => {
    await getDb().execute(sql`INSERT INTO libraries (id, display_name) VALUES ('Test-Lib', 'Legacy')`);
    await getDb().execute(sql`INSERT INTO versions (id, library_id) VALUES ('v1', 'Test-Lib')`);
    await upsertDocumentImage('Test-Lib', 'v1', 'doc', 'a.png', 1, 'h1');
    expect(await isImageHashReferenced('test-lib', 'h1')).toBe(true);
    expect(await isImageHashReferenced('test-lib', 'h2')).toBe(false);
    expect(await isImageHashReferenced('other-lib', 'h1')).toBe(false);
  });

  it('folds ASCII letters only, whatever the database collation', async () => {
    await getDb().execute(sql`INSERT INTO libraries (id, display_name) VALUES ('Ünï-Lib', 'Legacy')`);
    await getDb().execute(sql`INSERT INTO versions (id, library_id) VALUES ('v1', 'Ünï-Lib')`);
    await upsertDocumentImage('Ünï-Lib', 'v1', 'doc', 'a.png', 1, 'h1');
    expect(await isImageHashReferenced('Ünï-lib', 'h1')).toBe(true);
    expect(await isImageHashReferenced('ünï-lib', 'h1')).toBe(false);
    expect(await findLibraryCaseVariant('Ünï-lib')).toBe('Ünï-Lib');
    expect(await findLibraryCaseVariant('ünï-lib')).toBeUndefined();
  });
});
