import type { LinkInput } from '../../catalog/index.js';
import { renderPrompt } from '../../llm/index.js';
import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { MAX_INSIGHT_LINKS, collectRefs, insightTitle, transcriptOf } from '../domain/insight.js';
import type { ChatOwner } from '../domain/session.js';
import type { ChatDeps } from './ports.js';

/** Bounds on the summary request: the provider default would wait far longer and retry more. */
const SUMMARY_REQUEST = { timeoutMs: 120_000, maxRetries: 1 };

export interface PublishResult {
  doc_id: string;
  title: string;
  slug: string;
  library_id: string;
  /** How many cited documents the insight links to. */
  links: number;
}

export type PublishError =
  | 'not_found'
  | 'already_published'
  | 'empty'
  | 'no_llm'
  | 'slug_forbidden'
  | 'slug_taken'
  | 'library_not_found';

/**
 * Links from an insight to the documents it is based on (see collectRefs), resolved with a
 * single lookup against current versions; refs to missing documents are dropped.
 */
export async function citedDocumentLinks(
  d: ChatDeps,
  texts: string[],
  pinned: unknown[],
  insightsLibrary: string,
  limit = MAX_INSIGHT_LINKS,
): Promise<LinkInput[]> {
  const wanted = collectRefs(texts, pinned, insightsLibrary, limit);
  if (wanted.length === 0) return [];
  const exists = await d.insights.existing(wanted);
  return wanted
    .filter((r) => exists.has(`${r.library}/${r.slug}`))
    .map((r) => ({ slug: r.slug, library: r.library, type: 'references' }));
}

/**
 * Publishes the owner's session as an insight document into the insights library, never into a
 * service library, so service pushes cannot delete it. The insight records its author (the
 * owner's id and display name). The insights library is shared by every team: only an admin may
 * choose the slug (and overwrite an existing insight); everyone else publishes to
 * `insight/<session id>`. Another user's session is `not_found`, for admins too.
 */
export async function publishSession(
  d: ChatDeps,
  owner: ChatOwner,
  input: { sessionId: string; libraryId?: string; domain?: string; slug?: string; title?: string },
): Promise<Result<PublishResult, PublishError>> {
  const { sessionId, libraryId, domain, title } = input;
  const { isAdmin } = owner;
  if (libraryId && !(await d.docs.libraryExists(libraryId))) return err('library_not_found');
  if (input.slug !== undefined && !isAdmin) return err('slug_forbidden');

  const session = await d.chats.get(owner.userId, sessionId);
  if (!session) return err('not_found');
  if (session.is_published) return err('already_published');
  const messages = await d.chats.messages(owner.userId, sessionId);
  if (!messages) return err('not_found');
  if (messages.length === 0) return err('empty');
  if (!d.model.configured()) return err('no_llm');

  // A Markdown summary of the transcript; its first line is the title.
  const summary = await d.model.complete({
    messages: [
      { role: 'system', content: renderPrompt('publish/summary') },
      { role: 'user', content: transcriptOf(messages) },
    ],
    ...SUMMARY_REQUEST,
  });
  const titleLine = insightTitle(title, summary, session.title);
  const slug = input.slug ?? `insight/${session.id}`;

  const insights = await d.insights.ensureInsightsVersion();
  const links = await citedDocumentLinks(
    d,
    [summary, ...messages.filter((m) => m.role === 'assistant').map((m) => m.content)],
    session.pinned_docs ?? [],
    insights.library_id,
  );

  if (!isAdmin && (await d.insights.exists(insights.library_id, insights.version_id, slug))) return err('slug_taken');

  const doc = await d.insights.insert(
    {
      library_id: insights.library_id,
      version_id: insights.version_id,
      slug,
      domain: domain ?? libraryId ?? undefined,
      entry_type: 'insight',
      summary: titleLine,
      content: summary,
      category: 'knowledge',
      links,
      author_user_id: owner.userId,
      author_name: owner.displayName,
    },
    isAdmin ? 'update' : 'error',
  );
  if (doc === 'exists') return err('slug_taken');

  await d.chats.update(owner.userId, sessionId, { is_published: true, published_doc_id: doc.id });
  return ok({ doc_id: doc.id, title: titleLine, slug, library_id: insights.library_id, links: links.length });
}
