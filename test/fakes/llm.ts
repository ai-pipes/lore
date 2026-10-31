/** Scripted `LanguageModel` streams for route tests that mock `createLanguageModel`. */
import type { LlmStreamEvent } from '../../src/modules/llm/index.js';

/** A stream that yields `events` in order. */
export async function* streamOf(events: LlmStreamEvent[]): AsyncGenerator<LlmStreamEvent> {
  for (const event of events) yield event;
}

/** A turn that answers with `text` and stops. */
export const textTurn = (text: string): LlmStreamEvent[] => [
  { type: 'text', text },
  { type: 'end', reason: 'stop' },
];

/** A stream that fails on its first read, like an upstream that rejects the request. */
export function failingStream(error: Error): AsyncIterable<LlmStreamEvent> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
  };
}
