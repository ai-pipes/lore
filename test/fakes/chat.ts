/** In-memory chat ports for application tests (no DB, no LLM). */
import type { ChatDeps, ChatDocs, ChatRepository, InsightStore } from '../../src/modules/chat/application/ports.js';
import type { ChatMessage, ChatSession } from '../../src/modules/chat/domain/session.js';
import type { DocumentIndex, LinkedHit, SearchDeps, SearchHit } from '../../src/modules/search/index.js';
import type { Document, DocumentInput, LibraryScope, LibraryWithStats } from '../../src/modules/catalog/index.js';
import type { CompleteRequest, LanguageModel, LlmStreamEvent, StreamRequest } from '../../src/modules/llm/index.js';

export interface FakeChatState {
  sessions: ChatSession[];
  messages: ChatMessage[];
  /** Insight documents by `library/version/slug`. */
  insightDocs: Map<string, { id: string; input: DocumentInput }>;
  insightsLibrary: string;
  ensureCalls: number;
  /** `library/slug` keys that exist in a current version. */
  currentDocs: Set<string>;
  existingCalls: { library: string; slug: string }[][];
  libraries: LibraryWithStats[];
  /** Catalog documents by `library/slug`. */
  docs: Map<string, Document>;
  /** What full-text search returns. */
  hits: SearchHit[];
  /** The library filter of each full-text search (undefined: all libraries). */
  fullTextLibraries: (string | undefined)[];
  /** The `library/slug` of each slug lookup through the search index. */
  slugLookups: string[];
  linked: LinkedHit[];
  linksFail: boolean;
  /** The version scopes link expansion was asked to follow, per call. */
  linkScopes: (LibraryScope[] | undefined)[];
  /** The model: `configured`, the answer of each `complete` call, and the events of each streamed turn. */
  configured: boolean;
  summary: string;
  completeCalls: CompleteRequest[];
  turns: LlmStreamEvent[][];
  streamCalls: StreamRequest[];
}

export function fakeDocument(library_id: string, slug: string, content: string, version_id = 'v1'): Document {
  return {
    id: `${library_id}/${slug}`,
    library_id,
    version_id,
    slug,
    domain: null,
    project_name: null,
    entry_type: null,
    handler_class: null,
    http_method: null,
    route: null,
    summary: `summary of ${slug}`,
    content,
    generated_at: null,
    content_hash: `hash:${slug}`,
    category: null,
    author_user_id: null,
    author_name: null,
  };
}

