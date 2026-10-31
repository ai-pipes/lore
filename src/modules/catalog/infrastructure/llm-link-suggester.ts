import { renderPrompt, type LanguageModel } from '../../llm/index.js';
import type { Document } from '../domain/document.js';
import { VALID_LINK_TYPES, parseSuggestedLinks } from '../domain/links.js';
import type { LinkSuggester } from '../application/ports.js';

/** How long one link suggestion may take before it counts as failed. */
const SUGGEST_TIMEOUT_MS = 15_000;

/**
 * Asks the configured LLM for links from a document to known slugs. Returns the raw items of
 * the JSON answer (validated by the caller). Rejects when the LLM call fails or takes longer than
 * `timeoutMs` (15 s, one attempt), so the caller can keep the existing links instead of reading
 * a failure as "no links".
 */
export async function suggestLinks(
  model: LanguageModel,
  doc: Document,
  knownSlugs: string[],
  opts: { timeoutMs?: number } = {},
): Promise<unknown[]> {
  const slugSample = knownSlugs.slice(0, 200).join(', '); // prevent token overflow
  const prompt = renderPrompt('enrichment/links', {
    slug: doc.slug,
    domain: doc.domain ?? 'unknown',
    summary: doc.summary ?? '',
    content: doc.content.slice(0, 3000),
    known_slugs: slugSample,
    link_types: VALID_LINK_TYPES.join(', '),
  });

  const answer = await model.complete({
    messages: [{ role: 'user', content: prompt }],
    json: true,
    maxTokens: 500,
    timeoutMs: opts.timeoutMs ?? SUGGEST_TIMEOUT_MS,
    maxRetries: 0,
  });
  // Handle both {"links": [...]} and direct array
  return parseSuggestedLinks(answer.trim() || '[]');
}

export function createLlmLinkSuggester(model: LanguageModel, opts: { timeoutMs?: number } = {}): LinkSuggester {
  return {
    enabled: () => model.configured(),
    suggest: (doc, knownSlugs) => suggestLinks(model, doc, knownSlugs, opts),
  };
}
