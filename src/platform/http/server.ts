import Fastify, { type FastifyError } from 'fastify';
import { STATUS_CODES } from 'http';
import multipart from '@fastify/multipart';
import { healthRoutes } from './health.js';
import { chatRoutes, insightsLibraryId } from '../../modules/chat/index.js';
import { uiAssetRoutes } from './ui-assets.js';
import { cliLoginRoutes, identityRoutes, tokenRoutes, userRoutes } from '../../modules/identity/index.js';
import { mcpPublicUrl, publicUrl, trustProxyFromEnv, type TrustProxy } from '../config.js';
import { catalogRoutes, ensureSystemLibrary, INSIGHTS_NAMESPACE } from '../../modules/catalog/index.js';
import type { SsoConfig } from '../../modules/identity/index.js';
import { buildContainer } from '../container.js';
import { pushActorOf, resolveCaller, userIdOf } from './caller.js';
import { rejectCrossSiteWrites } from './csrf.js';
import { rejectMalformedInput } from './input-guard.js';
import { registerAuthorization } from './route-policy.js';
import { securityHeaders } from './security.js';

export interface BuildServerOptions {
  /** Single sign-on settings instead of the ones from the environment (null = password mode). */
  sso?: SsoConfig | null;
  /** Trusted proxies instead of `LORE_TRUST_PROXY`. */
  trustProxy?: TrustProxy;
}

export async function buildServer(opts: BuildServerOptions = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  const app = Fastify({
    // req.ip / req.protocol come from X-Forwarded-* only when the proxy in front is trusted
    trustProxy: opts.trustProxy ?? trustProxyFromEnv(process.env),
    logger: isProd
      ? { level: process.env.LOG_LEVEL ?? 'info' }
      : { level: 'debug', transport: { target: 'pino-pretty' } },
  });
  const container = buildContainer(process.env, {
    ...(opts.sso !== undefined ? { sso: opts.sso } : {}),
    logger: { warn: (fields, msg) => app.log.warn(fields, msg) },
  });

  // The insights library (LORE_INSIGHTS_LIBRARY) lives in the system namespace, whatever its id.
  const insights = await ensureSystemLibrary(container.catalog, insightsLibraryId(process.env), 'Insights', INSIGHTS_NAMESPACE);
  if (insights === 'moved') app.log.warn(`moved library "${insightsLibraryId(process.env)}" into the insights namespace (LORE_INSIGHTS_LIBRARY)`);

  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Never leak internal error messages (SQL, stack details, upstream API errors)
  // to clients: 5xx responses get a generic body, the real error is logged.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err }, 'request failed');
      return reply.code(status).send({ statusCode: status, error: 'Internal Server Error', message: 'Internal Server Error' });
    }
    return reply.code(status).send({ statusCode: status, error: STATUS_CODES[status] ?? 'Error', message: err.message });
  });

  // Baseline security headers on every response; the page CSP on every HTML response
  securityHeaders(app);

  // Bodies are JSON (or multipart for uploads) only: no text/plain or
  // urlencoded parser at all, so simple cross-site HTML forms cannot reach
  // any route (they get 415).
  app.removeContentTypeParser('text/plain');
  app.addHook('onRequest', rejectCrossSiteWrites);
  // NUL / control characters, repeated query parameters and over-deep JSON are 400, not a DB error.
  app.addHook('preValidation', rejectMalformedInput);

  // Who is calling: a session cookie, an sk_ token or the admin key (null = anonymous).
  app.decorateRequest('caller', null);
  app.addHook('onRequest', async (request, reply) => {
    const { caller, setCookie } = await resolveCaller(container, request);
    request.caller = caller;
    if (setCookie) reply.header('Set-Cookie', setCookie);
  });
  // The gate: every route registered from here on needs a ROUTE_POLICY row (fail closed).
  registerAuthorization(app, container);

  await app.register(identityRoutes(container.identity, { cookieSecure: container.cookieSecure }));
  await app.register(tokenRoutes(container.identity, { mcpUrl: mcpPublicUrl(process.env) }));
  await app.register(userRoutes(container.identity));
  await app.register(cliLoginRoutes(container.identity, { publicUrl: publicUrl(process.env) }));
  await app.register(uiAssetRoutes);
  await app.register(healthRoutes);
  await app.register(
    catalogRoutes(container.catalog, {
      pushActorOf: (req) => pushActorOf(req.caller),
      userIdOf: (req) => userIdOf(req.caller),
    }),
  );
  await app.register(
    chatRoutes(container.chat, {
      // Chat routes are `chat` (users only): each user has their own history; only admin users
      // choose an insight's slug.
      ownerOf: (req) =>
        req.caller?.kind === 'user'
          ? { userId: req.caller.userId, displayName: req.caller.displayName, isAdmin: req.caller.role === 'admin' }
          : null,
    }),
  );

  if (process.env.NODE_ENV === 'test') {
    const { getDb } = await import('../db.js');
    const { chat_messages, chat_sessions } = await import('../../modules/chat/infrastructure/schema.js');
    const { notInArray } = await import('drizzle-orm');
    const {
      document_images, document_links, document_vectors, document_metadata, documents, versions, libraries, namespaces,
      project_keys,
    } = await import('../../modules/catalog/infrastructure/schema.js');
    // Inside a plugin, so a missing policy row fails this register (and buildServer) at once.
    await app.register(async (testRoutes) => {
      testRoutes.delete('/api/test/reset', async (_req, reply) => {
        const db = getDb();
        await db.delete(project_keys);
        await db.delete(document_images);
        await db.delete(document_links);
        await db.delete(document_vectors);
        await db.delete(document_metadata);
        await db.delete(chat_messages);
        await db.delete(chat_sessions);
        await db.delete(documents);
        await db.delete(versions);
        await db.delete(libraries);
        await db.delete(namespaces).where(notInArray(namespaces.id, ['default', 'insights']));
        return reply.send({ ok: true });
      });
    });
  }

  return app;
}
