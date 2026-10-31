import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security.js';
import { pageCsp } from './ui-assets.js';

async function app() {
  const a = Fastify();
  securityHeaders(a);
  a.get('/page', async (_req, reply) => reply.type('text/html; charset=utf-8').send('<p>hi</p>'));
  a.get('/json', async () => ({ ok: true }));
  a.get('/sandboxed', async (_req, reply) =>
    reply.type('text/html').header('Content-Security-Policy', "default-src 'none'; sandbox").send('<p>x</p>'),
  );
  return a;
}

describe('securityHeaders', () => {
  it('sets the baseline headers and the page CSP on HTML responses', async () => {
    const res = await (await app()).inject({ url: '/page' });
    expect(res.headers['content-security-policy']).toBe(pageCsp());
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('does not set the page CSP on non-HTML responses', async () => {
    const res = await (await app()).inject({ url: '/json' });
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('keeps a stricter CSP a route set itself on an HTML response', async () => {
    const res = await (await app()).inject({ url: '/sandboxed' });
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
  });
});
