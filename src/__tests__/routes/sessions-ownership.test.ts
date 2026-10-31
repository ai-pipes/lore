/** Per-user chat history: every session route is scoped to its owner; insights record their author. */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

const { mockComplete, mockStream } = vi.hoisted(() => ({ mockComplete: vi.fn(), mockStream: vi.fn() }));
vi.mock('../../modules/llm/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../modules/llm/index.js')>()),
  // The server's one LanguageModel: `complete` writes the insight summaries.
  createLanguageModel: vi.fn(() => ({ configured: () => true, complete: mockComplete, stream: mockStream })),
}));

import { buildServer } from '../../platform/http/server.js';
import { getDb } from '../../platform/db.js';
import { getDocumentBySlug } from '../../modules/catalog/infrastructure/pg-documents.js';
import { cleanDb, createTestUser, type TestUser } from '../helpers.js';

let app: FastifyInstance;
let a: TestUser;
let b: TestUser;
let admin: TestUser;

const ROUTES = (id: string) =>
  [
    ['GET', `/api/sessions/${id}`],
    ['PATCH', `/api/sessions/${id}`],
    ['DELETE', `/api/sessions/${id}`],
    ['POST', `/api/sessions/${id}/messages`],
    ['POST', `/api/sessions/${id}/publish`],
  ] as const;

const PAYLOADS: Record<string, object | undefined> = {
  [`PATCH`]: { title: 'stolen' },
  [`POST messages`]: { role: 'user', content: 'injected' },
  [`POST publish`]: {},
};

function payloadFor(method: string, url: string): object | undefined {
  if (method === 'PATCH') return PAYLOADS.PATCH;
  if (url.endsWith('/messages')) return PAYLOADS['POST messages'];
  if (url.endsWith('/publish')) return PAYLOADS['POST publish'];
  return undefined;
}

async function sessionOf(user: TestUser, content = 'How do refunds work?'): Promise<string> {
  const s = await app.inject({ method: 'POST', url: '/api/sessions', headers: user.bearer, payload: { title: 'Mine' } });
  expect(s.statusCode).toBe(201);
  const id = s.json().id as string;
  const m = await app.inject({ method: 'POST', url: `/api/sessions/${id}/messages`, headers: user.bearer, payload: { role: 'user', content } });
  expect(m.statusCode).toBe(201);
  return id;
}

beforeAll(async () => {
  app = await buildServer();
});

beforeEach(async () => {
  mockComplete.mockReset();
  mockComplete.mockResolvedValue('Refund insights\n\nRefunds are async.');
  await cleanDb();
  a = await createTestUser({ displayName: 'Alice' });
  b = await createTestUser({ displayName: 'Bob' });
  admin = await createTestUser({ role: 'admin', displayName: 'Ada Admin' });
});

