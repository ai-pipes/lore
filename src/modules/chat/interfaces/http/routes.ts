import { Readable } from 'node:stream';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { expandLinks, extractSearchTerms, groupByDomain, searchDocuments } from '../../../search/index.js';
import { streamChat } from '../../application/answer.js';
import { parseChatRequest } from '../../application/chat-request.js';
import { publishSession, type PublishError } from '../../application/insights.js';
import type { ChatDeps } from '../../application/ports.js';
import { addMessage, createSession, deleteSession, getSession, listSessions, updateSession } from '../../application/sessions.js';
import { rewriteImageUrls } from '../../domain/answer-context.js';
import { MESSAGE_ROLES, PUBLISH_SLUG_RE, UUID_RE, validateSessionBody, type ChatOwner } from '../../domain/session.js';
import { getChatHTML } from '../web/chat-html.js';

export interface ChatRouteOptions {
  /**
   * The signed-in user the request acts for, or null (no user: e.g. the admin key). Chats are
   * always scoped to this owner; the platform maps a `user` caller.
   */
  ownerOf(req: FastifyRequest): ChatOwner | null;
}

type SessionParams = { Params: { id: string } };
type SessionBody = { title?: string; pinned_docs?: unknown[]; scope_filters?: unknown[] } | undefined;

/** Status and body of a failed publish; the same as before the chat module existed. */
async function publishErrorReply(
  deps: ChatDeps,
  error: PublishError,
  ownerId: string,
  sessionId: string,
  slug: string,
): Promise<[number, object]> {
  switch (error) {
    case 'library_not_found':
      return [404, { error: 'library not found' }];
    case 'slug_forbidden':
      return [403, { error: 'only an admin can choose the slug of an insight' }];
    case 'not_found':
      return [404, { error: 'session not found' }];
    case 'already_published':
      return [409, { error: 'already published', doc_id: (await deps.chats.get(ownerId, sessionId))?.published_doc_id }];
    case 'empty':
      return [400, { error: 'empty session' }];
    case 'no_llm':
      return [503, { error: 'publishing needs an LLM; set LLM_API_KEY and LLM_MODEL (or LLM_BASE_URL)' }];
    case 'slug_taken':
      return [409, { error: `an insight with slug ${slug} already exists` }];
  }
}

