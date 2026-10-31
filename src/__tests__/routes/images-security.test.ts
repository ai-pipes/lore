import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import { buildServer } from '../../platform/http/server.js';
import { upsertDocumentImage } from '../../modules/catalog/infrastructure/pg-images.js';
import { saveImageByHash, hashBuffer, getImageFilePath, fileBlobStore } from '../../modules/catalog/infrastructure/file-storage.js';
import { detectImageType } from '../../modules/catalog/domain/image-type.js';
import { cleanDb, TEST_API_KEY, createTestLibrary, createTestVersion, buildFileMultipart, FAKE_PNG } from '../helpers.js';

let app: FastifyInstance;
let storageDir: string;

const AUTH = { authorization: `Bearer ${TEST_API_KEY}` };
const UPLOAD_URL = '/api/libraries/test-lib/versions/v1/images';

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<!DOCTYPE html><script>alert(document.cookie)</script>');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'lore-test-images-sec-'));
  process.env.LORE_STORAGE_PATH = storageDir;
  app = await buildServer();
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
  delete process.env.LORE_STORAGE_PATH;
});

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
  await createTestVersion('test-lib', 'v1');
});

function upload(filename: string, content: Buffer, mimetype: string, slug = 'pets/photo') {
  const { body, contentType } = buildFileMultipart({ slug, filename }, { fieldname: 'image', filename, content, mimetype });
  return app.inject({ method: 'POST', url: UPLOAD_URL, headers: { ...AUTH, 'content-type': contentType }, payload: body });
}