export function createFakeChat(): { deps: ChatDeps; state: FakeChatState } {
  const state: FakeChatState = {
    sessions: [],
    messages: [],
    insightDocs: new Map(),
    insightsLibrary: 'insights',
    ensureCalls: 0,
    currentDocs: new Set(),
    existingCalls: [],
    libraries: [],
    docs: new Map(),
    hits: [],
    fullTextLibraries: [],
    slugLookups: [],
    linked: [],
    linksFail: false,
    linkScopes: [],
    configured: true,
    summary: 'Summary title\n\nbody',
    completeCalls: [],
    turns: [],
    streamCalls: [],
  };
  let sessionSeq = 0;
  let messageSeq = 0;
  let docSeq = 0;
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString();

  /** The owner's session, or undefined: another owner's session is invisible. */
  const owned = (ownerId: string, id: string) => state.sessions.find((x) => x.id === id && x.user_id === ownerId);

  const chats: ChatRepository = {
    async create(ownerId, o) {
      const now = tick();
      const s: ChatSession = {
        id: `00000000-0000-0000-0000-${String(++sessionSeq).padStart(12, '0')}`,
        user_id: ownerId,
        title: o.title ?? 'New chat',
        pinned_docs: o.pinned_docs ?? [],
        scope_filters: o.scope_filters ?? [],
        is_published: false,
        published_doc_id: null,
        created_at: now,
        updated_at: now,
      };
      state.sessions.push(s);
      return { ...s };
    },
    async list(ownerId, limit) {
      return state.sessions
        .filter((s) => s.user_id === ownerId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, limit)
        .map((s) => ({
          id: s.id,
          title: s.title,
          is_published: s.is_published,
          updated_at: s.updated_at,
          message_count: state.messages.filter((m) => m.session_id === s.id).length,
        }));
    },
    async get(ownerId, id) {
      const s = owned(ownerId, id);
      return s ? { ...s } : null;
    },
    async update(ownerId, id, data) {
      const s = owned(ownerId, id);
      if (!s) return null;
      const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      Object.assign(s, defined, { updated_at: tick() });
      return { ...s };
    },
    async delete(ownerId, id) {
      if (!owned(ownerId, id)) return false;
      state.sessions = state.sessions.filter((s) => s.id !== id);
      state.messages = state.messages.filter((m) => m.session_id !== id);
      return true;
    },
    async addMessage(ownerId, sessionId, role, content, metadata) {
      const s = owned(ownerId, sessionId);
      if (!s) return null;
      s.updated_at = tick();
      const m: ChatMessage = { id: ++messageSeq, session_id: sessionId, role, content, metadata: metadata ?? null, created_at: tick() };
      state.messages.push(m);
      return { ...m };
    },
    async messages(ownerId, sessionId) {
      if (!owned(ownerId, sessionId)) return null;
      return state.messages.filter((m) => m.session_id === sessionId).map((m) => ({ ...m }));
    },
    async setTitle(ownerId, id, title) {
      const s = owned(ownerId, id);
      if (s) Object.assign(s, { title, updated_at: tick() });
    },
  };

  const insights: InsightStore = {
    async ensureInsightsVersion() {
      state.ensureCalls++;
      return { library_id: state.insightsLibrary, version_id: 'insights' };
    },
    async existing(refs) {
      state.existingCalls.push(refs);
      return new Set(refs.map((r) => `${r.library}/${r.slug}`).filter((k) => state.currentDocs.has(k)));
    },
    async exists(libraryId, versionId, slug) {
      return state.insightDocs.has(`${libraryId}/${versionId}/${slug}`);
    },
    async insert(input, onConflict) {
      const key = `${input.library_id}/${input.version_id}/${input.slug}`;
      const existing = state.insightDocs.get(key);
      if (existing && onConflict === 'error') return 'exists';
      const id = existing?.id ?? `doc-${++docSeq}`;
      state.insightDocs.set(key, { id, input });
      return { id };
    },
  };

  const docs: ChatDocs = {
    async bySlug(libraryId, slug) {
      return state.docs.get(`${libraryId}/${slug}`) ?? null;
    },
    async listLibraries() {
      return state.libraries;
    },
    async libraryExists(id) {
      return state.libraries.some((l) => l.id === id);
    },
  };

  const index: DocumentIndex = {
    async fullText(_q, o) {
      state.fullTextLibraries.push(o.library_id);
      return state.hits.map((h) => ({ ...h }));
    },
    async vector() {
      return [];
    },
    async embed() {
      return null;
    },
    async bySlug(libraryId, slug) {
      state.slugLookups.push(`${libraryId}/${slug}`);
      return state.docs.get(`${libraryId}/${slug}`) ?? null;
    },
    async linksFrom(_hits, max, scopes) {
      state.linkScopes.push(scopes);
      if (state.linksFail) throw new Error('links failed');
      return state.linked.slice(0, max);
    },
  };
  const search: SearchDeps = { index, terms: { extract: async (q) => q } };

  const model: LanguageModel = {
    configured: () => state.configured,
    async complete(req) {
      state.completeCalls.push(req);
      return state.summary;
    },
    stream(req) {
      state.streamCalls.push(req);
      const turn: LlmStreamEvent[] = state.turns.shift() ?? [{ type: 'end', reason: 'stop' }];
      return (async function* () {
        for (const event of turn) yield event;
      })();
    },
  };

  return { deps: { chats, insights, search, docs, model }, state };
}
