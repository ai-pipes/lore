import { access, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { cloneVersionImages, getDocumentImages } from '../../modules/catalog/infrastructure/pg-images.js';
import { hashBuffer } from '../../modules/catalog/infrastructure/file-storage.js';
import {
  cleanDb,
  TEST_API_KEY,
  createTestLibrary,
  createTestVersion,
  buildFileMultipart,
  FAKE_PNG,
} from '../helpers.js';

let app: FastifyInstance;
let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'lore-test-images-'));
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

const AUTH = { authorization: `Bearer ${TEST_API_KEY}` };

const UPLOAD_URL = '/api/libraries/test-lib/versions/v1/images';

function buildImageUpload(slug: string, filename: string, content = FAKE_PNG) {
  return buildFileMultipart(
    { slug, filename },
    { fieldname: 'image', filename, content },
  );
}

describe('POST /api/libraries/:id/versions/:versionId/images', () => {
  it('uploads an image and returns 201 with url', async () => {
    const { body, contentType } = buildImageUpload('billing/invoice', 'screenshot.png');

    const res = await app.inject({
      method: 'POST',
      url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.filename).toBe('screenshot.png');
    expect(json.url).toContain('billing/invoice/screenshot.png');
  });

  it('returns 400 when slug is missing', async () => {
    const { body, contentType } = buildFileMultipart(
      { filename: 'screenshot.png' },
      { fieldname: 'image', filename: 'screenshot.png', content: FAKE_PNG },
    );

    const res = await app.inject({
      method: 'POST',
      url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const { body, contentType } = buildImageUpload('billing/invoice', 'screenshot.png');

    const res = await app.inject({
      method: 'POST',
      url: UPLOAD_URL,
      headers: { 'content-type': contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('uploading same content twice is idempotent', async () => {
    const { body, contentType } = buildImageUpload('billing/invoice', 'screenshot.png');

    const res1 = await app.inject({
      method: 'POST',
      url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });
    const res2 = await app.inject({
      method: 'POST',
      url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res1.json().filename).toBe(res2.json().filename);
  });
});

describe('GET /api/libraries/:id/versions/:versionId/images (list)', () => {
  it('returns list of images for a slug', async () => {
    const up = (filename: string, content = FAKE_PNG) =>
      buildImageUpload('billing/invoice', filename, content);

    await app.inject({
      method: 'POST', url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': up('step-1.png').contentType },
      payload: up('step-1.png').body,
    });
    await app.inject({
      method: 'POST', url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': up('step-2.png', Buffer.concat([FAKE_PNG, Buffer.from('different')])).contentType },
      payload: up('step-2.png', Buffer.concat([FAKE_PNG, Buffer.from('different')])).body,
    });

    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: `${UPLOAD_URL}?slug=billing/invoice`,
    });

    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(2);
    expect(list.map((i: { filename: string }) => i.filename).sort()).toEqual(['step-1.png', 'step-2.png']);
    expect(list[0].image_hash).toBeTruthy();
  });

  it('returns 400 without slug param', async () => {
    const res = await app.inject({ headers: AUTH, method: 'GET', url: UPLOAD_URL });
    expect(res.statusCode).toBe(400);
  });

  it('returns empty array when no images', async () => {
    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: `${UPLOAD_URL}?slug=billing/invoice`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('GET /api/libraries/:id/versions/:versionId/images/* (serve)', () => {
  it('serves an uploaded image with correct content-type', async () => {
    const { body, contentType } = buildImageUpload('billing/invoice', 'screenshot.png');
    await app.inject({
      method: 'POST', url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });

    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: '/api/libraries/test-lib/versions/v1/images/billing/invoice/screenshot.png',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.from(res.rawPayload)).toEqual(FAKE_PNG);
  });

  it('returns 404 for non-existent image', async () => {
    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: '/api/libraries/test-lib/versions/v1/images/billing/invoice/missing.png',
    });
    expect(res.statusCode).toBe(404);
  });

  it('serves correct image after clone — both versions share the same file', async () => {
    const { body, contentType } = buildImageUpload('billing/invoice', 'screenshot.png');
    await app.inject({
      method: 'POST', url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });

    await createTestVersion('test-lib', 'v2');
    await cloneVersionImages('test-lib', 'v1', 'v2');

    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: '/api/libraries/test-lib/versions/v2/images/billing/invoice/screenshot.png',
    });

    expect(res.statusCode).toBe(200);
    expect(Buffer.from(res.rawPayload)).toEqual(FAKE_PNG);
  });
});

describe('DELETE /api/libraries/:id/versions/:versionId/images/*', () => {
  it('deletes image record and file when no other version references it', async () => {
    const { body, contentType } = buildImageUpload('billing/invoice', 'screenshot.png');
    await app.inject({
      method: 'POST', url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/libraries/test-lib/versions/v1/images/billing/invoice/screenshot.png',
      headers: AUTH,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe('screenshot.png');

    // File is gone
    const get = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: '/api/libraries/test-lib/versions/v1/images/billing/invoice/screenshot.png',
    });
    expect(get.statusCode).toBe(404);
  });

  it('keeps the file when another version still references the same hash', async () => {
    const { body, contentType } = buildImageUpload('billing/invoice', 'screenshot.png');
    await app.inject({
      method: 'POST', url: UPLOAD_URL,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });

    await createTestVersion('test-lib', 'v2');
    await cloneVersionImages('test-lib', 'v1', 'v2');

    // Delete from v1
    await app.inject({
      method: 'DELETE',
      url: '/api/libraries/test-lib/versions/v1/images/billing/invoice/screenshot.png',
      headers: AUTH,
    });

    // v2 still serves the image
    const res = await app.inject({
      headers: AUTH,
      method: 'GET',
      url: '/api/libraries/test-lib/versions/v2/images/billing/invoice/screenshot.png',
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/libraries/test-lib/versions/v1/images/billing/invoice/screenshot.png',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /api/libraries/:id/versions/:versionId removes the version\'s images', () => {
  async function uploadToV1() {
    const { body, contentType } = buildImageUpload('billing/invoice', 'screenshot.png');
    const r = await app.inject({ method: 'POST', url: UPLOAD_URL, headers: { ...AUTH, 'content-type': contentType }, payload: body });
    expect(r.statusCode).toBe(201);
  }
  const blobPath = () => join(storageDir, 'test-lib', hashBuffer(FAKE_PNG));

  it('deletes the image rows and the file no other row references', async () => {
    await uploadToV1();
    await createTestVersion('test-lib', 'v2'); // v2 becomes current, v1 can be deleted
    const del = await app.inject({ method: 'DELETE', url: '/api/libraries/test-lib/versions/v1', headers: AUTH });
    expect(del.statusCode).toBe(200);
    expect(await getDocumentImages('test-lib', 'v1', 'billing/invoice')).toEqual([]);
    await expect(access(blobPath())).rejects.toThrow();
  });

  it('keeps the file while another version still references the hash', async () => {
    await uploadToV1();
    await createTestVersion('test-lib', 'v2');
    await cloneVersionImages('test-lib', 'v1', 'v2');
    const del = await app.inject({ method: 'DELETE', url: '/api/libraries/test-lib/versions/v1', headers: AUTH });
    expect(del.statusCode).toBe(200);
    expect(await getDocumentImages('test-lib', 'v1', 'billing/invoice')).toEqual([]);
    await access(blobPath());
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/versions/v2/images/billing/invoice/screenshot.png' });
    expect(res.statusCode).toBe(200);
  });
});

describe('image files are per library: deleting in one library ignores the same image elsewhere', () => {
  const fileOf = (libraryId: string) => join(storageDir, libraryId, hashBuffer(FAKE_PNG));

  async function uploadTo(libraryId: string, versionId: string) {
    const { body, contentType } = buildImageUpload('billing/invoice', 'screenshot.png');
    const r = await app.inject({
      method: 'POST',
      url: `/api/libraries/${libraryId}/versions/${versionId}/images`,
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });
    expect(r.statusCode).toBe(201);
  }

  beforeEach(async () => {
    await createTestLibrary('other-lib', 'Other Library');
    await createTestVersion('other-lib', 'v1');
    await uploadTo('test-lib', 'v1');
    await uploadTo('other-lib', 'v1');
    await access(fileOf('test-lib'));
    await access(fileOf('other-lib'));
  });

  it('deleting the last image record of library A removes the file of A and keeps the file of B', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/libraries/test-lib/versions/v1/images/billing/invoice/screenshot.png',
      headers: AUTH,
    });
    expect(del.statusCode).toBe(200);
    await expect(access(fileOf('test-lib'))).rejects.toThrow();
    await access(fileOf('other-lib'));
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/other-lib/versions/v1/images/billing/invoice/screenshot.png' });
    expect(res.statusCode).toBe(200);
  });

  it('deleting the version holding the last reference of A removes the file of A and keeps the file of B', async () => {
    await createTestVersion('test-lib', 'v2'); // v2 becomes current, v1 can be deleted
    const del = await app.inject({ method: 'DELETE', url: '/api/libraries/test-lib/versions/v1', headers: AUTH });
    expect(del.statusCode).toBe(200);
    await expect(access(fileOf('test-lib'))).rejects.toThrow();
    await access(fileOf('other-lib'));
  });
});