describe('detectImageType', () => {
  it('recognises allowed formats by magic bytes', () => {
    expect(detectImageType(FAKE_PNG)).toBe('image/png');
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(GIF)).toBe('image/gif');
    expect(detectImageType(WEBP)).toBe('image/webp');
  });
  it('rejects SVG, HTML and empty input', () => {
    expect(detectImageType(SVG)).toBeNull();
    expect(detectImageType(HTML)).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('image upload hardening', () => {
  it('rejects SVG even when the client claims image/png', async () => {
    const res = await upload('evil.png', SVG, 'image/png');
    expect(res.statusCode).toBe(415);
  });

  it('rejects SVG declared as image/svg+xml', async () => {
    expect((await upload('evil.svg', SVG, 'image/svg+xml')).statusCode).toBe(415);
  });

  it('rejects HTML disguised as an image', async () => {
    expect((await upload('page.png', HTML, 'text/html')).statusCode).toBe(415);
  });

  it('stores the detected type, not the client-declared one', async () => {
    expect((await upload('photo.jpg', JPEG, 'text/html')).statusCode).toBe(201);
    const res = await app.inject({ headers: AUTH, method: 'GET', url: `${UPLOAD_URL}/pets/photo/photo.jpg` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  it.each([
    ['a.html', GIF, 'image/gif'],
    ['a.png', GIF, 'image/png'],
    ['a.gif', JPEG, 'image/gif'],
    ['noext', FAKE_PNG, 'image/png'],
  ])('rejects the filename %s that does not match the detected type with 400', async (name, content, mimetype) => {
    const res = await upload(name, content, mimetype);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/extension/);
  });

  it.each([
    ['anim.GIF', GIF],
    ['shot.jpeg', JPEG],
    ['shot.jpg', JPEG],
    ['pic.webp', WEBP],
  ])('accepts %s for its detected type', async (name, content) => {
    expect((await upload(name, content, 'application/octet-stream')).statusCode).toBe(201);
  });

  it.each(['../evil.png', 'a/b.png', '..png', '.hidden.png'])('rejects unsafe filename %s', async (name) => {
    expect((await upload(name, FAKE_PNG, 'image/png')).statusCode).toBe(400);
  });

  it.each(['pets/a\u0000b', 'pets/\u001b[31m', 'pets/a\nb'])('rejects a control character in a multipart field (slug %j) with 400', async (slug) => {
    const res = await upload('ok.png', FAKE_PNG, 'image/png', slug);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/control character/);
  });

  it('rejects a control character in any other multipart text field', async () => {
    const { body, contentType } = buildFileMultipart(
      { slug: 'pets/photo', filename: 'ok.png', note: 'x\u0000y' },
      { fieldname: 'image', filename: 'ok.png', content: FAKE_PNG, mimetype: 'image/png' },
    );
    const res = await app.inject({ method: 'POST', url: UPLOAD_URL, headers: { ...AUTH, 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a slug with traversal segments', async () => {
    expect((await upload('ok.png', FAKE_PNG, 'image/png', 'pets/../../x')).statusCode).toBe(400);
  });

  it('returns 404 when the library does not exist', async () => {
    const { body, contentType } = buildFileMultipart({ slug: 'a', filename: 'a.png' }, { fieldname: 'image', filename: 'a.png', content: FAKE_PNG });
    const res = await app.inject({ method: 'POST', url: '/api/libraries/missing/versions/v1/images', headers: { ...AUTH, 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(404);
  });
});

describe('image serving headers', () => {
  it.each(['/api', '/static'])('%s route sends nosniff, inline disposition and a sandbox CSP', async (prefix) => {
    await upload('shot.png', FAKE_PNG, 'image/png');
    const res = await app.inject({ headers: AUTH, method: 'GET', url: `${prefix}/libraries/test-lib/versions/v1/images/pets/photo/shot.png` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('inline; filename="shot.png"');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain('sandbox');
    // authenticated content: browsers may cache it, shared caches must not
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
  });

  it('serves legacy rows with a non-allowlisted type as an octet-stream attachment', async () => {
    const hash = hashBuffer(SVG);
    await saveImageByHash('test-lib', hash, SVG);
    await upsertDocumentImage('test-lib', 'v1', 'pets/photo', 'old.svg', SVG.length, hash, 'image/svg+xml');
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/static/libraries/test-lib/versions/v1/images/pets/photo/old.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('image file storage stays inside the storage root', () => {
  const hash = hashBuffer(FAKE_PNG);

  it('builds paths under the storage root for a valid library id and sha-256 hash', () => {
    expect(getImageFilePath('test-lib', hash)).toBe(join(resolve(storageDir), 'test-lib', hash));
  });

  it('refuses library ids that are not slugs, so nothing escapes the root', async () => {
    for (const libraryId of ['x/../../../tmp/escape', '..', '.', '', 'a/b', '/abs']) {
      expect(() => getImageFilePath(libraryId, hash)).toThrow(/library id/);
    }
    await expect(saveImageByHash('x/../../escape', hash, FAKE_PNG)).rejects.toThrow(/library id/);
    await expect(access(join(storageDir, '..', 'escape'))).rejects.toThrow();
  });

  it('refuses an image hash that is not a sha-256 hex digest', () => {
    for (const imageHash of ['../../etc/passwd', '..', 'abc', hash.toUpperCase(), `${hash}/x`]) {
      expect(() => getImageFilePath('test-lib', imageHash)).toThrow(/image hash/);
    }
  });

  it('refuses to delete a path outside the storage root', async () => {
    const outside = join(storageDir, '..', `lore-outside-del-${hash.slice(0, 8)}`);
    await writeFile(outside, 'keep');
    try {
      await expect(fileBlobStore.delete(outside)).rejects.toThrow(/outside the storage root/);
      await access(outside);
    } finally {
      await rm(outside, { force: true });
    }
  });
});

describe('legacy rows whose library id or hash cannot address a stored file', () => {
  const hash = hashBuffer(FAKE_PNG);

  /** Rows written before ids were validated: inserted directly, bypassing every check. */
  async function insertLegacyImage(libraryId: string, imageHash: string) {
    const db = getDb();
    await db.execute(sql`INSERT INTO libraries (id, display_name) VALUES (${libraryId}, 'Legacy') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO versions (id, library_id) VALUES ('v1', ${libraryId}) ON CONFLICT DO NOTHING`);
    await db.execute(sql`
      INSERT INTO document_images (library_id, version_id, slug, filename, file_size, image_hash, mime_type)
      VALUES (${libraryId}, 'v1', 'pets/photo', 'old.png', ${FAKE_PNG.length}, ${imageHash}, 'image/png')`);
  }

  async function imageRowCount(libraryId: string): Promise<number> {
    const rows = (await getDb().execute(
      sql`SELECT count(*)::int AS n FROM document_images WHERE library_id = ${libraryId}`,
    )) as unknown as { n: number }[];
    return rows[0]!.n;
  }

  const cases: Array<[string, string, string]> = [
    ['an uppercase library id', 'Legacy-Lib', hash],
    ['a library id with a slash and dots', 'a/../../escape', hash],
    ['a non-ASCII library id', 'Ünïcode', hash],
    ['a hash that is not sha-256 hex', 'test-lib', '../../etc/passwd'],
  ];

  it.each(cases)('GET answers 404 for %s', async (_name, libraryId, imageHash) => {
    await insertLegacyImage(libraryId, imageHash);
    const id = encodeURIComponent(libraryId);
    for (const prefix of ['/api', '/static']) {
      const res = await app.inject({ headers: AUTH, method: 'GET', url: `${prefix}/libraries/${id}/versions/v1/images/pets/photo/old.png` });
      expect(res.statusCode, `${prefix} ${libraryId}`).toBe(404);
    }
  });

  it.each(cases)('DELETE removes the row and skips the file for %s', async (_name, libraryId, imageHash) => {
    await insertLegacyImage(libraryId, imageHash);
    const id = encodeURIComponent(libraryId);
    const res = await app.inject({ headers: AUTH, method: 'DELETE', url: `/api/libraries/${id}/versions/v1/images/pets/photo/old.png` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 'old.png' });
    expect(await imageRowCount(libraryId)).toBe(0);
  });
});

describe('libraries created before id validation can still take images', () => {
  async function insertLegacyLibrary(libraryId: string) {
    const db = getDb();
    await db.execute(sql`INSERT INTO libraries (id, display_name) VALUES (${libraryId}, 'Legacy') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO versions (id, library_id) VALUES ('v1', ${libraryId}) ON CONFLICT DO NOTHING`);
  }

  function uploadTo(libraryId: string) {
    const { body, contentType } = buildFileMultipart(
      { slug: 'pets/photo', filename: 'shot.png' },
      { fieldname: 'image', filename: 'shot.png', content: FAKE_PNG, mimetype: 'image/png' },
    );
    return app.inject({
      method: 'POST',
      url: `/api/libraries/${encodeURIComponent(libraryId)}/versions/v1/images`,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });
  }

  it.each(['PaymentService', 'Legacy.Lib'])('uploads and serves an image of the path-safe legacy library %s', async (libraryId) => {
    await insertLegacyLibrary(libraryId);
    expect((await uploadTo(libraryId)).statusCode).toBe(201);
    const served = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: `/api/libraries/${encodeURIComponent(libraryId)}/versions/v1/images/pets/photo/shot.png`,
    });
    expect(served.statusCode).toBe(200);
    const hash = hashBuffer(FAKE_PNG);
    expect(getImageFilePath(libraryId, hash)).toBe(join(resolve(storageDir), libraryId, hash));
  });

  it.each(['a/../../escape', 'CON', 'Nul.txt', 'svc.', 'a:b', 'Ünïcode', 'café', 'café'])('answers 400 with a clear message for the legacy library id %s that is not a safe path segment', async (libraryId) => {
    await insertLegacyLibrary(libraryId);
    const res = await uploadTo(libraryId);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/library id/i);
  });
});
