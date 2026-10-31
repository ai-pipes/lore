import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import { upsertLibrary, upsertLibraryInNamespace, getLibrary, listLibraries } from '../../modules/catalog/infrastructure/pg-libraries.js';
import { cleanDb, createTestLibrary, createTestVersion, createTestDocument } from '../helpers.js';

beforeEach(cleanDb);

describe('upsertLibrary', () => {
  it('creates a new library', async () => {
    const lib = await upsertLibrary('my-lib', 'My Library');
    expect(lib.id).toBe('my-lib');
    expect(lib.display_name).toBe('My Library');
    expect(lib.created_at).toBeTruthy();
  });

  it('updates display_name on conflict', async () => {
    await upsertLibrary('my-lib', 'Original');
    const updated = await upsertLibrary('my-lib', 'Updated');
    expect(updated.display_name).toBe('Updated');
  });
});

describe('library id guard in the repository', () => {
  it('upsertLibrary and upsertLibraryInNamespace refuse an id that is not a slug', async () => {
    await expect(upsertLibrary('x/../../../tmp/escape', 'Evil')).rejects.toThrow(/library id/);
    await expect(upsertLibraryInNamespace('x/../../../tmp/escape', 'Evil', 'default')).rejects.toThrow(/library id/);
    expect(await listLibraries()).toEqual([]);
  });
});

describe('upsertLibraryInNamespace', () => {
  it('creates or renames only inside the namespace, and says whether it created', async () => {
    await getDb().execute(sql`insert into namespaces (id, display_name) values ('pay', 'Payments') on conflict do nothing`);
    expect(await upsertLibraryInNamespace('svc', 'Svc', 'pay')).toMatchObject({ created: true, library: { id: 'svc', namespace_id: 'pay' } });
    expect(await upsertLibraryInNamespace('svc', 'Svc 2', 'pay')).toMatchObject({ created: false, library: { display_name: 'Svc 2' } });
    await upsertLibrary('orders', 'Orders');
    expect(await upsertLibraryInNamespace('orders', 'Hijacked', 'pay')).toBeNull();
    expect(await getLibrary('orders')).toMatchObject({ display_name: 'Orders', namespace_id: 'default' });
  });
});

describe('getLibrary', () => {
  it('returns the library by id', async () => {
    await createTestLibrary('lib-a', 'Lib A');
    const lib = await getLibrary('lib-a');
    expect(lib?.id).toBe('lib-a');
    expect(lib?.display_name).toBe('Lib A');
  });

  it('returns undefined for unknown id', async () => {
    const lib = await getLibrary('does-not-exist');
    expect(lib).toBeUndefined();
  });
});

describe('listLibraries', () => {
  it('returns empty array when no libraries', async () => {
    const libs = await listLibraries();
    expect(libs).toEqual([]);
  });

  it('includes document count and current version', async () => {
    await createTestLibrary('stats-lib');
    await createTestVersion('stats-lib', 'v1');
    await createTestDocument('stats-lib', 'v1', { slug: 'doc/one' });
    await createTestDocument('stats-lib', 'v1', { slug: 'doc/two' });

    const libs = await listLibraries();
    const lib = libs.find((l) => l.id === 'stats-lib');

    expect(lib?.current_version).toBe('v1');
    expect(lib?.document_count).toBe(2);
  });

  it('returns null current_version if no version promoted', async () => {
    await createTestLibrary('no-version-lib');
    const libs = await listLibraries();
    const lib = libs.find((l) => l.id === 'no-version-lib');
    expect(lib?.current_version).toBeNull();
    expect(lib?.document_count).toBe(0);
  });
});
