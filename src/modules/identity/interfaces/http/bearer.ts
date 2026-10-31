import type { FastifyRequest } from 'fastify';

export function extractToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length);
}
