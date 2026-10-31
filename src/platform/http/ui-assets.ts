/**
 * Same-origin static assets for the chat UI and the account pages. Third-party libraries come from
 * npm dependencies: `npm run build` copies them to dist/vendor/; in
 * development they are read straight from node_modules. The UI therefore makes
 * no external requests and can run under `default-src 'self'`.
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { CHAT_CSS, CHAT_JS } from '../../modules/chat/index.js';
import { ACCOUNT_CSS, ACCOUNT_JS } from '../../modules/identity/index.js';

/** Served name → path inside node_modules. Keep in sync with build.mjs. */
export const VENDOR_FILES: Record<string, string> = {
  'marked.umd.js': 'marked/lib/marked.umd.js',
  'purify.min.js': 'dompurify/dist/purify.min.js',
  'highlight.min.js': '@highlightjs/cdn-assets/highlight.min.js',
  'github-dark.min.css': '@highlightjs/cdn-assets/styles/github-dark.min.css',
  'mermaid.min.js': 'mermaid/dist/mermaid.min.js',
};

const cache = new Map<string, { body: Buffer; etag: string }>();

function resolveVendorFile(name: string): string | null {
  const rel = VENDOR_FILES[name];
  if (!rel) return null;
  const bundleDir = process.argv[1] ? dirname(resolve(process.argv[1])) : undefined;
  const candidates = [
    process.env.LORE_VENDOR_DIR ? join(process.env.LORE_VENDOR_DIR, name) : undefined,
    bundleDir ? join(bundleDir, 'vendor', name) : undefined,
    join(process.cwd(), 'dist', 'vendor', name),
    join(process.cwd(), 'node_modules', rel),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

function load(key: string, read: () => Buffer | null): { body: Buffer; etag: string } | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const body = read();
  if (!body) return null;
  const entry = { body, etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"` };
  cache.set(key, entry);
  return entry;
}

function sendAsset(reply: FastifyReply, ifNoneMatch: string | undefined, type: string, entry: { body: Buffer; etag: string }) {
  reply.header('Content-Type', type);
  reply.header('ETag', entry.etag);
  reply.header('Cache-Control', 'public, max-age=3600');
  if (ifNoneMatch === entry.etag) return reply.code(304).send();
  return reply.send(entry.body);
}

/** Strict CSP for HTML pages: everything same-origin, no inline scripts or styles. */
export function pageCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

export async function uiAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/assets/lore.css', async (req, reply) => {
    const entry = load('lore.css', () => Buffer.from(CHAT_CSS + ACCOUNT_CSS))!;
    return sendAsset(reply, req.headers['if-none-match'], 'text/css; charset=utf-8', entry);
  });

  app.get('/assets/lore.js', async (req, reply) => {
    const entry = load('lore.js', () => Buffer.from(CHAT_JS))!;
    return sendAsset(reply, req.headers['if-none-match'], 'text/javascript; charset=utf-8', entry);
  });

  app.get('/assets/account.js', async (req, reply) => {
    const entry = load('account.js', () => Buffer.from(ACCOUNT_JS))!;
    return sendAsset(reply, req.headers['if-none-match'], 'text/javascript; charset=utf-8', entry);
  });

  app.get<{ Params: { name: string } }>('/assets/vendor/:name', async (req, reply) => {
    const { name } = req.params;
    const entry = load(`vendor/${name}`, () => {
      const file = resolveVendorFile(name);
      return file ? readFileSync(file) : null;
    });
    if (!entry) return reply.code(404).send({ error: 'not found' });
    const type = name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
    return sendAsset(reply, req.headers['if-none-match'], type, entry);
  });
}
