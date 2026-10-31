import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPrompt, type CompleteRequest, type LanguageModel } from '../../llm/index.js';
import { createLlmTermExtractor } from './llm-term-extractor.js';

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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('llm term extractor', () => {
  it('returns the extracted terms, from a single bounded attempt', async () => {
    const model = fakeModel(async () => ' order refund ');
    expect(await createLlmTermExtractor(model).extract('заказ возврат')).toBe('order refund');
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]).toMatchObject({
      messages: [
        { role: 'system', content: renderPrompt('search/extract-terms') },
        { role: 'user', content: 'заказ возврат' },
      ],
      maxTokens: 50,
      maxRetries: 0,
      timeoutMs: 5_000,
    });
  });

  it('falls back to the query on an empty answer or an LLM error', async () => {
    expect(await createLlmTermExtractor(fakeModel(async () => '')).extract('q')).toBe('q');
    expect(await createLlmTermExtractor(fakeModel(() => Promise.reject(new Error('503')))).extract('q')).toBe('q');
  });

  it('falls back to the query when the LLM does not answer in time', async () => {
    const model = fakeModel(() => new Promise<string>(() => {}));
    const started = Date.now();
    expect(await createLlmTermExtractor(model, { timeoutMs: 20 }).extract('q')).toBe('q');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns the query without calling the model when it is not configured', async () => {
    const model = fakeModel(async () => 'x', false);
    expect(await createLlmTermExtractor(model).extract('q')).toBe('q');
    expect(model.calls).toHaveLength(0);
  });

  it('leaves no timer or unhandled rejection behind when the model throws synchronously', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const model: LanguageModel = {
        configured: () => true,
        complete: () => {
          throw new Error('boom');
        },
        stream: () => {
          throw new Error('not used');
        },
      };
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await createLlmTermExtractor(model, { timeoutMs: 20 }).extract('q')).toBe('q');
      await new Promise((r) => setTimeout(r, 80));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('clears the deadline timer after a successful answer', async () => {
    vi.useFakeTimers();
    const model = fakeModel(async () => 'terms');
    expect(await createLlmTermExtractor(model, { timeoutMs: 1000 }).extract('q')).toBe('terms');
    expect(vi.getTimerCount()).toBe(0);
  });
});
