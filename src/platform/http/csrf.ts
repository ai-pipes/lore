/**
 * CSRF protection for state-changing requests (POST/PUT/PATCH/DELETE).
 *
 * Browsers attach Origin and Sec-Fetch-Site to cross-site requests; non-browser
 * clients (lore push, curl, CI) send neither and are unaffected. A request is
 * rejected when Sec-Fetch-Site is "cross-site", or when Origin is present and
 * its host differs from the Host header and is not in LORE_ALLOWED_ORIGINS
 * (comma-separated origins, e.g. for a reverse proxy that rewrites Host).
 * This applies whether a request is authenticated by cookie, by bearer, or
 * not at all.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isCrossSite(request: FastifyRequest): boolean {
  const site = request.headers['sec-fetch-site'];
  if (site === 'cross-site') return true;
  const origin = request.headers.origin;
  if (!origin) return false;
  const allowed = (process.env.LORE_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (allowed.includes(origin)) return false;
  if (origin === 'null') return true;
  try {
    return new URL(origin).host.toLowerCase() !== String(request.headers.host ?? '').toLowerCase();
  } catch {
    return true;
  }
}

export async function rejectCrossSiteWrites(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!STATE_CHANGING.has(request.method)) return;
  if (isCrossSite(request)) {
    return reply.code(403).send({ error: 'Cross-site request rejected' });
  }
}
