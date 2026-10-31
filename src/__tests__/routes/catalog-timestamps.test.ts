/** Catalog APIs hand timestamps to clients as ISO-8601 UTC, not in Postgres' text format. */
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { cleanDb, TEST_API_KEY, buildFileMultipart, FAKE_PNG } from '../helpers.js';

const AUTH = { authorization: `Bearer ${TEST_API_KEY}` };
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let app: FastifyInstance;
let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'lore-test-ts-'));
  process.env.LORE_STORAGE_PATH = storageDir;
  app = await buildServer();
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
  delete process.env.LORE_STORAGE_PATH;
});

beforeEach(cleanDb);

/** An ISO-8601 UTC string within a minute of now. */
function expectRecentIso(value: unknown, what: string): void {
  expect(value, what).toMatch(ISO_UTC);
  expect(Math.abs(Date.parse(value as string) - Date.now()), what).toBeLessThan(60_000);
}

const get = async (url: string) => (await app.inject({ headers: AUTH, url })).json();
const post = async (url: string, body: object) => app.inject({ method: 'POST', headers: AUTH, url, body });

describe('catalog timestamps are ISO-8601 UTC', () => {
  it('libraries, versions, namespaces and images', async () => {
    const ns = await post('/api/namespaces', { id: 'pay', display_name: 'Payments' });
    expectRecentIso(ns.json().created_at, 'POST /api/namespaces');
    for (const n of await get('/api/namespaces')) expect(n.created_at, `GET /api/namespaces ${n.id}`).toMatch(ISO_UTC);
    const renamed = await app.inject({ method: 'PATCH', headers: AUTH, url: '/api/namespaces/pay', body: { display_name: 'Pay' } });
    expectRecentIso(renamed.json().created_at, 'PATCH /api/namespaces/:id');

    const lib = await post('/api/libraries', { id: 'ts-lib', display_name: 'TS' });
    expectRecentIso(lib.json().created_at, 'POST /api/libraries (created)');
    const again = await post('/api/libraries', { id: 'ts-lib', display_name: 'TS 2' });
    expectRecentIso(again.json().created_at, 'POST /api/libraries (renamed)');
    expectRecentIso((await get('/api/libraries/ts-lib')).created_at, 'GET /api/libraries/:id');
    expectRecentIso((await get('/api/libraries'))[0].created_at, 'GET /api/libraries');

    const v = await post('/api/libraries/ts-lib/versions', { id: 'v1', branch: 'main' });
    expectRecentIso(v.json().pushed_at, 'POST versions');
    expectRecentIso((await post('/api/libraries/ts-lib/versions', { id: 'v1', branch: 'main' })).json().pushed_at, 'POST versions (existing)');
    expectRecentIso((await get('/api/libraries/ts-lib/versions'))[0].pushed_at, 'GET versions');

    const { body, contentType } = buildFileMultipart(
      { slug: 'a', filename: 'x.png' },
      { fieldname: 'image', filename: 'x.png', content: FAKE_PNG, mimetype: 'image/png' },
    );
    const up = await app.inject({ method: 'POST', url: '/api/libraries/ts-lib/versions/v1/images', headers: { ...AUTH, 'content-type': contentType }, payload: body });
    expect(up.statusCode).toBe(201);
    expectRecentIso((await get('/api/libraries/ts-lib/versions/v1/images?slug=a'))[0].created_at, 'GET images');
  });
});
