import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import {
  createVersion,
  promoteVersion,
  listVersions,
  deleteVersion,
  getCurrentVersion,
} from '../../modules/catalog/infrastructure/pg-versions.js';
import { upsertDocumentImage, getDocumentImages } from '../../modules/catalog/infrastructure/pg-images.js';
import { cleanDb, createTestLibrary, createTestDocument } from '../helpers.js';

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
});

describe('createVersion', () => {
  it('creates a version with branch', async () => {
    const v = await createVersion('abc123', 'test-lib', 'main');
    expect(v.id).toBe('abc123');
    expect(v.library_id).toBe('test-lib');
    expect(v.branch).toBe('main');
    expect(v.is_current).toBe(false);
  });

  it('is idempotent on duplicate (id, library_id)', async () => {
    await createVersion('v1', 'test-lib');
    const v2 = await createVersion('v1', 'test-lib');
    expect(v2.id).toBe('v1');
    const versions = await listVersions('test-lib');
    expect(versions).toHaveLength(1);
  });
});

describe('promoteVersion', () => {
  it('sets is_current and unsets previous', async () => {
    await createVersion('v1', 'test-lib');
    await createVersion('v2', 'test-lib');
    await promoteVersion('test-lib', 'v1');
    await promoteVersion('test-lib', 'v2');

    const current = await getCurrentVersion('test-lib');
    expect(current?.id).toBe('v2');

    const all = await listVersions('test-lib');
    const v1 = all.find((v) => v.id === 'v1');
    expect(v1?.is_current).toBe(false);
  });
});

describe('promoteVersion of a missing version', () => {
  it('returns false and leaves the current version current', async () => {
    await createVersion('v1', 'test-lib');
    expect(await promoteVersion('test-lib', 'v1')).toBe(true);
    expect(await promoteVersion('test-lib', 'typo')).toBe(false);
    expect((await getCurrentVersion('test-lib'))?.id).toBe('v1');
  });

  it('does not promote a version of the same id in another library', async () => {
    await createTestLibrary('other-lib');
    await createVersion('v1', 'test-lib');
    await createVersion('v2', 'other-lib');
    await promoteVersion('test-lib', 'v1');
    expect(await promoteVersion('test-lib', 'v2')).toBe(false);
    expect((await getCurrentVersion('test-lib'))?.id).toBe('v1');
  });
});

describe('deleteVersion', () => {
  it('returns not_found for unknown version', async () => {
    const result = await deleteVersion('test-lib', 'nonexistent');
    expect(result).toBe('not_found');
  });

  it('returns is_current when trying to delete active version', async () => {
    await createVersion('v1', 'test-lib');
    await promoteVersion('test-lib', 'v1');
    const result = await deleteVersion('test-lib', 'v1');
    expect(result).toBe('is_current');
  });

  it('deletes version and its documents', async () => {
    await createVersion('v1', 'test-lib');
    await createVersion('v2', 'test-lib');
    await promoteVersion('test-lib', 'v2');
    await createTestDocument('test-lib', 'v1', { slug: 'doc/old' });

    const result = await deleteVersion('test-lib', 'v1');
    expect(result).toEqual({ imageHashes: [] });

    const versions = await listVersions('test-lib');
    expect(versions.find((v) => v.id === 'v1')).toBeUndefined();
  });

  it('refuses a version that a concurrent promote makes current before the delete commits', async () => {
    await createVersion('v1', 'test-lib');
    await createVersion('v2', 'test-lib');
    await promoteVersion('test-lib', 'v2');
    await createTestDocument('test-lib', 'v1', { slug: 'doc/kept' });

    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    // A promote of v1 that has locked and marked the row but not committed yet.
    const promote = getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM versions WHERE library_id = 'test-lib' AND id = 'v1' FOR UPDATE`);
      await tx.execute(sql`UPDATE versions SET is_current = (id = 'v1') WHERE library_id = 'test-lib'`);
      locked();
      await released;
    });
    await isLocked;
    const deleting = deleteVersion('test-lib', 'v1');
    await new Promise((r) => setTimeout(r, 150));
    release();
    await promote;

    expect(await deleting).toBe('is_current');
    expect((await getCurrentVersion('test-lib'))?.id).toBe('v1');
    expect((await listVersions('test-lib')).map((v) => v.id).sort()).toEqual(['v1', 'v2']);
    const docs = (await getDb().execute(
      sql`SELECT count(*)::int AS n FROM documents WHERE library_id = 'test-lib' AND version_id = 'v1'`,
    )) as unknown as { n: number }[];
    expect(docs[0]!.n).toBe(1);
  });
});

describe('deleteVersion and document images', () => {
  it('deletes the image rows of the version only and returns their distinct hashes', async () => {
    const h1 = 'a'.repeat(64);
    const h2 = 'b'.repeat(64);
    await createVersion('v1', 'test-lib');
    await createVersion('v2', 'test-lib');
    await promoteVersion('test-lib', 'v2');
    await upsertDocumentImage('test-lib', 'v1', 'doc', 'a.png', 1, h1);
    await upsertDocumentImage('test-lib', 'v1', 'doc', 'a2.png', 1, h1);
    await upsertDocumentImage('test-lib', 'v1', 'doc', 'b.png', 1, h2);
    await upsertDocumentImage('test-lib', 'v2', 'doc', 'a.png', 1, h1);

    const result = await deleteVersion('test-lib', 'v1');
    expect(result).not.toBeTypeOf('string');
    expect(typeof result === 'string' ? [] : [...result.imageHashes].sort()).toEqual([h1, h2]);
    expect(await getDocumentImages('test-lib', 'v1', 'doc')).toEqual([]);
    expect((await getDocumentImages('test-lib', 'v2', 'doc')).map((i) => i.filename)).toEqual(['a.png']);
  });
});
