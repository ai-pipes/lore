import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { sql } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import { cleanDb, TEST_API_KEY } from '../helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
});

beforeEach(cleanDb);

const AUTH = { authorization: `Bearer ${TEST_API_KEY}` };

describe('POST /api/libraries with an id that differs from a legacy library only by case', () => {
  it('answers 409 naming the existing library and creates nothing', async () => {
    await getDb().execute(sql`INSERT INTO libraries (id, display_name) VALUES ('PaymentService', 'Legacy')`);
    const res = await app.inject({ method: 'POST', url: '/api/libraries', headers: AUTH, body: { id: 'paymentservice', display_name: 'New' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('PaymentService');
    const ids = (await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries' })).json().map((l: { id: string }) => l.id);
    expect(ids).toEqual(['PaymentService']);
  });
});

describe('GET /api/libraries', () => {
  it('returns empty array initially', async () => {
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns created libraries', async () => {
    await app.inject({ method: 'POST', url: '/api/libraries', headers: AUTH, body: { id: 'svc-a', display_name: 'Service A' } });
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries' });
    const libs = res.json();
    expect(libs).toHaveLength(1);
    expect(libs[0].id).toBe('svc-a');
  });
});

describe('POST /api/libraries', () => {
  it('creates a library and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers: AUTH,
      body: { id: 'new-lib', display_name: 'New Library' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe('new-lib');
  });

  it('POST /api/libraries returns no api_key', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/libraries', headers: AUTH, body: { id: 'orders-api', display_name: 'Orders' } });
    expect(first.statusCode).toBe(201);
    expect(first.json().api_key).toBeUndefined();

    const second = await app.inject({ method: 'POST', url: '/api/libraries', headers: AUTH, body: { id: 'orders-api', display_name: 'Orders API' } });
    expect(second.statusCode).toBe(200);
    expect(second.json().api_key).toBeUndefined();
    expect(second.json().display_name).toBe('Orders API');
  });

  it('there is no rotate-key route any more', async () => {
    await app.inject({ method: 'POST', url: '/api/libraries', headers: AUTH, body: { id: 'orders-api', display_name: 'Orders' } });
    const res = await app.inject({ method: 'POST', url: '/api/libraries/orders-api/rotate-key', headers: AUTH });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers: AUTH,
      body: { display_name: 'No ID' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for an id that is not a library slug (no path traversal through the id)', async () => {
    for (const id of ['x/../../../tmp/escape', '../escape', 'Upper', 'a b', 42]) {
      const res = await app.inject({ method: 'POST', url: '/api/libraries', headers: AUTH, body: { id, display_name: 'Evil' } });
      expect(res.statusCode).toBe(400);
    }
    const list = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries' });
    expect(list.json()).toEqual([]);
  });

  it('returns 401 without API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      body: { id: 'lib', display_name: 'Lib' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with a wrong API key (an unknown token is anonymous)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers: { authorization: 'Bearer wrong-key' },
      body: { id: 'lib', display_name: 'Lib' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/libraries/:id', () => {
  it('returns the library', async () => {
    await app.inject({ method: 'POST', url: '/api/libraries', headers: AUTH, body: { id: 'find-me', display_name: 'Find Me' } });
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/find-me' });
    expect(res.statusCode).toBe(200);
    expect(res.json().display_name).toBe('Find Me');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({ headers: AUTH, method: 'GET', url: '/api/libraries/no-such' });
    expect(res.statusCode).toBe(404);
  });
});
