import { describe, expect, it } from 'vitest';
import { renderPrompt, type CompleteRequest, type LanguageModel } from '../../llm/index.js';
import type { Document } from '../domain/document.js';
import { VALID_LINK_TYPES, parseSuggestedLinks } from '../domain/links.js';
import { createLlmLinkSuggester, suggestLinks } from './llm-link-suggester.js';

function fakeModel(
  answer: (req: CompleteRequest) => Promise<string>,
  configured = true,
): LanguageModel & { calls: CompleteRequest[] } {
  const calls: CompleteRequest[] = [];
  return {
    calls,
    configured: () => configured,
    complete: (req) => {
      calls.push(req);
      return answer(req);
    },
    stream: () => {
      throw new Error('not used');
    },
  };
}

const doc = { id: 'd1', slug: 'a', domain: null, summary: null, content: 'A' } as Document;
const answer = '{"links":[{"slug":"b","type":"references"}]}';

describe('suggestLinks', () => {
  it('returns the parsed items of the answer, from a single JSON-mode attempt', async () => {
    const model = fakeModel(async () => answer);
    expect(await suggestLinks(model, doc, ['b'])).toEqual(parseSuggestedLinks(answer));
    expect(model.calls).toHaveLength(1);
    const prompt = renderPrompt('enrichment/links', {
      slug: 'a',
      domain: 'unknown',
      summary: '',
      content: 'A',
      known_slugs: 'b',
      link_types: VALID_LINK_TYPES.join(', '),
    });
    expect(model.calls[0]).toEqual({
      messages: [{ role: 'user', content: prompt }],
      json: true,
      maxTokens: 500,
      timeoutMs: 15_000,
      maxRetries: 0,
    });
  });

  it('rejects when the LLM call fails, so the caller can tell a failure from "no links"', async () => {
    const model = fakeModel(() => Promise.reject(new Error('503')));
    await expect(suggestLinks(model, doc, ['b'])).rejects.toThrow('503');
  });

  it('passes a custom timeout to the model', async () => {
    const model = fakeModel(async () => '[]');
    await suggestLinks(model, doc, ['b'], { timeoutMs: 20 });
    expect(model.calls[0]!.timeoutMs).toBe(20);
  });
});

describe('createLlmLinkSuggester', () => {
  it('is enabled exactly when the model is configured', () => {
    expect(createLlmLinkSuggester(fakeModel(async () => '', true)).enabled()).toBe(true);
    expect(createLlmLinkSuggester(fakeModel(async () => '', false)).enabled()).toBe(false);
  });

  it('suggests through the model', async () => {
    const suggester = createLlmLinkSuggester(fakeModel(async () => answer));
    expect(await suggester.suggest(doc, ['b'])).toEqual(parseSuggestedLinks(answer));
  });
});
