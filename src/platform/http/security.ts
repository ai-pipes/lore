import type { FastifyInstance } from 'fastify';
import { pageCsp } from './ui-assets.js';

/**
 * Security headers on every response, and the strict page CSP (`pageCsp()`) on every
 * `text/html` response that has none yet, so routes that render pages need not set it themselves.
 * Call on the root instance before registering routes.
 */
export function securityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    const type = reply.getHeader('content-type');
    // A route that set its own (stricter, e.g. sandboxed) policy keeps it
    if (typeof type === 'string' && type.toLowerCase().startsWith('text/html') && !reply.hasHeader('content-security-policy')) {
      reply.header('Content-Security-Policy', pageCsp());
    }
    return payload;
  });
}
