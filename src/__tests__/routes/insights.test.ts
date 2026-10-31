import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';

const { mockComplete, mockStream } = vi.hoisted(() => ({ mockComplete: vi.fn(), mockStream: vi.fn() }));
vi.mock('../../modules/llm/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../modules/llm/index.js')>()),
  // The server's one LanguageModel: `complete` writes the insight summaries.
  createLanguageModel: vi.fn(() => ({ configured: () => true, complete: mockComplete, stream: mockStream })),
}));

import { buildServer } from '../../platform/http/server.js';
import { push } from '../../cli/push.js';
import { cleanDb, createTestUser, TEST_API_KEY, type TestUser } from '../helpers.js';
import { getDocumentBySlug } from '../../modules/catalog/infrastructure/pg-documents.js';
import { getDb } from '../../platform/db.js';
import { document_links } from '../../modules/catalog/infrastructure/schema.js';
import { eq, sql } from 'drizzle-orm';

let app: FastifyInstance;
let baseUrl: string;
let docsDir: string;
const ADMIN = { authorization: `Bearer ${TEST_API_KEY}` };
/** Chat routes are for signed-in users: a member and their `sk_` token. */
let member: TestUser;
let USER: { authorization: string };

function writeDoc(slug: string, body: string) {
  const file = join(docsDir, `${slug}.md`);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `---\nslug: ${slug}\ndomain: orders\nsummary: ${body}\n---\n\n# ${slug}\n\n${body}\n`);
}

beforeAll(async () => {
  app = await buildServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(async () => {
  await app.close();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await cleanDb();
  member = await createTestUser({ displayName: 'Mia Member' });
  USER = member.bearer;
  docsDir = mkdtempSync(join(tmpdir(), 'lore-insights-'));
  mockComplete.mockReset();
  mockComplete.mockResolvedValue('Refunds after delivery\n\nAdoption fees are refunded within 14 days. [ref:orders-api/orders/refund-order]');
});

describe('insights survive service pushes', () => {
  it('publish, then push the service again with docs removed: the insight and its links remain', async () => {
    writeDoc('orders/refund-order', 'Refund a delivered order within 14 days');
    writeDoc('orders/place-order', 'Place an order');
    await push({ dir: docsDir, library: 'orders-api', version: 'sha-1', baseUrl, token: TEST_API_KEY, noEnrich: true });

    const s = await app.inject({ method: 'POST', url: '/api/sessions', headers: USER, payload: { pinned_docs: [{ library_id: 'orders-api', slug: 'orders/place-order' }] } });
    const id = s.json().id as string;
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/messages`, headers: USER, payload: { role: 'user', content: 'How do refunds work?' } });
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/messages`, headers: USER, payload: { role: 'assistant', content: 'Within 14 days. [ref:orders-api/orders/refund-order] [ref:orders-api/does/not-exist]' } });

    const pub = await app.inject({ method: 'POST', url: `/api/sessions/${id}/publish`, headers: USER, payload: { library_id: 'orders-api' } });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().library_id).toBe('insights');

    // Next deploy of the service: one doc removed, incremental push deletes orphans
    rmSync(join(docsDir, 'orders/place-order.md'));
    await push({ dir: docsDir, library: 'orders-api', version: 'sha-2', baseUrl, token: TEST_API_KEY, noEnrich: true });
    expect(await getDocumentBySlug('orders-api', 'orders/place-order')).toBeFalsy(); // cleanup did run

    const insight = await getDocumentBySlug('insights', `insight/${id}`);
    expect(insight).toBeTruthy();
    expect(insight?.content).toContain('Adoption fees are refunded');
    expect(insight).toMatchObject({ author_user_id: member.id, author_name: 'Mia Member' });

    const links = await getDb().select().from(document_links).where(eq(document_links.from_document_id, insight!.id));
    expect(links.map((l) => `${l.to_library_id}/${l.to_slug}`).sort()).toEqual([
      'orders-api/orders/place-order', // pinned
      'orders-api/orders/refund-order', // cited
    ]);
  });

  it('creates the insights library with a current version on first publish', async () => {
    const s = await app.inject({ method: 'POST', url: '/api/sessions', headers: USER, payload: {} });
    const id = s.json().id as string;
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/messages`, headers: USER, payload: { role: 'user', content: 'q' } });
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/publish`, headers: USER, payload: {} });
    const versions = await app.inject({ method: 'GET', url: '/api/libraries/insights/versions', headers: ADMIN });
    expect(versions.json()).toEqual([expect.objectContaining({ id: 'insights', is_current: true })]);
  });
});

describe('the insights library id is reserved', () => {
  it('nobody may create the insights library by pushing (squatting), not even the admin key', async () => {
    // cleanDb removed it: a push would otherwise create it in `default`
    for (const payload of [{ id: 'insights', display_name: 'Mine' }, { id: 'insights', display_name: 'Mine', namespace_id: 'default' }]) {
      const r = await app.inject({ method: 'POST', url: '/api/libraries', headers: ADMIN, payload });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: 'this library id is reserved for insights' });
    }
    await app.inject({ method: 'POST', url: '/api/namespaces', headers: ADMIN, payload: { id: 'pay', display_name: 'Pay' } });
    const key = (await app.inject({ method: 'POST', url: '/api/project-keys', headers: ADMIN, payload: { namespace_id: 'pay', name: 'ci' } })).json();
    const byKey = await app.inject({
      method: 'POST', url: '/api/libraries', headers: { authorization: `Bearer ${key.key}` }, payload: { id: 'insights', display_name: 'Mine' },
    });
    expect(byKey.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/libraries/insights', headers: ADMIN })).statusCode).toBe(404);
  });

  it('a custom LORE_INSIGHTS_LIBRARY is created in, or moved into, the insights namespace at startup and is reserved', async () => {
    await getDb().execute(sql`insert into libraries (id, display_name, namespace_id) values ('kb-insights', 'Old', 'default')`);
    process.env.LORE_INSIGHTS_LIBRARY = 'kb-insights';
    const custom = await buildServer();
    try {
      const lib = (await custom.inject({ url: '/api/libraries/kb-insights', headers: ADMIN })).json();
      expect(lib.namespace_id).toBe('insights');
      const r = await custom.inject({ method: 'POST', url: '/api/libraries', headers: ADMIN, payload: { id: 'kb-insights', display_name: 'X' } });
      expect(r.statusCode).toBe(403);
      // the default id is an ordinary library id then
      const plain = await custom.inject({ method: 'POST', url: '/api/libraries', headers: ADMIN, payload: { id: 'insights', display_name: 'Plain' } });
      expect(plain.statusCode).toBe(201);
    } finally {
      delete process.env.LORE_INSIGHTS_LIBRARY;
      await custom.close();
    }
    await getDb().execute(sql`delete from libraries where id = 'kb-insights'`);
    const fresh = await buildServer();
    try {
      expect((await fresh.inject({ url: '/api/libraries/insights', headers: ADMIN })).json().namespace_id).toBe('insights');
    } finally {
      await fresh.close();
    }
  });
});
