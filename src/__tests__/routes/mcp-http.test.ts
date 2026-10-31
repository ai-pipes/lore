import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { sql } from 'drizzle-orm';
import { createMcpHttpHandler, mcpOptionsFromEnv } from '../../platform/mcp/server.js';
import { getDb } from '../../platform/db.js';
import { cleanDb, createTestUser, TEST_API_KEY, type TestUser } from '../helpers.js';

let server: http.Server;
let port: number;
let user: TestUser;

beforeAll(async () => {
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  // The real authenticator: sk_ tokens from the database, LORE_API_KEY as admin
  server.on('request', createMcpHttpHandler({ ...mcpOptionsFromEnv(port), host: '127.0.0.1' }));
});

beforeEach(async () => {
  await cleanDb();
  user = await createTestUser();
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Raw request so we can set arbitrary Host/Origin headers. Resolves on headers. */
function request(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: { host: `localhost:${port}`, ...opts.headers } }, (res) => {
      const isStream = String(res.headers['content-type']).includes('text/event-stream') && opts.method !== 'POST';
      let body = '';
      res.on('data', (c) => {
        body += c;
        if (isStream) { req.destroy(); resolve({ status: res.statusCode!, headers: res.headers, body }); }
      });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const ADMIN = { authorization: `Bearer ${TEST_API_KEY}` };
const initialize = (headers: Record<string, string>) =>
  request('/mcp', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }),
  });

describe('MCP HTTP server security', () => {
  it('rejects requests without a bearer token', async () => {
    const res = await request('/sse');
    expect(res.status).toBe(401);
  });

  it('accepts a user sk_ token', async () => {
    const res = await initialize(user.bearer);
    expect(res.status).toBe(200);
    expect(res.body).toContain('"serverInfo"');
  });

  it('accepts LORE_API_KEY', async () => {
    expect((await initialize(ADMIN)).status).toBe(200);
    expect((await request('/sse', { headers: ADMIN })).status).toBe(200);
  });

  it('rejects lpk_, revoked, disabled-owner and unknown tokens with 401', async () => {
    const revoked = await createTestUser();
    await getDb().execute(sql`update api_tokens set revoked_at = now() where user_id = ${revoked.id}`);
    const disabled = await createTestUser();
    await getDb().execute(sql`update users set disabled = true where id = ${disabled.id}`);
    const cases = [
      { authorization: 'Bearer lpk_' + 'A'.repeat(43) },
      revoked.bearer,
      disabled.bearer,
      { authorization: 'Bearer sk_' + 'B'.repeat(43) },
      { authorization: 'Bearer nope' },
      { authorization: `Basic ${Buffer.from('a:b').toString('base64')}` },
      { authorization: 'Bearer ' },
    ];
    for (const headers of cases) {
      for (const res of [await initialize(headers), await request('/sse', { headers })]) {
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toBe('Bearer');
      }
    }
    // re-enabling the owner restores the token
    await getDb().execute(sql`update users set disabled = false where id = ${disabled.id}`);
    expect((await initialize(disabled.bearer)).status).toBe(200);
  });

  it('records the use of an sk_ token', async () => {
    await initialize(user.bearer);
    const rows = (await getDb().execute(sql`select last_used_at from api_tokens where user_id = ${user.id}`)) as unknown as { last_used_at: Date | null }[];
    expect(rows[0].last_used_at).not.toBeNull();
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    expect((await request('/sse', { headers: { ...user.bearer, host: 'evil.example.com' } })).status).toBe(403);
  });

  it('rejects browser requests from other origins', async () => {
    expect((await request('/sse', { headers: { ...user.bearer, origin: 'https://evil.example.com' } })).status).toBe(403);
  });

  it('opens an SSE stream with a valid token and sends no wildcard CORS header', async () => {
    const res = await request('/sse', { headers: user.bearer });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.body).toContain('event: endpoint');
  });

  it('a legacy SSE session takes messages only from the principal that opened it', async () => {
    const other = await createTestUser();
    // Keep the stream open and read the endpoint (with the session id) from it
    const stream = await new Promise<{ endpoint: string; close: () => void }>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/sse', headers: { host: `localhost:${port}`, ...user.bearer } }, (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          const m = /event: endpoint\ndata: (\S+)/.exec(buf);
          if (m) resolve({ endpoint: m[1], close: () => req.destroy() });
        });
      });
      req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
    });
    try {
      const message = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
      const post = (headers: Record<string, string>) =>
        request(stream.endpoint, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: message });
      expect((await post(other.bearer)).status).toBe(404);
      expect((await post(ADMIN)).status).toBe(404);
      expect((await post(user.bearer)).status).toBe(202);
    } finally {
      stream.close();
    }
  });

  it('builds without single sign-on: a partial OIDC env does not break MCP', () => {
    process.env.OIDC_ISSUER = 'https://id.example.com';
    try {
      expect(() => createMcpHttpHandler({ ...mcpOptionsFromEnv(port), host: '127.0.0.1' })).not.toThrow();
    } finally {
      delete process.env.OIDC_ISSUER;
    }
  });

  it('serves Streamable HTTP initialize on /mcp', async () => {
    const res = await initialize(user.bearer);
    expect(res.status).toBe(200);
    expect(res.body).toContain('"serverInfo"');
    expect(res.body).toContain('lore');
  });
});

describe('mcpOptionsFromEnv', () => {
  it('binds to 127.0.0.1 by default and needs no key', async () => {
    const opts = mcpOptionsFromEnv(4738, { LORE_MCP_API_KEY: 'dedicated' });
    expect(opts.host).toBe('127.0.0.1');
    expect(opts).not.toHaveProperty('apiKey');
    // LORE_MCP_API_KEY is no longer a credential
    expect(await opts.authenticate('Bearer dedicated')).toBeNull();
    expect(await opts.authenticate(undefined)).toBeNull();
  });

  it('accepts LORE_API_KEY as the admin key', async () => {
    const opts = mcpOptionsFromEnv(4738, { LORE_API_KEY: 'a-strong-admin-key-for-tests-123' });
    expect(await opts.authenticate('Bearer a-strong-admin-key-for-tests-123')).toEqual({ kind: 'admin-key' });
    expect(await mcpOptionsFromEnv(4738, {}).authenticate('Bearer ')).toBeNull();
  });
});