/** The chat page, search and document reads for the UI, chat sessions, publishing and the answer stream. */
export function chatRoutes(deps: ChatDeps, opts: ChatRouteOptions): FastifyPluginAsync {
  /** The request's owner; a request without one (the route policy should already stop it) is 403. */
  const ownerOrReject = (req: FastifyRequest, reply: FastifyReply): ChatOwner | null => {
    const owner = opts.ownerOf(req);
    if (!owner) reply.code(403).send({ error: 'forbidden' });
    return owner;
  };

  return async (app) => {
    app.get('/', async (_req, reply) => {
      reply.type('text/html; charset=utf-8').send(getChatHTML());
    });

    app.get<{ Querystring: { q: string; library_id?: string; branch?: string; domain?: string } }>('/api/search', async (req, reply) => {
      const { q, library_id, branch, domain } = req.query;
      if (!q?.trim()) return reply.code(400).send({ error: 'q required' });
      const services = library_id ? [{ library_id, branch }] : [];
      // extractSearchTerms is called inside searchDocuments — reuse the terms to avoid a duplicate LLM call
      const terms = await extractSearchTerms(deps.search, q).catch(() => q);
      const results = await searchDocuments(deps.search, q, { services, _preExtractedTerms: terms });

      const domainFilter = domain ? domain.split(',').map((d) => d.trim().toLowerCase()) : null;
      const filtered = domainFilter ? results.filter((r) => r.domain && domainFilter.includes(r.domain.toLowerCase())) : results;
      const groups = groupByDomain(filtered);

      // Link expansion: related docs (best-effort, no LLM cost)
      let linked: Awaited<ReturnType<typeof expandLinks>> = [];
      try {
        linked = await expandLinks(deps.search, filtered, { services });
      } catch {
        /* best-effort */
      }
      return reply.send({ terms, groups, total: filtered.length, linked });
    });

    app.get<{ Querystring: { library_id?: string; slug?: string; branch?: string } }>('/api/document', async (req, reply) => {
      const { library_id, slug, branch } = req.query;
      if (!library_id || !slug) return reply.code(400).send({ error: 'library_id and slug required' });
      const doc = await deps.docs.bySlug(library_id, slug, { branch });
      if (!doc) return reply.code(404).send({ error: 'not found' });
      return reply.send({
        slug: doc.slug,
        summary: doc.summary,
        content: rewriteImageUrls(doc.content, library_id, doc.version_id, doc.slug),
        library_id,
        version_id: doc.version_id,
        // Insights record who published them; the name stays when the user is deleted.
        author: doc.author_name === null ? null : { user_id: doc.author_user_id, name: doc.author_name },
      });
    });

    /* ── Chat sessions ─────────────────────────────── */
    // Sessions back the browser UI. Who may call these routes is decided by the platform's
    // route policy (`chat`: signed-in users); every session belongs to one user, and another
    // user's session id is 404 on every route. Inputs are validated so malformed ids/bodies
    // return 4xx instead of database errors.

    const validateSessionId = async (req: FastifyRequest<SessionParams>, reply: FastifyReply) => {
      if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not found' });
    };

    app.get('/api/sessions', async (req, reply) => {
      const owner = ownerOrReject(req, reply);
      if (!owner) return reply;
      return reply.send(await listSessions(deps, owner.userId));
    });

    app.post<{ Body: SessionBody }>('/api/sessions', async (req, reply) => {
      const body = req.body ?? {};
      const invalid = validateSessionBody(body);
      if (invalid) return reply.code(400).send({ error: invalid });
      const owner = ownerOrReject(req, reply);
      if (!owner) return reply;
      return reply.code(201).send(await createSession(deps, owner.userId, body));
    });

    app.get<SessionParams>('/api/sessions/:id', { preHandler: validateSessionId }, async (req, reply) => {
      const owner = ownerOrReject(req, reply);
      if (!owner) return reply;
      const session = await getSession(deps, owner.userId, req.params.id);
      if (!session) return reply.code(404).send({ error: 'not found' });
      return reply.send(session);
    });

    // Update session (title, pinned_docs, scope_filters only)
    app.patch<{ Params: { id: string }; Body: SessionBody }>('/api/sessions/:id', { preHandler: validateSessionId }, async (req, reply) => {
      const body = req.body ?? {};
      const invalid = validateSessionBody(body);
      if (invalid) return reply.code(400).send({ error: invalid });
      const owner = ownerOrReject(req, reply);
      if (!owner) return reply;
      const { title, pinned_docs, scope_filters } = body;
      const session = await updateSession(deps, owner.userId, req.params.id, { title, pinned_docs, scope_filters });
      if (!session) return reply.code(404).send({ error: 'not found' });
      return reply.send(session);
    });

    app.delete<SessionParams>('/api/sessions/:id', { preHandler: validateSessionId }, async (req, reply) => {
      const owner = ownerOrReject(req, reply);
      if (!owner) return reply;
      if (!(await deleteSession(deps, owner.userId, req.params.id))) return reply.code(404).send({ error: 'not found' });
      return reply.send({ ok: true });
    });

    app.post<{ Params: { id: string }; Body: { role?: string; content?: string; metadata?: unknown } | undefined }>(
      '/api/sessions/:id/messages',
      { preHandler: validateSessionId },
      async (req, reply) => {
        const { role, content, metadata } = req.body ?? {};
        if (!role || !content) return reply.code(400).send({ error: 'role and content required' });
        if (!MESSAGE_ROLES.has(role)) return reply.code(400).send({ error: `role must be one of: ${[...MESSAGE_ROLES].join(', ')}` });
        if (typeof content !== 'string') return reply.code(400).send({ error: 'content must be a string' });
        const owner = ownerOrReject(req, reply);
        if (!owner) return reply;
        const added = await addMessage(deps, owner.userId, req.params.id, role, content, metadata);
        if (!added.ok) return reply.code(404).send({ error: 'not found' });
        return reply.code(201).send(added.value);
      },
    );

    // Publish a session as an insight document into the insights library (LORE_INSIGHTS_LIBRARY,
    // default "insights"), never into a service library, so `lore push` cleanup of service docs
    // cannot delete it.
    app.post<{ Params: { id: string }; Body: { library_id?: string; domain?: string; slug?: string; title?: string } | undefined }>(
      '/api/sessions/:id/publish',
      { preHandler: validateSessionId },
      async (req, reply) => {
        const { library_id: relatedLibrary, domain, slug: requestedSlug, title } = req.body ?? {};
        if (relatedLibrary !== undefined && typeof relatedLibrary !== 'string') return reply.code(400).send({ error: 'library_id must be a string' });
        if (requestedSlug !== undefined && (typeof requestedSlug !== 'string' || !PUBLISH_SLUG_RE.test(requestedSlug))) {
          return reply.code(400).send({ error: 'slug must be lowercase letters, digits, "-", "_" and "/"' });
        }
        if (domain !== undefined && typeof domain !== 'string') return reply.code(400).send({ error: 'domain must be a string' });
        if (title !== undefined && typeof title !== 'string') return reply.code(400).send({ error: 'title must be a string' });

        const owner = ownerOrReject(req, reply);
        if (!owner) return reply;
        const sessionId = req.params.id;
        const result = await publishSession(deps, owner, {
          sessionId,
          libraryId: relatedLibrary,
          domain,
          slug: requestedSlug,
          title,
        });
        if (result.ok) return reply.send({ ok: true, ...result.value });

        const [status, body] = await publishErrorReply(deps, result.error, owner.userId, sessionId, requestedSlug ?? `insight/${sessionId}`);
        return reply.code(status).send(body);
      },
    );

    app.post<{ Body: unknown }>(
      '/api/chat',
      async (req, reply) => {
        const parsed = parseChatRequest(req.body);
        if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
        const { messages, library_ids, branch, pinned_docs, mode } = parsed.value;

        // The response's 'close' fires when it has been sent or the connection dropped first (not
        // when the request body ends, as the request's 'close' may): stop the answer and its LLM
        // calls once nobody reads it any more.
        const abort = new AbortController();
        reply.raw.on('close', () => abort.abort());

        const events = streamChat(deps, messages, { library_ids, branch, pinnedDocs: pinned_docs, mode, signal: abort.signal });
        async function* lines(): AsyncGenerator<string> {
          try {
            for await (const event of events) yield JSON.stringify(event) + '\n';
          } catch (e) {
            if (abort.signal.aborted) return;
            req.log.error({ err: e }, 'chat stream failed');
            yield JSON.stringify({ type: 'error', message: 'The assistant failed to answer. Check the server logs for details.' }) + '\n';
          }
        }

        // Sent through Fastify (not a hijacked raw response), so the platform's onSend hooks add
        // the security headers and any renewed session cookie to this response as well.
        return reply
          .code(200)
          .header('Content-Type', 'text/plain; charset=utf-8')
          .header('Cache-Control', 'no-cache')
          .header('X-Accel-Buffering', 'no')
          .send(Readable.from(lines(), { objectMode: false }));
      },
    );
  };
}
