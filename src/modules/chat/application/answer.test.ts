import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeChat, fakeDocument, type FakeChatState } from '../../../../test/fakes/chat.js';
import type { SearchHit } from '../../search/index.js';
import { NO_LLM_MESSAGE, streamChat, type ChatEvent, type StreamChatOptions } from './answer.js';
import type { LlmMessage, LlmStreamEvent } from '../../llm/index.js';
import type { ChatDeps } from './ports.js';

let d: ChatDeps;
let state: FakeChatState;

beforeEach(() => {
  ({ deps: d, state } = createFakeChat());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const ask = (content: string): LlmMessage[] => [{ role: 'user', content }];

async function run(messages: LlmMessage[], opts: StreamChatOptions = {}): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const e of streamChat(d, messages, opts)) events.push(e);
  return events;
}

function hit(library_id: string, slug: string, score: number): SearchHit {
  return { slug, library_id, domain: 'orders', entry_type: 'endpoint', http_method: 'POST', route: '/refunds', summary: `about ${slug}`, score };
}

function toolCall(name: string, args: string, id = 'call_1'): LlmStreamEvent[] {
  return [
    { type: 'tool_call', call: { id, name, arguments: args } },
    { type: 'end', reason: 'tool_calls' },
  ];
}

const text = (t: string): LlmStreamEvent[] => [
  { type: 'text', text: t },
  { type: 'end', reason: 'stop' },
];

