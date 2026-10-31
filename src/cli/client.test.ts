import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, apiRequest } from './client.js';

interface Seen {
  method?: string;
  url?: string;
  auth?: string;
  type?: string;
  body: string;
}

let server: Server;
let baseUrl: string;
let seen: Seen;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    seen = { method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body: await readBody(req) };
    if (req.url === '/fail') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end('{"error":"forbidden"}');
    }
    if (req.url === '/empty') {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('apiRequest', () => {
  it('GETs with a bearer token and parses JSON', async () => {
    const res = await apiRequest<{ ok: boolean }>(baseUrl, '/api/x?y=1', { token: 'tok' });
    expect(res).toEqual({ ok: true });
    expect(seen).toMatchObject({ method: 'GET', url: '/api/x?y=1', auth: 'Bearer tok', body: '' });
  });

  it('sends a JSON body', async () => {
    await apiRequest(baseUrl, '/api/x', { method: 'POST', token: 'tok', json: { a: 1 } });
    expect(seen).toMatchObject({ method: 'POST', type: 'application/json', body: '{"a":1}' });
  });

  it('sends multipart form data', async () => {
    const form = new FormData();
    form.append('slug', 'a');
    await apiRequest(baseUrl, '/api/x', { method: 'POST', token: 'tok', form });
    expect(seen.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen.body).toContain('name="slug"');
  });

  it('returns undefined for an empty body', async () => {
    expect(await apiRequest(baseUrl, '/empty', { method: 'DELETE', token: 'tok' })).toBeUndefined();
  });

  it('throws ApiError with status and body on a non-2xx response', async () => {
    const e = await apiRequest(baseUrl, '/fail', { token: 'tok' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 403, body: '{"error":"forbidden"}' });
    expect((e as ApiError).message).toBe(`GET ${baseUrl}/fail failed 403: {"error":"forbidden"}`);
  });
});

describe('apiRequest without a token', () => {
  it('sends no Authorization header', async () => {
    await apiRequest(baseUrl, '/api/public', { method: 'POST', json: {} });
    expect(seen.auth).toBeUndefined();
  });
});
