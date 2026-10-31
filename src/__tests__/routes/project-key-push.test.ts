import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import http from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { buildServer } from '../../platform/http/server.js';
import { getDb } from '../../platform/db.js';
import { createMcpHttpHandler, mcpOptionsFromEnv } from '../../platform/mcp/server.js';
import { push } from '../../cli/push.js';
import { cleanDb, createTestLibrary, createTestUser, createTestVersion, type TestUser } from '../helpers.js';

let app: FastifyInstance;
let baseUrl: string;
let admin: TestUser;
let docsDir: string;

beforeAll(async () => {
  app = await buildServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  docsDir = mkdtempSync(join(tmpdir(), 'lore-pk-'));
  mkdirSync(join(docsDir, 'svc'));
  writeFileSync(join(docsDir, 'svc', 'intro.md'), '---\nslug: svc/intro\n---\n# Intro\n\nHello.\n');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterAll(async () => {
  vi.restoreAllMocks();
  rmSync(docsDir, { recursive: true, force: true });
  await app.close();
});
beforeEach(async () => {
  await cleanDb();
  admin = await createTestUser({ role: 'admin' });
  for (const [id, name] of [['pay', 'Payments'], ['shop', 'Shop']]) {
    const r = await app.inject({ method: 'POST', url: '/api/namespaces', headers: admin.bearer, payload: { id, display_name: name } });
    expect(r.statusCode).toBe(201);
  }
});

async function createKey(namespace_id: string, library_id?: string): Promise<{ id: string; key: string }> {
  const r = await app.inject({ method: 'POST', url: '/api/project-keys', headers: admin.bearer, payload: { namespace_id, name: 'ci', library_id } });
  expect(r.statusCode).toBe(201);
  return r.json();
}

const pushAs = (apiKey: string, library: string, version = 'v1') => push({ dir: docsDir, library, version, baseUrl, token: apiKey, noEnrich: true });

async function libraryInShop(id: string) {
  await createTestLibrary(id);
  await getDb().execute(sql`update libraries set namespace_id = 'shop' where id = ${id}`);
}

describe('pushing with a project key', () => {
  it('lpk_ pushes a new library into its namespace', async () => {
    const { key } = await createKey('pay');
    await pushAs(key, 'new-svc');
    const ns = (await app.inject({ url: '/api/namespaces', headers: admin.bearer })).json() as { id: string; libraries: string[] }[];
    expect(ns.find((n) => n.id === 'pay')?.libraries).toEqual(['new-svc']);
    const docs = await app.inject({ url: '/api/document?library_id=new-svc&slug=svc/intro', headers: admin.bearer });
    expect(docs.statusCode).toBe(200);
    // A second push (incremental, new version) works too
    await pushAs(key, 'new-svc', 'v2');
  });

  it('pushing to a library in another namespace is 403', async () => {
    await libraryInShop('orders');
    await createTestVersion('orders', 'v1');
    const { key } = await createKey('pay');
    await expect(pushAs(key, 'orders', 'v2')).rejects.toThrow(/403/);
    const auth = { authorization: `Bearer ${key}` };
    expect((await app.inject({ method: 'POST', url: '/api/libraries/orders/versions', headers: auth, payload: { id: 'v3' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/libraries/orders/versions', headers: auth })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/libraries/orders/documents?version=v1', headers: auth })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/libraries/orders/versions/v1/document-hashes', headers: auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/libraries/orders/versions/v1/documents/x', headers: auth })).statusCode).toBe(403);
  });

  it('creating a library id that exists elsewhere is 403', async () => {
    await libraryInShop('orders');
    const { key } = await createKey('pay');
    const r = await app.inject({ method: 'POST', url: '/api/libraries', headers: { authorization: `Bearer ${key}` }, payload: { id: 'orders', display_name: 'Mine' } });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/libraries/orders', headers: admin.bearer })).json()).toMatchObject({ display_name: 'Test Library', namespace_id: 'shop' });
  });

  it('a project key may not create a library in another namespace', async () => {
    const { key } = await createKey('pay');
    const r = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers: { authorization: `Bearer ${key}` },
      payload: { id: 'x', display_name: 'X', namespace_id: 'shop' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('a key restricted to one library pushes only that library', async () => {
    await createTestLibrary('billing');
    await getDb().execute(sql`update libraries set namespace_id = 'pay' where id = 'billing'`);
    const { key } = await createKey('pay', 'billing');
    await pushAs(key, 'billing');
    await expect(pushAs(key, 'other')).rejects.toThrow(/403/);
  });

  it('GET /api/libraries for a key lists only its namespace', async () => {
    await libraryInShop('orders');
    await createTestLibrary('billing');
    await getDb().execute(sql`update libraries set namespace_id = 'pay' where id = 'billing'`);
    const { key } = await createKey('pay');
    const r = await app.inject({ url: '/api/libraries', headers: { authorization: `Bearer ${key}` } });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { id: string }[]).map((l) => l.id)).toEqual(['billing']);
    expect((await app.inject({ url: '/api/libraries', headers: admin.bearer })).json()).toHaveLength(2);
  });

  it('lpk_ on /api/search, /api/sessions, /api/users, /mcp is 403/403/403/401', async () => {
    const { key } = await createKey('pay');
    const auth = { authorization: `Bearer ${key}` };
    expect((await app.inject({ url: '/api/search?q=x', headers: auth })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/sessions', headers: auth })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/users', headers: auth })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/namespaces', headers: auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/project-keys', headers: auth, payload: { namespace_id: 'pay', name: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/', headers: auth })).statusCode).toBe(403);

    const mcp = http.createServer();
    await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', resolve));
    const port = (mcp.address() as AddressInfo).port;
    mcp.on('request', createMcpHttpHandler({ ...mcpOptionsFromEnv(port), host: '127.0.0.1' }));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(401);
    } finally {
      mcp.closeAllConnections();
      await new Promise<void>((resolve) => mcp.close(() => resolve()));
    }
  });

  it('GET /api/auth/me tells a project key its namespace', async () => {
    const { key } = await createKey('pay');
    const r = await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${key}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ kind: 'project', namespace: 'pay', key_name: 'ci', library_id: null });
  });

  it('after the library is moved away, the next push is 403', async () => {
    const { key } = await createKey('pay');
    await pushAs(key, 'svc');
    const move = await app.inject({ method: 'PUT', url: '/api/libraries/svc/namespace', headers: admin.bearer, payload: { namespace_id: 'shop' } });
    expect(move.statusCode).toBe(200);
    await expect(pushAs(key, 'svc', 'v2')).rejects.toThrow(/403/);
  });

  it('after revocation the key is 401 immediately', async () => {
    const { id, key } = await createKey('pay');
    await pushAs(key, 'svc');
    expect((await app.inject({ method: 'DELETE', url: `/api/project-keys/${id}`, headers: admin.bearer })).statusCode).toBe(204);
    await expect(pushAs(key, 'svc', 'v2')).rejects.toThrow(/401/);
    expect((await app.inject({ url: '/api/libraries', headers: { authorization: `Bearer ${key}` } })).statusCode).toBe(401);
  });

  it('keys are stored hashed and shown once', async () => {
    const { id, key } = await createKey('pay');
    const rows = (await getDb().execute(sql`select * from project_keys where id = ${id}`)) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(key);
    expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
    const list = await app.inject({ url: '/api/project-keys', headers: admin.bearer });
    expect(list.body).not.toContain(key);
    expect(list.json()[0]).not.toHaveProperty('key');
    expect(list.json()[0]).not.toHaveProperty('hash');
    // Using the key records it
    await app.inject({ url: '/api/libraries', headers: { authorization: `Bearer ${key}` } });
    const used = (await app.inject({ url: '/api/project-keys', headers: admin.bearer })).json()[0];
    expect(used.last_used_at).not.toBeNull();
  });

  it('member cannot create a project key (403)', async () => {
    const member = await createTestUser({ role: 'member' });
    const r = await app.inject({ method: 'POST', url: '/api/project-keys', headers: member.bearer, payload: { namespace_id: 'pay', name: 'ci' } });
    expect(r.statusCode).toBe(403);
  });

  it('a member cannot push, an admin user still pushes anywhere', async () => {
    const member = await createTestUser({ role: 'member' });
    await expect(pushAs(member.token, 'm-svc')).rejects.toThrow(/403/);
    await libraryInShop('orders');
    await pushAs(admin.token, 'orders');
  });

  it('an incremental push sees every remote document: past the first 100 it skips unchanged, removes deleted', async () => {
    const { key } = await createKey('pay');
    const dir = mkdtempSync(join(tmpdir(), 'lore-many-'));
    try {
      const name = (i: number) => `d${String(i).padStart(3, '0')}`;
      for (let i = 0; i < 120; i++) writeFileSync(join(dir, `${name(i)}.md`), `---\nslug: many/${name(i)}\n---\n# Doc ${i}\n`);
      await push({ dir, library: 'many', version: 'v1', baseUrl, token: key, noEnrich: true });

      // Delete a document that sorts past position 100 and change nothing else.
      rmSync(join(dir, `${name(115)}.md`));
      const logs: string[] = [];
      vi.mocked(console.log).mockImplementation((m: unknown) => void logs.push(String(m)));
      await push({ dir, library: 'many', version: 'v2', baseUrl, token: key, noEnrich: true });
      vi.mocked(console.log).mockImplementation(() => {});

      expect(logs.join('\n')).toContain('Nothing changed.');
      expect(logs.join('\n')).toContain('Removing 1 deleted document(s)');
      const rows = (await getDb().execute(
        sql`select slug from documents where library_id = 'many' and version_id = 'v2'`,
      )) as unknown as { slug: string }[];
      expect(rows).toHaveLength(119);
      expect(rows.map((r) => r.slug)).not.toContain(`many/${name(115)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
