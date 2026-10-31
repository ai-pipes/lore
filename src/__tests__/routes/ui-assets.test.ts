import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../platform/http/server.js';
import { VENDOR_FILES } from '../../platform/http/ui-assets.js';
import { TEST_API_KEY } from '../helpers.js';

let app: FastifyInstance;
/** The chat page and unknown paths need a caller; the assets themselves are public. */
const AUTH = { authorization: `Bearer ${TEST_API_KEY}` };
beforeAll(async () => {
  app = await buildServer();
});

describe('chat UI assets and CSP', () => {
  it('serves the page with a strict same-origin CSP without inline allowances', async () => {
    const a = await app.inject({ method: 'GET', url: '/', headers: AUTH });
    expect(a.statusCode).toBe(200);
    const csp = String(a.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("style-src 'self';");
    expect(csp).not.toContain('nonce');
    expect(a.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each(Object.keys(VENDOR_FILES))('serves vendored %s from the app', async (name) => {
    const res = await app.inject({ method: 'GET', url: `/assets/vendor/${name}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(name.endsWith('.css') ? /text\/css/ : /javascript/);
    expect(res.rawPayload.length).toBeGreaterThan(1000);
  });

  it('serves the app script and stylesheet with ETags', async () => {
    for (const url of ['/assets/lore.js', '/assets/lore.css']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      const again = await app.inject({ method: 'GET', url, headers: { 'if-none-match': String(res.headers.etag) } });
      expect(again.statusCode).toBe(304);
    }
  });

  it('does not serve arbitrary files', async () => {
    for (const url of ['/assets/vendor/..%2Fpackage.json', '/assets/vendor/package.json', '/assets/vendor/%2e%2e']) {
      expect((await app.inject({ method: 'GET', url, headers: AUTH })).statusCode).toBe(404);
    }
  });
});
