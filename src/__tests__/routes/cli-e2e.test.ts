import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'net';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { sql } from 'drizzle-orm';
import { buildServer } from '../../platform/http/server.js';
import { getDb } from '../../platform/db.js';
import { createPgIdentity } from '../../modules/identity/infrastructure/compose.js';
import { registerClientCommands } from '../../cli/index.js';
import { credentialsPath, readCredentials, writeCredentials } from '../../cli/credentials.js';
import { cliHostname, deviceLogin, login, logout, whoami } from '../../cli/auth-commands.js';
import {
  assignLibrary,
  createNamespace,
  createProjectKey,
  listNamespaces,
  listProjectKeys,
  revokeProjectKey,
} from '../../cli/admin-commands.js';
import { ApiError } from '../../cli/client.js';
import { cleanDb, createTestLibrary, createTestUser, TEST_API_KEY, type TestUser } from '../helpers.js';

let app: FastifyInstance;
let baseUrl: string;
let home: string;
let docsDir: string;
let admin: TestUser;
let member: TestUser;
const savedEnv = { HOME: process.env.HOME, LORE_TOKEN: process.env.LORE_TOKEN, LORE_URL: process.env.LORE_URL };

beforeAll(async () => {
  app = await buildServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  docsDir = mkdtempSync(join(tmpdir(), 'lore-cli-docs-'));
  mkdirSync(join(docsDir, 'svc'));
  writeFileSync(join(docsDir, 'svc', 'intro.md'), '---\nslug: svc/intro\n---\n# Intro\n\nHello.\n');
});
afterAll(async () => {
  rmSync(docsDir, { recursive: true, force: true });
  await app.close();
});
beforeEach(async () => {
  await cleanDb();
  admin = await createTestUser({ role: 'admin' });
  member = await createTestUser({ role: 'member' });
  home = mkdtempSync(join(tmpdir(), 'lore-cli-home-'));
  process.env.HOME = home;
  delete process.env.LORE_TOKEN;
  delete process.env.LORE_URL;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const me = (token: string) => app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });

/** Runs `lore <args>` in-process. `process.exit` throws `exit <code>` instead of exiting. */
async function lore(...args: string[]): Promise<{ errors: string[]; exit?: string }> {
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((m: unknown) => void errors.push(String(m)));
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
  const program = new Command().exitOverride();
  registerClientCommands(program);
  try {
    await program.parseAsync(['node', 'lore', ...args]);
    return { errors };
  } catch (e) {
    return { errors, exit: (e as Error).message };
  }
}

function approvingIo(cookie: string, approve = true) {
  const printed: string[] = [];
  const io = {
    print: (s: string) => void printed.push(s),
    open: async (u: string) => {
      // The link carries no code: the person types the one the CLI printed.
      expect(new URL(u).search).toBe('');
      const code = printed.join('\n').match(/[B-Z]{4}-[B-Z]{4}/g)!.at(-1)!;
      const r = await app.inject({ method: 'POST', url: '/api/cli/login/approve', headers: { cookie }, payload: { user_code: code, approve } });
      expect(r.statusCode).toBe(204);
    },
    sleep: async () => {},
  };
  return { io, printed };
}

