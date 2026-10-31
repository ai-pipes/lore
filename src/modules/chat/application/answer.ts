import { renderPrompt, type LlmFinishReason, type LlmMessage, type LlmTool, type LlmToolCall } from '../../llm/index.js';
import { expandLinks, groupByDomain, lookupBySlug, parseDotSlug, searchDocuments } from '../../search/index.js';
import { displayNameOf, rewriteImageUrls } from '../domain/answer-context.js';
import type { ChatDeps } from './ports.js';

/** A line of the `/api/chat` stream. */
export type ChatEvent = Record<string, unknown> & { type: string };

export interface PinnedDoc {
  slug: string;
  library_id: string;
}

export interface StreamChatOptions {
  /** The libraries to search; absent or empty: all libraries. */
  library_ids?: string[];
  branch?: string;
  pinnedDocs?: PinnedDoc[];
  mode?: 'qa' | 'brainstorm';
  /** Aborted when the client goes away: no further work is done and no more events are yielded. */
  signal?: AbortSignal;
}

export const NO_LLM_MESSAGE =
  'No LLM is configured on this Lore server, so I can only show search results. ' +
  'Set `LLM_API_KEY` and `LLM_MODEL` (or `LLM_BASE_URL` for a local OpenAI-compatible server) to enable answers.';

/**
 * Bounds on each model turn: the timeout covers the wait for the stream to start, not the
 * answer itself.
 */
const STREAM_REQUEST = { timeoutMs: 60_000, maxRetries: 1 };
/** Model turns per answer (each tool round trip is one turn). */
const MAX_TURNS = 5;
/** How many top search hits are fetched in full into the model's context. */
const AUTO_FETCH_LIMIT = 2;
/** Hits scoring below this share of the best score are left out of the model's context. */
const CONTEXT_SCORE_SHARE = 0.4;

function chatTools(): LlmTool[] {
  return [
    {
      name: 'get_document',
      description: renderPrompt('chat/tool-get-document'),
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Document slug, e.g. orders/refund-create' },
          library_id: { type: 'string', description: 'Library the document belongs to' },
        },
        required: ['slug', 'library_id'],
      },
    },
    {
      name: 'list_libraries',
      description: renderPrompt('chat/tool-list-libraries'),
      parameters: { type: 'object', properties: {} },
    },
  ];
}

/**
 * Streams model turns into `messages`, answering its tool calls, until a turn ends without tool
 * calls or MAX_TURNS pass. With `toolEventLibrary` the `get_document` tool event also names the library.
 */
async function* runModel(
  d: ChatDeps,
  messages: LlmMessage[],
  o: { branch?: string; temperature: number; toolEventLibrary: boolean; signal?: AbortSignal },
): AsyncGenerator<ChatEvent> {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (o.signal?.aborted) return;
    const stream = d.model.stream({ messages, tools: chatTools(), temperature: o.temperature, ...STREAM_REQUEST, signal: o.signal });
    let fullContent = '';
    const toolCalls: LlmToolCall[] = [];
    let finishReason: LlmFinishReason | undefined;

    for await (const event of stream) {
      if (o.signal?.aborted) return;
      if (event.type === 'text') {
        fullContent += event.text;
        yield { type: 'text', content: event.text };
      } else if (event.type === 'tool_call') {
        toolCalls.push(event.call);
      } else {
        finishReason = event.reason;
      }
    }

    // Only tool calls need another turn. A finished, truncated (`length`), otherwise ended (`other`) or
    // unterminated turn ends the answer: asking again would stream the same text twice.
    if (finishReason !== 'tool_calls') break;

    messages.push({ role: 'assistant', content: fullContent || null, toolCalls });
    for (const tc of toolCalls) {
      let result: unknown;
      try {
        const args = JSON.parse(tc.arguments);
        if (tc.name === 'get_document') {
          yield o.toolEventLibrary
            ? { type: 'tool', name: 'get_document', query: args.slug, library_id: args.library_id }
            : { type: 'tool', name: 'get_document', query: args.slug };
          const doc = await d.docs.bySlug(args.library_id, args.slug, { branch: o.branch });
          result = doc
            ? { library_id: args.library_id, slug: doc.slug, summary: doc.summary, content: rewriteImageUrls(doc.content, args.library_id, doc.version_id, doc.slug) }
            : `Document not found: ${args.slug}`;
        } else if (tc.name === 'list_libraries') {
          result = await d.docs.listLibraries();
        } else {
          result = { error: `Unknown tool: ${tc.name}` };
        }
      } catch (e) {
        console.error('[chat] tool call failed:', tc.name, e);
        result = { error: 'Tool call failed' };
      }
      messages.push({ role: 'tool', toolCallId: tc.id, content: JSON.stringify(result) });
    }
  }
}

