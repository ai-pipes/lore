import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { cleanDb, TEST_API_KEY, createTestLibrary, createTestVersion, createTestDocument } from '../helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
});

beforeEach(async () => {
  await cleanDb();
  await createTestLibrary();
});

const AUTH = { authorization: `Bearer ${TEST_API_KEY}` };

describe('POST /api/libraries/:id/versions', () => {
  it('creates a version', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries/test-lib/versions',
      headers: AUTH,
      body: { id: 'sha-abc', branch: 'main' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe('sha-abc');
    expect(res.json().branch).toBe('main');
  });

  it('returns 400 when id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries/test-lib/versions',
      headers: AUTH,
      body: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ['an object id', { id: { a: 1 } }],
    ['a numeric id', { id: 42 }],
    ['a path-like id', { id: '../../x' }],
    ['an id with a slash', { id: 'a/b' }],
    ['a too long id', { id: 'a'.repeat(129) }],
    ['a non-string branch', { id: 'v1', branch: ['main'] }],
    ['an empty branch', { id: 'v1', branch: '' }],
    ['a branch with a leading slash', { id: 'v1', branch: '/main' }],
    ['a branch with a dot-dot segment', { id: 'v1', branch: 'a/../b' }],
  ])('answers 400 for %s and stores nothing', async (_name, body) => {
    const res = await app.inject({ method: 'POST', url: '/api/libraries/test-lib/versions', headers: AUTH, body });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/version id|branch/);
    const list = (await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/versions' })).json();
    expect(list).toEqual([]);
  });

  it('answers 400 for a request without a body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/libraries/test-lib/versions', headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it('accepts git SHAs, demo ids, semver ids and branch names with slashes', async () => {
    for (const [id, branch] of [['0123456789abcdef0123456789abcdef01234567', 'feature/new-payment'], ['demo-1a2b3c', undefined], ['v1.2.3', 'release/1.2']]) {
      const res = await app.inject({ method: 'POST', url: '/api/libraries/test-lib/versions', headers: AUTH, body: { id, branch } });
      expect(res.statusCode, String(id)).toBe(201);
    }
  });

  it('re-creating a version is idempotent; with another branch it moves there, without one it keeps its branch', async () => {
    const post = (body: object) => app.inject({ method: 'POST', url: '/api/libraries/test-lib/versions', headers: AUTH, body });
    const first = await post({ id: 'sha-1', branch: 'feature/x' });
    expect(first.statusCode).toBe(201);
    const again = await post({ id: 'sha-1', branch: 'feature/x' });
    expect(again.statusCode).toBe(201);
    expect(again.json()).toMatchObject({ branch: 'feature/x', pushed_at: first.json().pushed_at });
    const moved = await post({ id: 'sha-1', branch: 'main' });
    expect(moved.statusCode).toBe(201);
    expect(moved.json().branch).toBe('main');
    expect(Date.parse(moved.json().pushed_at)).toBeGreaterThan(Date.parse(first.json().pushed_at));
    expect((await post({ id: 'sha-1' })).json().branch).toBe('main');
    const list = (await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/versions' })).json();
    expect(list.map((v: { branch: string }) => v.branch)).toEqual(['main']);
  });

  it('returns 404 for unknown library', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries/ghost/versions',
      headers: AUTH,
      body: { id: 'v1' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/libraries/:id/versions', () => {
  it('lists versions ordered by pushed_at desc', async () => {
    await createTestVersion('test-lib', 'v1');
    await createTestVersion('test-lib', 'v2');

    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/versions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });
});

describe('POST /api/libraries/:id/versions/:versionId/promote', () => {
  it('promotes a version', async () => {
    await createTestVersion('test-lib', 'v1');
    await createTestVersion('test-lib', 'v2');

    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries/test-lib/versions/v2/promote',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().promoted).toBe('v2');
  });

  it('returns 404 for an unknown version and keeps the current version', async () => {
    await createTestVersion('test-lib', 'v1');
    const res = await app.inject({ method: 'POST', url: '/api/libraries/test-lib/versions/typo/promote', headers: AUTH });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Version not found' });
    const list = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/versions' });
    expect(list.json().filter((v: { is_current: boolean }) => v.is_current).map((v: { id: string }) => v.id)).toEqual(['v1']);
  });
});

describe('DELETE /api/libraries/:id/versions/:versionId', () => {
  it('deletes a non-current version', async () => {
    await createTestVersion('test-lib', 'v1');
    await createTestVersion('test-lib', 'v2');

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/libraries/test-lib/versions/v1',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe('v1');
  });

  it('returns 409 when deleting current version', async () => {
    await createTestVersion('test-lib', 'v1');

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/libraries/test-lib/versions/v1',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for unknown version', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/libraries/test-lib/versions/nope',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST clone-from', () => {
  it('clones docs from source to target version', async () => {
    await createTestVersion('test-lib', 'v1');
    await createTestVersion('test-lib', 'v2');
    await createTestDocument('test-lib', 'v1', { slug: 'doc/a' });
    await createTestDocument('test-lib', 'v1', { slug: 'doc/b' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries/test-lib/versions/v2/clone-from/v1',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cloned).toBe(2);
  });
});

describe('GET /api/libraries/:id/diff/*', () => {
  it('returns the diff between two versions', async () => {
    await createTestVersion('test-lib', 'v1');
    await createTestVersion('test-lib', 'v2');
    await createTestDocument('test-lib', 'v1', { slug: 'doc/a', content: 'a\nb' });
    await createTestDocument('test-lib', 'v2', { slug: 'doc/a', content: 'a\nc' });

    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/diff/doc/a?from=v1&to=v2' });
    expect(res.statusCode).toBe(200);
    expect(res.json().contentDiff).toContain('+c');
  });

  it('answers 422 with a readable message when the content diff is too large', async () => {
    await createTestVersion('test-lib', 'v1');
    await createTestVersion('test-lib', 'v2');
    const lines = (p: string) => Array.from({ length: 8000 }, (_, i) => `${p} line ${i}`).join('\n');
    await createTestDocument('test-lib', 'v1', { slug: 'doc/big', content: lines('old') });
    await createTestDocument('test-lib', 'v2', { slug: 'doc/big', content: lines('new') });

    const started = Date.now();
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/test-lib/diff/doc/big?from=v1&to=v2' });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/too large/i);
  });
});
