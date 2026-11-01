import { renderPrompt, type LanguageModel } from '../../llm/index.js';
import type { TermExtractor } from '../application/ports.js';

/** Every search waits for the extraction, so it gets one short attempt. */
const EXTRACT_TIMEOUT_MS = 5_000;

/**
 * Calls a cheap LLM to extract key technical terms from the query and translate them to English.
 * One attempt, at most `timeoutMs` (5 s). Falls back to the original query on an empty answer,
 * an LLM error or timeout, or when no LLM is configured.
 */
export function createLlmTermExtractor(model: LanguageModel, opts: { timeoutMs?: number } = {}): TermExtractor {
  const timeoutMs = opts.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  return {
    async extract(query) {
      if (!model.configured()) return query;
      try {
        // Build the request before the deadline starts: a throw here must leave no timer behind.
        const messages = [
          { role: 'system' as const, content: renderPrompt('search/extract-terms') },
          { role: 'user' as const, content: query },
        ];
        const answer = await withDeadline(timeoutMs, (signal) => model.complete({
          messages,
          maxTokens: 50,
          // Deterministic terms: the same question searches the same way every time.
          temperature: 0,
          timeoutMs,
          maxRetries: 0,
          signal,
        }));
        return answer.trim() || query;
      } catch (err) {
        console.warn('[search] term extraction failed, using the raw query:', err instanceof Error ? err.message : err);
        return query;
      }
    },
  };
}

/** Rejects after `ms` even when the model ignores its `signal`, and aborts that signal. */
function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${ms} ms`));
    }, ms);
  });
  return Promise.race([Promise.resolve().then(() => run(controller.signal)), deadline]).finally(() => clearTimeout(timer));
}