describe('streamChat, regular mode', () => {
  beforeEach(() => {
    state.hits = [hit('orders', 'orders/refund', 1), hit('orders', 'orders/cancel', 0.9), hit('orders', 'orders/other', 0.85)];
    state.docs.set('orders/orders/refund', fakeDocument('orders', 'orders/refund', 'Refund ![x](./a.png)'));
    state.docs.set('orders/orders/cancel', fakeDocument('orders', 'orders/cancel', 'Cancel'));
  });

  it('without an LLM: search results, the no-LLM message and the auto-fetched sources', async () => {
    state.configured = false;
    const events = await run(ask('how do refunds work'), { library_ids: ['orders'] });
    expect(events[0]).toEqual({ type: 'tool', name: 'search_lore', query: 'how do refunds work' });
    expect(events[1]).toMatchObject({ type: 'search_results', data: { terms: 'how do refunds work', total: 3 } });
    expect(events.slice(2)).toEqual([
      { type: 'text', content: NO_LLM_MESSAGE },
      { type: 'sources', docs: [{ library_id: 'orders', slug: 'orders/refund' }, { library_id: 'orders', slug: 'orders/cancel' }] },
      { type: 'done' },
    ]);
    expect(state.streamCalls).toEqual([]);
  });

  it('feeds the search context to the model, runs get_document, and streams the answer', async () => {
    state.linked = [{ ...hit('orders', 'orders/linked', 0), link_type: 'references', from_slug: 'orders/refund' }];
    state.turns = [toolCall('get_document', JSON.stringify({ library_id: 'orders', slug: 'orders/cancel' })), text('Answer [ref:orders/orders/cancel]')];
    const events = await run(ask('refunds?'));
    expect(events).toContainEqual({ type: 'tool', name: 'get_document', query: 'orders/cancel' });
    expect(events).toContainEqual({ type: 'text', content: 'Answer [ref:orders/orders/cancel]' });
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(events.at(-2)).toMatchObject({ type: 'sources' });

    expect(state.streamCalls).toHaveLength(2);
    const req = state.streamCalls[0];
    expect(req.temperature).toBe(0);
    expect(req.timeoutMs).toBe(60_000);
    expect(req.maxRetries).toBe(1);
    expect(req.tools.map((t) => t.name)).toEqual(['get_document', 'list_libraries']);
    for (const tool of req.tools) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'name', 'parameters']);
      expect(tool.description).not.toBe('');
      expect(tool.parameters).toMatchObject({ type: 'object' });
    }
    const context = req.messages[2].content as string;
    expect(context).toContain('## Relevant documentation');
    expect(context).toContain('- **orders.refund** (endpoint POST /refunds): about orders/refund [ref:orders/orders/refund]');
    expect(context).toContain('## Related documentation (via links)');
    expect(context).toContain('← references from orders.refund');
    expect(context).toContain('/static/libraries/orders/versions/v1/images/orders/refund/a.png');
    const toolResult = req.messages.find((m) => m.role === 'tool')!;
    expect(JSON.parse(toolResult.content as string)).toMatchObject({ library_id: 'orders', slug: 'orders/cancel', content: 'Cancel' });
    expect(req.messages).toContainEqual({
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'call_1', name: 'get_document', arguments: '{"library_id":"orders","slug":"orders/cancel"}' }],
    });
    expect(req.messages).toContainEqual({ role: 'tool', toolCallId: 'call_1', content: toolResult.content });
    expect(state.streamCalls[1]).toMatchObject({ timeoutMs: 60_000, maxRetries: 1 });
  });

  it('brainstorm mode uses temperature 0.7; link expansion and missing docs are best-effort', async () => {
    state.linksFail = true;
    state.docs.delete('orders/orders/cancel');
    state.turns = [text('ideas')];
    const events = await run(ask('ideas?'), { mode: 'brainstorm' });
    expect(state.streamCalls[0].temperature).toBe(0.7);
    expect(events).toContainEqual({ type: 'sources', docs: [{ library_id: 'orders', slug: 'orders/refund' }] });
  });

  it('expands links in the searched library and branch', async () => {
    state.turns = [text('ok')];
    await run(ask('refunds?'), { library_ids: ['orders'], branch: 'feat' });
    expect(state.linkScopes).toEqual([[{ library_id: 'orders', branch: 'feat' }]]);
  });

  it('answers tool calls: missing documents, list_libraries, unknown tools and bad arguments', async () => {
    state.libraries = [{ id: 'orders', display_name: 'Orders', namespace_id: 'default', created_at: 't', current_version: 'v1', document_count: 2 }];
    state.turns = [
      [
        { type: 'tool_call', call: { id: 'a', name: 'get_document', arguments: '{"library_id":"orders","slug":"nope"}' } },
        { type: 'tool_call', call: { id: 'b', name: 'list_libraries', arguments: '{}' } },
        { type: 'tool_call', call: { id: 'c', name: 'rm_rf', arguments: '{}' } },
        { type: 'tool_call', call: { id: 'e', name: 'get_document', arguments: '{bad' } },
        { type: 'end', reason: 'tool_calls' },
      ],
      text('done'),
    ];
    await run(ask('q'));
    const results = state.streamCalls[1].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content as string));
    expect(results).toEqual([
      'Document not found: nope',
      state.libraries,
      { error: 'Unknown tool: rm_rf' },
      { error: 'Tool call failed' },
    ]);
  });

  it('stops after five model turns', async () => {
    state.turns = Array.from({ length: 6 }, () => toolCall('list_libraries', '{}'));
    await run(ask('q'));
    expect(state.streamCalls).toHaveLength(5);
  });

  it.each([['length' as const], ['other' as const], ['stop' as const], [undefined]])('does not ask the model again when a turn ends with %s', async (reason) => {
    const end: LlmStreamEvent[] = reason ? [{ type: 'end', reason }] : [];
    state.turns = [[{ type: 'text', text: 'partial answer' }, ...end], text('repeated')];
    const events = await run(ask('q'));
    expect(state.streamCalls).toHaveLength(1);
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', content: 'partial answer' }]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('passes the abort signal to the model and stops between turns once it aborts', async () => {
    const ac = new AbortController();
    vi.spyOn(d.docs, 'listLibraries').mockImplementation(async () => {
      ac.abort();
      return [];
    });
    state.turns = [toolCall('list_libraries', '{}'), text('never streamed')];
    const events = await run(ask('q'), { signal: ac.signal });
    expect(state.streamCalls).toHaveLength(1);
    expect(state.streamCalls[0].signal).toBe(ac.signal);
    expect(events).not.toContainEqual({ type: 'text', content: 'never streamed' });
    expect(events).not.toContainEqual({ type: 'done' });
  });

  it('stops reading a turn once the signal aborts', async () => {
    const ac = new AbortController();
    state.turns = [
      [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
        { type: 'end', reason: 'stop' },
      ],
    ];
    const events: ChatEvent[] = [];
    for await (const e of streamChat(d, ask('q'), { signal: ac.signal })) {
      events.push(e);
      if (e.type === 'text') ac.abort();
    }
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', content: 'first' }]);
    expect(events.at(-1)).toEqual({ type: 'text', content: 'first' });
  });

  it('does nothing for an already aborted request', async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await run(ask('q'), { signal: ac.signal })).toEqual([]);
    expect(await run(ask('q'), { signal: ac.signal, pinnedDocs: [{ library_id: 'orders', slug: 'orders/refund' }] })).toEqual([]);
    expect(state.streamCalls).toEqual([]);
  });

  it('searches every library of the scope, and all libraries without one', async () => {
    state.configured = false;
    await run(ask('refunds'), { library_ids: ['orders', 'payments'] });
    expect(state.fullTextLibraries).toEqual(['orders', 'payments']);
    state.fullTextLibraries = [];
    await run(ask('refunds'));
    expect(state.fullTextLibraries).toEqual([undefined]);
  });

  it('looks a dotted slug up in each library of the scope', async () => {
    const events = await run(ask('orders.orders.refund'), { library_ids: ['payments', 'orders'] });
    expect(state.slugLookups).toContain('payments/orders/refund');
    expect(events[0]).toMatchObject({ type: 'text', content: expect.stringContaining('Refund') });
  });

  it('returns a document named by a dotted slug directly', async () => {
    const events = await run(ask('orders.orders.refund'));
    expect(events).toEqual([
      { type: 'text', content: 'Refund ![x](/static/libraries/orders/versions/v1/images/orders/refund/a.png)' },
      { type: 'done' },
    ]);
  });

  it('searches a dotted slug within its library when no document matches it', async () => {
    state.hits = [];
    state.configured = false;
    const events = await run(ask('orders.unknown-thing'));
    expect(events[0]).toEqual({ type: 'tool', name: 'search_lore', query: 'unknown thing' });
    expect(events.slice(1)).toEqual([{ type: 'text', content: NO_LLM_MESSAGE }, { type: 'done' }]);
  });

  it('without a user message: no search, the model gets the empty context', async () => {
    state.turns = [text('hi')];
    await run([{ role: 'assistant', content: 'hello' }]);
    expect(state.streamCalls[0].messages.at(-1)!.content).toBe('## Relevant documentation\n\nNo documents found.');
  });
});

