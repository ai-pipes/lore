import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildServer } from '../../platform/http/server.js';
import { getDb } from '../../platform/db.js';
import { nodeSecrets } from '../../modules/identity/infrastructure/secrets.js';
import { cleanDb, createTestUser, TEST_API_KEY, type TestUser } from '../helpers.js';

let app: FastifyInstance;
let u: TestUser;

beforeAll(async () => {
  delete process.env.LORE_MCP_PUBLIC_URL;
  delete process.env.LORE_MCP_PORT;
  app = await buildServer();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await cleanDb();
  u = await createTestUser();
});

async function create(cookie: string, name = 'laptop') {
  return app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name } });
}

describe('personal tokens', () => {
  it('creates a token shown once with a claude mcp add command', async () => {
    const r = await create(u.cookie);
    expect(r.statusCode).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    const body = r.json();
    expect(body.token).toMatch(/^sk_[A-Za-z0-9_-]{43}$/);
    expect(body.mcp_command).toBe(
      `claude mcp add --transport http lore http://localhost:4738/mcp --header "Authorization: Bearer ${body.token}"`,
    );
    expect(body).toMatchObject({ name: 'laptop', prefix: body.token.slice(0, 8), last_used_at: null, revoked_at: null, expires_at: null });
    const list = (await app.inject({ url: '/api/tokens', headers: { cookie: u.cookie } })).json();
    expect(list[0]).not.toHaveProperty('token');
    for (const t of list) expect(Object.keys(t).sort()).toEqual(['created_at', 'expires_at', 'id', 'last_used_at', 'name', 'prefix', 'revoked_at']);
    expect(list.map((t: { name: string }) => t.name)).toContain('laptop');
    const rows = (await getDb().execute(sql`select hash from api_tokens where id = ${body.id}`)) as unknown as { hash: string }[];
    expect(rows[0].hash).toBe(nodeSecrets.sha256Hex(body.token));
  });

  it('the command uses LORE_MCP_PUBLIC_URL when set', async () => {
    process.env.LORE_MCP_PUBLIC_URL = 'https://mcp.example.com/mcp';
    const other = await buildServer();
    try {
      const r = await other.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: u.cookie }, payload: { name: 'x' } });
      expect(r.json().mcp_command).toContain(' https://mcp.example.com/mcp ');
    } finally {
      delete process.env.LORE_MCP_PUBLIC_URL;
      await other.close();
    }
  });

  it('rejects an empty or a too long name with 400', async () => {
    for (const payload of [{ name: '' }, { name: '  ' }, { name: 'x'.repeat(101) }, { name: 5 }, {}]) {
      const r = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: u.cookie }, payload });
      expect(r.statusCode).toBe(400);
    }
  });

  it('sk_ bearer cannot create, list or revoke tokens (session only)', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/tokens', headers: u.bearer, payload: { name: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/tokens', headers: u.bearer })).statusCode).toBe(403);
    const id = (await create(u.cookie)).json().id;
    expect((await app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers: u.bearer })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/tokens', headers: { authorization: `Bearer ${TEST_API_KEY}` } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/tokens' })).statusCode).toBe(401);
  });

  it('revokes an own token with 204; it then gets 401', async () => {
    const created = (await create(u.cookie)).json();
    const auth = { authorization: `Bearer ${created.token}` };
    expect((await app.inject({ url: '/api/auth/me', headers: auth })).statusCode).toBe(200);
    const r = await app.inject({ method: 'DELETE', url: `/api/tokens/${created.id}`, headers: { cookie: u.cookie } });
    expect(r.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/auth/me', headers: auth })).statusCode).toBe(401);
    const listed = (await app.inject({ url: '/api/tokens', headers: { cookie: u.cookie } })).json();
    expect(listed.find((t: { id: string }) => t.id === created.id).revoked_at).not.toBeNull();
    // revoking again is 404
    expect((await app.inject({ method: 'DELETE', url: `/api/tokens/${created.id}`, headers: { cookie: u.cookie } })).statusCode).toBe(404);
  });

  it('revoking another user\'s token id is 404', async () => {
    const other = await createTestUser();
    const created = (await create(other.cookie)).json();
    const r = await app.inject({ method: 'DELETE', url: `/api/tokens/${created.id}`, headers: { cookie: u.cookie } });
    expect(r.statusCode).toBe(404);
    expect((await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${created.token}` } })).statusCode).toBe(200);
    // an id that is not a UUID is 404 too, not a 500
    expect((await app.inject({ method: 'DELETE', url: '/api/tokens/not-a-uuid', headers: { cookie: u.cookie } })).statusCode).toBe(404);
  });

  it('another user\'s tokens are not listed', async () => {
    const other = await createTestUser();
    await create(other.cookie, 'theirs');
    const list = (await app.inject({ url: '/api/tokens', headers: { cookie: u.cookie } })).json();
    expect(list.map((t: { name: string }) => t.name)).not.toContain('theirs');
  });

  it('DELETE /api/tokens/current revokes the calling token', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/api/tokens/current', headers: u.bearer });
    expect(r.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/auth/me', headers: u.bearer })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/tokens/current', headers: u.bearer })).statusCode).toBe(401);
  });

  it('DELETE /api/tokens/current is 400 without a calling token, 401 anonymous', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/tokens/current', headers: { cookie: u.cookie } })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/tokens/current', headers: { authorization: `Bearer ${TEST_API_KEY}` } })).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/tokens/current' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/me', headers: u.bearer })).statusCode).toBe(200);
  });

  it('disabled user\'s token is 401 on /api, works again after enable', async () => {
    await getDb().execute(sql`update users set disabled = true where id = ${u.id}`);
    expect((await app.inject({ url: '/api/search?q=x', headers: u.bearer })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/me', headers: u.bearer })).statusCode).toBe(401);
    await getDb().execute(sql`update users set disabled = false where id = ${u.id}`);
    expect((await app.inject({ url: '/api/auth/me', headers: u.bearer })).statusCode).toBe(200);
  });

  it('last_used_at is set on use', async () => {
    const created = (await create(u.cookie)).json();
    expect(created.last_used_at).toBeNull();
    await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${created.token}` } });
    const listed = (await app.inject({ url: '/api/tokens', headers: { cookie: u.cookie } })).json();
    const t = listed.find((x: { id: string }) => x.id === created.id);
    expect(t.last_used_at).not.toBeNull();
    expect(Number.isNaN(Date.parse(t.last_used_at))).toBe(false);
  });
});

describe('Tokens page', () => {
  it('is served to a signed-in user as an account page', async () => {
    const r = await app.inject({ url: '/tokens', headers: { cookie: u.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('data-page="tokens"');
    expect(r.body).toContain('/assets/account.js');
    expect(r.body).not.toMatch(/<script>|style=/);
  });

  it('sends an anonymous browser to the sign-in page, refuses a bearer token', async () => {
    const r = await app.inject({ url: '/tokens' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/login?returnTo=%2Ftokens');
    expect((await app.inject({ url: '/tokens', headers: u.bearer })).statusCode).toBe(403);
  });

  it('the chat header links to the Tokens page', async () => {
    const r = await app.inject({ url: '/', headers: { cookie: u.cookie } });
    expect(r.body).toMatch(/<a [^>]*id="navTokens"[^>]*href="\/tokens"|<a [^>]*href="\/tokens"[^>]*id="navTokens"/);
  });
});
