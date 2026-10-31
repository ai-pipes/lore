// Which files `lore push` reads from the docs directory, and the slugs and hashes it derives.
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'net';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { buildServer } from '../../platform/http/server.js';
import { getDb } from '../../platform/db.js';
import { push } from '../../cli/push.js';
import { cleanDb, createTestUser, FAKE_PNG, type TestUser } from '../helpers.js';

let app: FastifyInstance;
let baseUrl: string;
let admin: TestUser;
let root: string;
let warnings: string[];
let logs: string[];

beforeAll(async () => {
  app = await buildServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await cleanDb();
  admin = await createTestUser({ role: 'admin' });
  root = mkdtempSync(join(tmpdir(), 'lore-push-files-'));
  warnings = [];
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
  vi.spyOn(console, 'warn').mockImplementation((m: unknown) => void warnings.push(String(m)));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const pushDir = (dir: string, version = 'v1') =>
  push({ dir, library: 'files', version, baseUrl, token: admin.token, noEnrich: true });

async function slugs(version = 'v1'): Promise<string[]> {
  const rows = (await getDb().execute(
    sql`select slug from documents where library_id = 'files' and version_id = ${version} order by slug`,
  )) as unknown as { slug: string }[];
  return rows.map((r) => r.slug);
}

async function images(): Promise<string[]> {
  const rows = (await getDb().execute(
    sql`select slug, filename from document_images where library_id = 'files' order by slug, filename`,
  )) as unknown as { slug: string; filename: string }[];
  return rows.map((r) => `${r.slug}/${r.filename}`);
}

describe('lore push and symbolic links', () => {
  it('skips symlinked documents, directories and images with a warning; a symlink loop does not crash', async () => {
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.md'), '---\nslug: leaked/secret\n---\nLORE_TOKEN=sk_secret\n');
    mkdirSync(join(outside, 'sub'));
    writeFileSync(join(outside, 'sub', 'other.md'), '---\nslug: leaked/other\n---\nOther\n');
    writeFileSync(join(outside, 'pic.png'), FAKE_PNG);
    mkdirSync(join(outside, 'imgs'));
    writeFileSync(join(outside, 'imgs', 'outside.png'), FAKE_PNG);

    const docs = join(root, 'docs');
    mkdirSync(docs);
    writeFileSync(join(docs, 'intro.md'), '---\nslug: svc/intro\n---\nIntro\n');
    mkdirSync(join(docs, 'intro'));
    writeFileSync(join(docs, 'intro', 'real.png'), FAKE_PNG);
    symlinkSync(join(outside, 'pic.png'), join(docs, 'intro', 'linked.png'));
    writeFileSync(join(docs, 'guide.md'), '---\nslug: svc/guide\n---\nGuide\n');
    symlinkSync(join(outside, 'imgs'), join(docs, 'guide'));
    symlinkSync(join(outside, 'secret.md'), join(docs, 'env.md'));
    symlinkSync(join(outside, 'sub'), join(docs, 'linked-dir'));
    symlinkSync(docs, join(docs, 'loop'));

    await pushDir(docs);

    expect(await slugs()).toEqual(['svc/guide', 'svc/intro']);
    expect(await images()).toEqual(['svc/intro/real.png']);
    const warned = warnings.join('\n');
    for (const name of ['env.md', 'linked-dir', 'loop', 'linked.png', 'guide']) expect(warned).toContain(name);
    expect(warned).toMatch(/symbolic link/);
  });
});

describe('lore push: slugs and hashes', () => {
  it('a document without a frontmatter slug fails the push before anything is created', async () => {
    const docs = join(root, 'docs');
    mkdirSync(join(docs, 'sub'), { recursive: true });
    writeFileSync(join(docs, 'ok.md'), '---\nslug: svc/ok\n---\nOk\n');
    writeFileSync(join(docs, 'sub', 'no-slug.md'), '# No frontmatter\n');
    writeFileSync(join(docs, 'numeric.md'), '---\nslug: 42\n---\nNumeric slug\n');

    const e = await pushDir(docs).catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toMatch(/slug/);
    expect((e as Error).message).toContain(join('sub', 'no-slug.md'));
    expect((e as Error).message).toContain('numeric.md');
    const lib = await app.inject({ url: '/api/libraries/files', headers: admin.bearer });
    expect(lib.statusCode).toBe(404);
  });

  it('the local hash matches the server hash, also with links the server drops', async () => {
    const docs = join(root, 'docs');
    mkdirSync(docs);
    writeFileSync(
      join(docs, 'a.md'),
      '---\nslug: a\ndomain: 7\nlinks:\n  - slug: b\n    library: other\n  - type: calls\n  - slug: ""\n  - just-a-string\n---\nA\r\n',
    );
    writeFileSync(join(docs, 'b.md'), '---\nslug: b\n---\nB\n');
    await pushDir(docs, 'v1');
    logs.length = 0;
    await pushDir(docs, 'v2');
    expect(logs.join('\n')).toContain('Nothing changed.');
    expect(await slugs('v2')).toEqual(['a', 'b']);
  });
});