describe('streamChat, pinned documents', () => {
  beforeEach(() => {
    state.docs.set('orders/orders/refund', fakeDocument('orders', 'orders/refund', 'Pinned body'));
  });

  it('without an LLM: the no-LLM message only, and no pinned document is read', async () => {
    state.configured = false;
    const bySlug = vi.spyOn(d.docs, 'bySlug');
    expect(await run(ask('q'), { pinnedDocs: [{ library_id: 'orders', slug: 'orders/refund' }] })).toEqual([
      { type: 'text', content: NO_LLM_MESSAGE },
      { type: 'done' },
    ]);
    expect(bySlug).not.toHaveBeenCalled();
  });

  it('reads each pinned document once', async () => {
    state.turns = [text('ok')];
    const bySlug = vi.spyOn(d.docs, 'bySlug');
    const doc = { library_id: 'orders', slug: 'orders/refund' };
    await run(ask('q'), { pinnedDocs: [doc, { ...doc }, doc] });
    expect(bySlug).toHaveBeenCalledTimes(1);
  });

  it('injects the pinned documents and reports tool calls with their library', async () => {
    state.turns = [toolCall('get_document', JSON.stringify({ library_id: 'orders', slug: 'orders/refund' })), text('ok')];
    const events = await run(ask('q'), { pinnedDocs: [{ library_id: 'orders', slug: 'orders/refund' }, { library_id: 'x', slug: 'gone' }] });
    expect(events).toEqual([
      { type: 'tool', name: 'get_document', query: 'orders/refund', library_id: 'orders' },
      { type: 'text', content: 'ok' },
      { type: 'done' },
    ]);
    const req = state.streamCalls[0];
    expect(req.temperature).toBe(0);
    // The tool result goes back to the model as the last message of the conversation
    expect(state.streamCalls[1].messages.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'call_1',
      content: JSON.stringify({ library_id: 'orders', slug: 'orders/refund', summary: 'summary of orders/refund', content: 'Pinned body' }),
    });
    const pinned = state.streamCalls[1].messages.find((m) => m.role === 'system' && String(m.content).startsWith('## Pinned'))!;
    expect(pinned.content).toBe('## Pinned documentation\n\n### orders.refund [ref:orders/orders/refund]\n\nPinned body');
  });

  it('says so when no pinned document exists', async () => {
    state.turns = [text('ok')];
    await run(ask('q'), { pinnedDocs: [{ library_id: 'x', slug: 'gone' }] });
    expect(state.streamCalls[0].messages.at(-1)!.content).toBe('## Pinned documentation\n\nNo documents found.');
  });
});
