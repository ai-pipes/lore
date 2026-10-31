/**
 * Insights: chat sessions published as documents. An insight links to the documents it is based
 * on: the session's pinned documents and the `[ref:library/slug]` citations in its texts. Pure.
 */

/** A reference to a document in its library's current version. */
export interface Ref {
  library: string;
  slug: string;
}

export const REF_RE = /\[ref:([a-z0-9][a-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9_./-]*)\]/g;

/** Maximum number of distinct referenced documents considered per insight. */
export const MAX_INSIGHT_LINKS = 50;

/**
 * The distinct documents an insight cites: pinned documents first, then `[ref:]` citations in
 * order, at most `limit`. References into the insights library itself and slugs longer than
 * 300 characters are dropped.
 */
export function collectRefs(texts: string[], pinned: unknown[], insightsLibrary: string, limit = MAX_INSIGHT_LINKS): Ref[] {
  const refs = new Map<string, Ref>();
  const add = (library: string, slug: string) => {
    if (refs.size >= limit || library === insightsLibrary || slug.length > 300) return;
    refs.set(`${library}/${slug}`, { library, slug });
  };
  for (const p of pinned) {
    const d = p as { library_id?: unknown; slug?: unknown } | null;
    if (typeof d?.library_id === 'string' && typeof d?.slug === 'string') add(d.library_id, d.slug);
  }
  outer: for (const text of texts) {
    for (const m of text.matchAll(REF_RE)) {
      if (refs.size >= limit) break outer;
      add(m[1], m[2]);
    }
  }
  return [...refs.values()];
}

/** The conversation as Markdown for summarization: user and assistant turns only. */
export function transcriptOf(messages: { role: string; content: string }[]): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `**${m.role === 'user' ? 'User' : 'AI'}:** ${m.content}`)
    .join('\n\n');
}

/** The insight title: the given one, else the summary's first line without heading marks, else the session title. */
export function insightTitle(title: string | undefined, summary: string, sessionTitle: string): string {
  return title?.trim() || summary.split('\n')[0]?.replace(/^#+\s*/, '').trim() || sessionTitle;
}