/** The pinned documents without repeats, in their first order. */
export function uniquePinned(pinnedDocs: PinnedDoc[]): PinnedDoc[] {
  const seen = new Set<string>();
  return pinnedDocs.filter((pd) => {
    const key = JSON.stringify([pd.library_id, pd.slug]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pinned documents: no search, their full content goes into the context. */
async function* answerWithPinned(
  d: ChatDeps,
  userMessages: LlmMessage[],
  pinnedDocs: PinnedDoc[],
  o: { branch?: string; signal?: AbortSignal },
): AsyncGenerator<ChatEvent> {
  const { branch, signal } = o;
  // Without an LLM the documents would be read for nothing.
  if (!d.model.configured()) {
    yield { type: 'text', content: NO_LLM_MESSAGE };
    yield { type: 'done' };
    return;
  }

  const pinnedSections: string[] = [];
  for (const pd of uniquePinned(pinnedDocs)) {
    const doc = await d.docs.bySlug(pd.library_id, pd.slug, { branch });
    if (doc) {
      const content = rewriteImageUrls(doc.content, pd.library_id, doc.version_id, doc.slug);
      pinnedSections.push(`### ${displayNameOf(pd.library_id, doc.slug)} [library_id: ${pd.library_id}, slug: ${doc.slug}]\n\n${content}`);
    }
  }
  const pinnedContext =
    pinnedSections.length > 0
      ? `## Pinned documentation\n\n${pinnedSections.join('\n\n---\n\n')}`
      : '## Pinned documentation\n\nNo documents found.';

  const messages: LlmMessage[] = [
    { role: 'system', content: renderPrompt('chat/context') },
    ...userMessages,
    { role: 'system', content: pinnedContext },
  ];
  yield* runModel(d, messages, { branch, temperature: 0, toolEventLibrary: true, signal });
  if (signal?.aborted) return;
  yield { type: 'done' };
}

/** The document a dotted slug in the question names, looked up in each library of the scope in turn. */
async function lookupInScope(d: ChatDeps, question: string, libraryIds: string[], branch?: string) {
  if (libraryIds.length === 0) return lookupBySlug(d.search, question, { branch });
  for (const library_id of libraryIds) {
    const doc = await lookupBySlug(d.search, question, { library_id, branch });
    if (doc) return doc;
  }
  return null;
}

/**
 * Answers a chat: with pinned documents from their content; otherwise a dotted slug naming a
 * document returns it directly, and anything else is searched first. The search results are
 * streamed to the client, and the best hits (two of them in full, plus linked documents) become
 * the model's context. Without an LLM only the search results are returned.
 */
export async function* streamChat(d: ChatDeps, userMessages: LlmMessage[], opts: StreamChatOptions = {}): AsyncGenerator<ChatEvent> {
  const { library_ids = [], branch, pinnedDocs, mode, signal } = opts;
  if (signal?.aborted) return;
  if (pinnedDocs?.length) {
    yield* answerWithPinned(d, userMessages, pinnedDocs, { branch, signal });
    return;
  }

  const autoFetchedSources: { library_id: string; slug: string }[] = [];
  const lastUserMsg = userMessages.filter((m) => m.role === 'user').at(-1);
  const question = lastUserMsg?.content as string;
  if (lastUserMsg) {
    const directDoc = await lookupInScope(d, question, library_ids, branch);
    if (directDoc) {
      yield { type: 'text', content: rewriteImageUrls(directDoc.content, directDoc.library_id, directDoc.version_id, directDoc.slug) };
      yield { type: 'done' };
      return;
    }
  }

  let searchContext = '## Relevant documentation\n\nNo documents found.';
  if (lastUserMsg) {
    const dotSlug = parseDotSlug(question);
    const searchLibraryIds = dotSlug ? [dotSlug.library_id] : library_ids;
    const query = dotSlug ? dotSlug.query : question;
    const services = searchLibraryIds.map((id) => ({ library_id: id, branch }));
    yield { type: 'tool', name: 'search_lore', query };
    const docs = await searchDocuments(d.search, query, { services });

    if (docs.length > 0) {
      yield { type: 'search_results', data: { terms: query, total: docs.length, groups: groupByDomain(docs) } };
    }

    const maxScore = docs.reduce((m, doc) => Math.max(m, doc.score ?? 0), 0);
    const llmDocs = maxScore > 0 ? docs.filter((doc) => (doc.score ?? 0) >= maxScore * CONTEXT_SCORE_SHARE) : docs;

    if (llmDocs.length > 0) {
      const lines = llmDocs.map((h) => {
        const meta = [h.entry_type, h.http_method, h.route].filter(Boolean).join(' ');
        return `- **${displayNameOf(h.library_id, h.slug)}** (${meta}): ${h.summary ?? ''} [library_id: ${h.library_id}, slug: ${h.slug}]`;
      });

      // The full content of the top hits, so the model does not invent details when it skips get_document.
      const autoFetched: string[] = [];
      for (const h of llmDocs.slice(0, AUTO_FETCH_LIMIT)) {
        try {
          const doc = await d.docs.bySlug(h.library_id, h.slug, { branch });
          if (doc) {
            const content = rewriteImageUrls(doc.content, h.library_id, doc.version_id, h.slug);
            autoFetched.push(`### ${displayNameOf(h.library_id, h.slug)} [library_id: ${h.library_id}, slug: ${h.slug}]\n\n${content}`);
            autoFetchedSources.push({ library_id: h.library_id, slug: h.slug });
          } else {
            console.warn('[auto-fetch] document not found:', h.library_id, h.slug);
          }
        } catch (e) {
          console.warn('[auto-fetch] fetch failed:', h.library_id, h.slug, e);
        }
      }

      // Documents linked from the hits (no LLM calls); best-effort.
      let relatedSection = '';
      try {
        const linked = await expandLinks(d.search, llmDocs, { maxLinked: 10, services });
        if (linked.length > 0) {
          const relatedLines = linked.map((ld) => {
            const meta = [ld.entry_type, ld.http_method, ld.route].filter(Boolean).join(' ');
            return `- **${displayNameOf(ld.library_id, ld.slug)}** (${meta}): ${ld.summary ?? ''} ← ${ld.link_type} from ${displayNameOf(ld.library_id, ld.from_slug)} [library_id: ${ld.library_id}, slug: ${ld.slug}]`;
          });
          relatedSection = `\n\n## Related documentation (via links)\n\n${relatedLines.join('\n')}`;
        }
      } catch {
        /* link expansion is best-effort */
      }

      const autoFetchedSection =
        autoFetched.length > 0 ? `\n\n## Full document content (auto-fetched)\n\n${autoFetched.join('\n\n---\n\n')}` : '';
      searchContext = `## Relevant documentation\n\n${lines.join('\n')}${relatedSection}${autoFetchedSection}`;
    }
  }

  if (signal?.aborted) return;
  if (!d.model.configured()) {
    yield { type: 'text', content: NO_LLM_MESSAGE };
    if (autoFetchedSources.length > 0) yield { type: 'sources', docs: autoFetchedSources };
    yield { type: 'done' };
    return;
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: renderPrompt(mode === 'brainstorm' ? 'chat/brainstorm' : 'chat/system') },
    ...userMessages,
    { role: 'system', content: searchContext },
  ];
  yield* runModel(d, messages, { branch, temperature: mode === 'brainstorm' ? 0.7 : 0, toolEventLibrary: false, signal });
  if (signal?.aborted) return;

  if (autoFetchedSources.length > 0) yield { type: 'sources', docs: autoFetchedSources };
  yield { type: 'done' };
}