describe('chat session ownership', () => {
  it.each(ROUTES('placeholder').map(([m, url]) => [m, url.replace('/api/sessions/placeholder', '')]))(
    "%s /api/sessions/:id%s on another user's session is 404 and changes nothing",
    async (method, suffix) => {
      const id = await sessionOf(a);
      const before = (await app.inject({ method: 'GET', url: `/api/sessions/${id}`, headers: a.bearer })).json();
      const url = `/api/sessions/${id}${suffix}`;
      for (const intruder of [b, admin]) {
        const res = await app.inject({ method, url, headers: intruder.bearer, payload: payloadFor(method, url) });
        expect(res.statusCode).toBe(404);
      }
      const after = await app.inject({ method: 'GET', url: `/api/sessions/${id}`, headers: a.bearer });
      expect(after.statusCode).toBe(200);
      expect(after.json()).toEqual(before);
      expect(mockComplete).not.toHaveBeenCalled();
      expect(await getDocumentBySlug('insights', `insight/${id}`)).toBeFalsy();
    },
  );

  it('list shows only own sessions', async () => {
    const id = await sessionOf(a);
    const listA = await app.inject({ method: 'GET', url: '/api/sessions', headers: a.bearer });
    expect(listA.json().map((s: { id: string }) => s.id)).toEqual([id]);
    const listB = await app.inject({ method: 'GET', url: '/api/sessions', headers: b.bearer });
    expect(listB.json()).toEqual([]);
  });

  it('a web session and an sk_ token of the same user see the same history', async () => {
    const id = await sessionOf(a);
    const viaCookie = await app.inject({ method: 'GET', url: '/api/sessions', headers: { cookie: a.cookie } });
    expect(viaCookie.json().map((s: { id: string }) => s.id)).toEqual([id]);
  });

  it('publish records the author', async () => {
    const id = await sessionOf(a);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${id}/publish`, headers: a.bearer, payload: {} });
    expect(res.statusCode).toBe(200);
    const doc = await getDocumentBySlug('insights', `insight/${id}`);
    expect(doc).toMatchObject({ author_user_id: a.id, author_name: 'Alice' });

    const read = await app.inject({ method: 'GET', url: `/api/document?library_id=insights&slug=insight/${id}`, headers: b.bearer });
    expect(read.statusCode).toBe(200);
    expect(read.json().author).toEqual({ user_id: a.id, name: 'Alice' });
  });

  it('a document without an author has author null', async () => {
    const id = await sessionOf(a);
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/publish`, headers: a.bearer, payload: {} });
    await getDb().execute(sql`UPDATE documents SET author_user_id = NULL, author_name = NULL`);
    const read = await app.inject({ method: 'GET', url: `/api/document?library_id=insights&slug=insight/${id}`, headers: b.bearer });
    expect(read.json().author).toBeNull();
  });

  it('deleting the author keeps the insight and its author name', async () => {
    const id = await sessionOf(a);
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/publish`, headers: a.bearer, payload: {} });
    await getDb().execute(sql`DELETE FROM users WHERE id = ${a.id}`);
    expect(await getDocumentBySlug('insights', `insight/${id}`)).toMatchObject({ author_user_id: null, author_name: 'Alice' });
    const left = await getDb().execute(sql`SELECT count(*)::int AS n FROM chat_sessions WHERE id = ${id}`);
    expect((left as unknown as Array<{ n: number }>)[0].n).toBe(0);
  });

  it('member cannot choose a slug (403); admin can', async () => {
    const mine = await sessionOf(a);
    const denied = await app.inject({ method: 'POST', url: `/api/sessions/${mine}/publish`, headers: a.bearer, payload: { slug: 'team/refunds' } });
    expect(denied.statusCode).toBe(403);
    expect(await getDocumentBySlug('insights', 'team/refunds')).toBeFalsy();

    const adminSession = await sessionOf(admin);
    const allowed = await app.inject({ method: 'POST', url: `/api/sessions/${adminSession}/publish`, headers: admin.bearer, payload: { slug: 'team/refunds' } });
    expect(allowed.statusCode).toBe(200);
    expect(await getDocumentBySlug('insights', 'team/refunds')).toMatchObject({ author_user_id: admin.id, author_name: 'Ada Admin' });
  });

  it('migration dropped legacy chats and user_id is NOT NULL', async () => {
    const col = await getDb().execute(sql`
      SELECT is_nullable FROM information_schema.columns WHERE table_name = 'chat_sessions' AND column_name = 'user_id'`);
    expect((col as unknown as Array<{ is_nullable: string }>)[0]?.is_nullable).toBe('NO');
    const migration = await import('fs').then((fs) => fs.readFileSync('drizzle/0010_chat_ownership.sql', 'utf8'));
    expect(migration).toMatch(/DELETE FROM chat_messages/);
    expect(migration).toMatch(/DELETE FROM chat_sessions/);
    await expect(getDb().execute(sql`INSERT INTO chat_sessions (title) VALUES ('orphan')`)).rejects.toThrow();
    const authorCols = await getDb().execute(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name IN ('author_user_id', 'author_name') ORDER BY column_name`);
    expect(authorCols as unknown as unknown[]).toEqual([
      { column_name: 'author_name', is_nullable: 'YES' },
      { column_name: 'author_user_id', is_nullable: 'YES' },
    ]);
  });
});
