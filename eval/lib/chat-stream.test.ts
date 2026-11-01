import { describe, expect, it } from 'vitest';
import { parseChatStream } from './chat-stream.js';

const line = (o: unknown) => JSON.stringify(o);

describe('parseChatStream', () => {
  it('collects text, get_document slugs and sources', () => {
    const nd = [
      line({ type: 'tool', name: 'search_lore', query: 'order' }),
      line({ type: 'search_results', data: {} }),
      line({ type: 'text', content: 'a' }),
      line({ type: 'tool', name: 'get_document', query: 'orders/get-order' }),
      line({ type: 'text', content: 'b' }),
      line({ type: 'sources', docs: [{ library_id: 'orders-service', slug: 'orders/get-order' }] }),
      line({ type: 'done' }),
    ].join('\n') + '\n';
    const run = parseChatStream(nd, 42);
    expect(run).toEqual({
      text: 'ab',
      toolSlugs: ['orders/get-order'],
      sources: ['orders-service/orders/get-order'],
      durationMs: 42,
    });
  });

  it('reports a server error event', () => {
    const run = parseChatStream(
      [line({ type: 'text', content: 'x' }), line({ type: 'error', message: 'The assistant failed…' })].join('\n'),
      1,
    );
    expect(run.error).toBe('The assistant failed…');
  });

  it('reports a truncated stream', () => {
    const run = parseChatStream(line({ type: 'text', content: 'x' }) + '\n{"type":"te', 1);
    expect(run.error).toBe('truncated stream');
  });

  it('reports a missing done event', () => {
    const run = parseChatStream(line({ type: 'text', content: 'x' }) + '\n', 1);
    expect(run.error).toBe('no done event');
  });
});