describe('lore login / logout / whoami', () => {
  it('device login stores the approved token for the url', async () => {
    const { io, printed } = approvingIo(member.cookie);
    const creds = await login({ url: `${baseUrl}/` }, io, {}, home);
    expect(creds).toEqual({ url: baseUrl, token: expect.stringMatching(/^sk_/) });
    expect(readCredentials(home)).toEqual(creds);
    expect(printed.join('\n')).toMatch(/[B-Z]{4}-[B-Z]{4}/);
    await expect(me(creds.token).then((r) => r.json())).resolves.toMatchObject({ kind: 'user', login: member.login });
    const tokens = await createPgIdentity({}).tokens.listByUser(member.id);
    expect(tokens.filter((t) => t.name === `cli-${cliHostname()}`)).toHaveLength(1);
  });

  it('a denied device login stores nothing', async () => {
    const { io } = approvingIo(member.cookie, false);
    await expect(deviceLogin(baseUrl, 'devbox', io)).rejects.toThrow(/denied/);
    await expect(login({ url: baseUrl }, io, {}, home)).rejects.toThrow(/denied/);
    expect(readCredentials(home)).toBeNull();
  });

  it('login --token checks the token and stores it; a bad token is not stored', async () => {
    const io = { print: () => {}, open: async () => {}, sleep: async () => {} };
    await expect(login({ url: baseUrl, token: 'sk_wrong' }, io, {}, home)).rejects.toThrow(/401/);
    expect(readCredentials(home)).toBeNull();
    // A pre-existing 644 file ends up 600
    mkdirSync(join(home, '.config', 'lore'), { recursive: true });
    writeFileSync(credentialsPath(home), '{}', { mode: 0o644 });
    await login({ url: baseUrl, token: member.token }, io, {}, home);
    expect(readCredentials(home)).toEqual({ url: baseUrl, token: member.token });
    const { statSync } = await import('fs');
    expect(statSync(credentialsPath(home)).mode & 0o777).toBe(0o600);
  });

  it('logout revokes the token server-side and deletes the file', async () => {
    writeCredentials({ url: baseUrl, token: member.token }, home);
    expect((await me(member.token)).statusCode).toBe(200);
    const printed: string[] = [];
    await logout((s) => printed.push(s), home);
    expect((await me(member.token)).statusCode).toBe(401);
    expect(existsSync(credentialsPath(home))).toBe(false);
    expect(printed.join('\n')).toContain(`Logged out of ${baseUrl}`);
  });

  it('logout still deletes the file when the server fails', async () => {
    writeCredentials({ url: 'http://127.0.0.1:1', token: member.token }, home);
    const printed: string[] = [];
    await logout((s) => printed.push(s), home);
    expect(existsSync(credentialsPath(home))).toBe(false);
    expect(printed.join('\n')).toMatch(/warning/i);
    expect((await me(member.token)).statusCode).toBe(200);
  });

  it('whoami prints the user, the admin key and, for an lpk_, the namespace', async () => {
    writeCredentials({ url: baseUrl, token: admin.token }, home);
    expect(await whoami({}, {}, home)).toBe(`${admin.login} (admin) at ${baseUrl}`);
    expect(await whoami({}, { LORE_URL: baseUrl, LORE_TOKEN: TEST_API_KEY }, home)).toBe(`admin key at ${baseUrl}`);
    await createNamespace({ url: baseUrl, token: admin.token }, 'pay', 'Payments');
    const { key } = await createProjectKey({ url: baseUrl, token: admin.token }, 'pay', 'ci');
    expect(await whoami({}, { LORE_URL: baseUrl, LORE_TOKEN: key }, home)).toBe(`project key "ci" for namespace pay at ${baseUrl}`);
  });

  it('whoami against another server says not logged in', async () => {
    writeCredentials({ url: baseUrl, token: admin.token }, home);
    await expect(whoami({ url: 'http://127.0.0.1:1' }, {}, home)).rejects.toThrow('not logged in to http://127.0.0.1:1');
  });
});

