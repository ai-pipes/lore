import type { FastifyRequest } from 'fastify';

/** `LORE_COOKIE_SECURE=true` marks every cookie `Secure` (for a TLS-terminating proxy). */
export function cookieSecureFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  return env.LORE_COOKIE_SECURE === 'true';
}

/** Cookies get `Secure` when configured, or when the request itself came over https. */
export function isSecureRequest(req: FastifyRequest, cookieSecure: boolean): boolean {
  return cookieSecure || req.protocol === 'https';
}
