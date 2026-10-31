import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Rejects malformed input with 400 before any route sees it, instead of letting it reach Postgres
 * (a NUL byte is "invalid byte sequence", a repeated parameter becomes an array where the route
 * expects a string, deep JSON overflows recursive code):
 * - route params and query values: no C0 control character except tab, newline and carriage return;
 * - query parameters: each at most once (no route takes a list as repeated parameters);
 * - JSON bodies: no NUL in any string or key (Postgres cannot store it; other control characters
 *   stay, they are legitimate in pushed Markdown), nested at most MAX_JSON_DEPTH levels.
 */
export const MAX_JSON_DEPTH = 32;

/** A C0 control character other than tab (9), newline (10) and carriage return (13). */
function hasControlCharacter(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) return true;
  }
  return false;
}

function checkScalars(where: 'Route parameter' | 'Query parameter', values: unknown): string | null {
  if (!values || typeof values !== 'object') return null;
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) return `${where} "${name}" is given more than once`;
    if (typeof value === 'string' && hasControlCharacter(value)) return `${where} "${name}" contains a control character`;
  }
  return null;
}

function checkJson(value: unknown, depth: number): string | null {
  if (typeof value === 'string') return value.includes('\u0000') ? 'JSON body contains a NUL character' : null;
  if (value === null || typeof value !== 'object' || Buffer.isBuffer(value)) return null;
  if (depth >= MAX_JSON_DEPTH) return `JSON body is nested too deep (more than ${MAX_JSON_DEPTH} levels)`;
  const entries = Array.isArray(value) ? value.map((v) => ['', v] as const) : Object.entries(value);
  for (const [key, child] of entries) {
    if (key.includes('\u0000')) return 'JSON body contains a NUL character';
    const problem = checkJson(child, depth + 1);
    if (problem) return problem;
  }
  return null;
}

/** The first problem with the request's params, query string and JSON body, or null. */
export function malformedInput(request: Pick<FastifyRequest, 'params' | 'query' | 'body'>): string | null {
  return checkScalars('Route parameter', request.params)
    ?? checkScalars('Query parameter', request.query)
    ?? checkJson(request.body, 0);
}

/** preValidation hook: 400 with the reason for malformed input. */
export async function rejectMalformedInput(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const problem = malformedInput(request);
  if (problem) return reply.code(400).send({ error: problem });
}