describe('lore push and images', () => {
  it('push with LORE_TOKEN=lpk_ works; push without credentials exits with the not-logged-in message', async () => {
    await createNamespace({ url: baseUrl, token: admin.token }, 'pay', 'Payments');
    const { key } = await createProjectKey({ url: baseUrl, token: admin.token }, 'pay', 'ci');

    const none = await lore('push', docsDir, '-l', 'svc', '-v', 'v1', '--no-enrich', '--url', baseUrl);
    expect(none.exit).toBe('exit 1');
    expect(none.errors.join('\n')).toContain(`not logged in to ${baseUrl}: run lore login --url ${baseUrl}`);

    process.env.LORE_URL = baseUrl;
    process.env.LORE_TOKEN = key;
    const ok = await lore('push', docsDir, '-l', 'svc', '-v', 'v1', '--no-enrich');
    expect(ok).toEqual({ errors: [] });
    const ns = await listNamespaces({ url: baseUrl, token: admin.token });
    expect(ns.find((n) => n.id === 'pay')?.libraries).toEqual(['svc']);
  });

  it('an admin push creates a new library in --namespace', async () => {
    await createNamespace({ url: baseUrl, token: admin.token }, 'shop', 'Shop');
    writeCredentials({ url: baseUrl, token: admin.token }, home);
    expect(await lore('push', docsDir, '-l', 'cart', '-v', 'v1', '--no-enrich', '--namespace', 'shop')).toEqual({ errors: [] });
    const ns = await listNamespaces({ url: baseUrl, token: admin.token });
    expect(ns.find((n) => n.id === 'shop')?.libraries).toEqual(['cart']);
  });

  it('images ls uses the stored credentials', async () => {
    writeCredentials({ url: baseUrl, token: admin.token }, home);
    await lore('push', docsDir, '-l', 'svc', '-v', 'v1', '--no-enrich');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    expect(await lore('images', 'ls', 'svc/intro', '-l', 'svc')).toEqual({ errors: [] });
    expect(logs.join('\n')).toContain('No images for "svc/intro" in version v1.');
  });

  it('an incremental push that drops links and metadata from a document drops them on the server', async () => {
    writeCredentials({ url: baseUrl, token: admin.token }, home);
    const dir = mkdtempSync(join(tmpdir(), 'lore-cli-links-'));
    try {
      writeFileSync(join(dir, 'a.md'), '---\nslug: a\nlinks:\n  - slug: b\n---\nReads table: orders_tbl\n');
      writeFileSync(join(dir, 'b.md'), '---\nslug: b\n---\nB\n');
      expect(await lore('push', dir, '-l', 'lnk', '-v', 'v1', '--no-enrich')).toEqual({ errors: [] });
      writeFileSync(join(dir, 'a.md'), '---\nslug: a\n---\nNo tables any more\n');
      expect(await lore('push', dir, '-l', 'lnk', '-v', 'v2', '--no-enrich')).toEqual({ errors: [] });

      const db = getDb();
      const links = await db.execute(sql`
        select l.to_slug from document_links l join documents d on d.id = l.from_document_id
        where d.library_id = 'lnk' and d.version_id = 'v2' and d.slug = 'a'`);
      const meta = await db.execute(sql`
        select m.key from document_metadata m join documents d on d.id = m.document_id
        where d.library_id = 'lnk' and d.version_id = 'v2' and d.slug = 'a'`);
      expect([...links]).toEqual([]);
      expect([...meta]).toEqual([]);

      // A third push with nothing changed uploads nothing: the stored hash matches the local one.
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
      expect(await lore('push', dir, '-l', 'lnk', '-v', 'v3', '--no-enrich')).toEqual({ errors: [] });
      expect(logs.join('\n')).toContain('Nothing changed.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushing the same version again diffs against that version: nothing to upload, deleted docs removed', async () => {
    writeCredentials({ url: baseUrl, token: admin.token }, home);
    const dir = mkdtempSync(join(tmpdir(), 'lore-cli-repush-'));
    try {
      writeFileSync(join(dir, 'a.md'), '---\nslug: a\n---\nA\n');
      writeFileSync(join(dir, 'b.md'), '---\nslug: b\n---\nB\n');
      expect(await lore('push', dir, '-l', 'rep', '-v', 'v1', '--no-enrich')).toEqual({ errors: [] });

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
      expect(await lore('push', dir, '-l', 'rep', '-v', 'v1', '--no-enrich')).toEqual({ errors: [] });
      expect(logs.join('\n')).toContain('Nothing changed.');
      expect(logs.join('\n')).toContain('2 unchanged, 0 updated/new');

      // The same holds for a version that is not current (a branch pushed with --no-promote).
      expect(await lore('push', dir, '-l', 'rep', '-v', 'feat-1', '--branch', 'feat', '--no-promote', '--no-enrich')).toEqual({ errors: [] });
      rmSync(join(dir, 'b.md'));
      logs.length = 0;
      expect(await lore('push', dir, '-l', 'rep', '-v', 'feat-1', '--branch', 'feat', '--no-promote', '--no-enrich')).toEqual({ errors: [] });
      expect(logs.join('\n')).toContain('1 unchanged, 0 updated/new, 1 deleted');
      const slugs = await getDb().execute(sql`
        select slug from documents where library_id = 'rep' and version_id = 'feat-1' order by slug`);
      expect([...slugs].map((r) => r.slug)).toEqual(['a']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushing an existing version with another --branch moves it to that branch (a fast-forward merge)', async () => {
    writeCredentials({ url: baseUrl, token: admin.token }, home);
    expect(await lore('push', docsDir, '-l', 'br', '-v', 'v1', '--branch', 'feature/x', '--no-promote', '--no-enrich')).toEqual({ errors: [] });
    expect(await lore('push', docsDir, '-l', 'br', '-v', 'v1', '--branch', 'main', '--no-enrich')).toEqual({ errors: [] });
    const rows = await getDb().execute(sql`select branch, is_current from versions where library_id = 'br'`);
    expect([...rows]).toEqual([{ branch: 'main', is_current: true }]);
    const doc = await app.inject({ url: '/api/document?library_id=br&branch=main&slug=svc/intro', headers: { authorization: `Bearer ${admin.token}` } });
    expect(doc.statusCode).toBe(200);
  });

  it('an empty --branch (an unset GIT_BRANCH) pushes a version without a branch', async () => {
    writeCredentials({ url: baseUrl, token: admin.token }, home);
    expect(await lore('push', docsDir, '-l', 'nob', '-v', 'v1', '--branch', '', '--no-enrich')).toEqual({ errors: [] });
    const rows = await getDb().execute(sql`select branch from versions where library_id = 'nob'`);
    expect([...rows].map((x) => x.branch)).toEqual([null]);
  });

  it('the -k/--api-key flag is gone', async () => {
    const r = await lore('push', docsDir, '-l', 'svc', '-v', 'v1', '-k', 'x');
    expect(r.exit).toMatch(/unknown option/);
  });
});

describe('lore namespace / project-key', () => {
  it('admin namespace/project-key commands work with an admin sk_ and fail 403 with a member sk_', async () => {
    const a = { url: baseUrl, token: admin.token };
    const m = { url: baseUrl, token: member.token };
    await createTestLibrary('orders');

    expect(await createNamespace(a, 'pay', 'Payments')).toMatchObject({ id: 'pay', display_name: 'Payments' });
    expect((await listNamespaces(a)).map((n) => n.id)).toEqual(expect.arrayContaining(['default', 'insights', 'pay']));
    expect(await assignLibrary(a, 'orders', 'pay')).toEqual({ id: 'orders', namespace_id: 'pay' });
    expect((await listNamespaces(a)).find((n) => n.id === 'pay')?.libraries).toEqual(['orders']);

    const k = await createProjectKey(a, 'pay', 'ci', 'orders');
    expect(k).toMatchObject({ namespace_id: 'pay', library_id: 'orders', key: expect.stringMatching(/^lpk_/) });
    expect((await listProjectKeys(a, 'pay')).map((x) => x.id)).toEqual([k.id]);
    expect(await listProjectKeys(a, 'default')).toEqual([]);
    await revokeProjectKey(a, k.id);
    expect((await listProjectKeys(a))[0].revoked_at).not.toBeNull();

    for (const call of [
      () => createNamespace(m, 'x', 'X'),
      () => listNamespaces(m),
      () => assignLibrary(m, 'orders', 'default'),
      () => createProjectKey(m, 'pay', 'ci'),
      () => listProjectKeys(m),
      () => revokeProjectKey(m, k.id),
    ]) {
      const e = await call().catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
    }
  });

  it('the commands print what they did', async () => {
    writeCredentials({ url: baseUrl, token: admin.token }, home);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    expect(await lore('namespace', 'create', 'pay', '-n', 'Payments')).toEqual({ errors: [] });
    expect(await lore('namespace', 'list')).toEqual({ errors: [] });
    expect(await lore('project-key', 'create', 'pay', '-n', 'ci')).toEqual({ errors: [] });
    expect(await lore('project-key', 'list', '--namespace', 'pay')).toEqual({ errors: [] });
    const out = logs.join('\n');
    expect(out).toContain('pay');
    expect(out).toMatch(/lpk_/);
    const withUrl = await lore('namespace', 'list', '--url', baseUrl);
    expect(withUrl).toEqual({ errors: [] });
    writeCredentials({ url: baseUrl, token: member.token }, home);
    const forbidden = await lore('namespace', 'list');
    expect(forbidden.exit).toBe('exit 1');
    expect(forbidden.errors.join('\n')).toContain('403');
  });
});

describe('lore link-sso / unlink-sso', () => {
  it('links and unlinks a user to an OIDC subject in the database', async () => {
    const { ssoLinkCommand } = await import('../../platform/server-commands.js');
    const env = { OIDC_ISSUER: 'https://id.example', OIDC_CLIENT_ID: 'lore', OIDC_CLIENT_SECRET: 's', PUBLIC_URL: 'https://lore.example' };
    expect(await ssoLinkCommand({ link: true, login: member.login, sub: 'sub-1' }, env)).toBe(`Linked ${member.login} to sub-1 at https://id.example`);
    const users = createPgIdentity({}).users;
    expect(await users.findBySubject('https://id.example', 'sub-1')).toMatchObject({ id: member.id });
    await expect(ssoLinkCommand({ link: true, login: admin.login, sub: 'sub-1' }, env)).rejects.toThrow(/already linked/);
    await expect(ssoLinkCommand({ link: true, login: 'nobody', sub: 'sub-2' }, env)).rejects.toThrow(/no user/);
    expect(await ssoLinkCommand({ link: false, login: member.login }, env)).toBe(`Unlinked ${member.login} from single sign-on`);
    expect(await users.findBySubject('https://id.example', 'sub-1')).toBeNull();
  });
});
