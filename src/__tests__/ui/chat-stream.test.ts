/**
 * The chat page's answer streaming and session switching, run as shipped (CHAT_JS) inside jsdom
 * with real marked + DOMPurify and a scripted `fetch`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { CHAT_JS, MAX_CHAT_CHARS, MAX_CHAT_MESSAGES, MAX_PINNED_DOCS, getChatHTML } from '../../modules/chat/index.js';

const NM = join(process.cwd(), 'node_modules');
const MARKED = readFileSync(join(NM, 'marked/lib/marked.umd.js'), 'utf8');
const PURIFY = readFileSync(join(NM, 'dompurify/dist/purify.min.js'), 'utf8');

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A `/api/chat` response the test feeds line by line. */
class ChatStream {
  private chunks: Uint8Array[] = [];
  private ended = false;
  private wake: (() => void) | null = null;
  push(event: object): void {
    this.chunks.push(new TextEncoder().encode(JSON.stringify(event) + '\n'));
    this.wake?.();
  }
  end(): void {
    this.ended = true;
    this.wake?.();
  }
  reader() {
    return {
      read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
        while (this.chunks.length === 0 && !this.ended) await new Promise<void>((r) => (this.wake = r));
        const value = this.chunks.shift();
        return value ? { done: false, value } : { done: true };
      },
    };
  }
}

interface Session {
  messages: { role: string; content: string; metadata?: unknown }[];
  pinned_docs?: { library_id: string; slug: string }[];
  scope_filters?: string[];
}

type Win = JSDOM['window'] & Record<string, unknown>;

let w: Win;
let calls: Call[];
let streams: ChatStream[];
/** GET /api/sessions/:id answers; a promise holds the answer back until the test resolves it. */
let sessions: Record<string, Session | Promise<Session>>;
/** When set, POST /api/chat answers with this status and JSON body instead of a stream. */
let chatFailure: { status: number; body: unknown } | null;

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const response = (status: number, data: unknown, stream?: ChatStream) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  body: stream ? { getReader: () => stream.reader() } : null,
});

beforeEach(async () => {
  const dom = new JSDOM(getChatHTML(), { runScripts: 'outside-only', url: 'http://localhost/' });
  w = dom.window as unknown as Win;
  w.eval(MARKED);
  w.eval(PURIFY);
  w.hljs = { highlightElement() {} };
  w.mermaid = { initialize() {}, render: async () => ({ svg: '' }) };
  w.TextDecoder = TextDecoder;
  calls = [];
  streams = [];
  sessions = {};
  chatFailure = null;
  (w as Record<string, unknown>).fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });
    if (url === '/api/chat') {
      if (chatFailure) return response(chatFailure.status, chatFailure.body);
      const s = new ChatStream();
      streams.push(s);
      return response(200, null, s);
    }
    if (url === '/api/sessions' && method === 'POST') return response(201, { id: 'new' });
    if (url === '/api/sessions') return response(200, []);
    const saving = /^\/api\/sessions\/([^/]+)\/messages$/.exec(url);
    const target = saving && sessions[saving[1]];
    if (target && !(target instanceof Promise) && method === 'POST') {
      target.messages.push(JSON.parse(init.body!) as Session['messages'][number]);
      return response(201, {});
    }
    const m = /^\/api\/sessions\/([^/]+)$/.exec(url);
    if (m && method === 'GET') return response(200, await sessions[m[1]]);
    if (url === '/api/services') return response(200, []);
    return response(url.startsWith('/api/auth/') ? 401 : 200, {});
  };
  w.eval(CHAT_JS);
  await flush();
});

const call = <T = unknown>(fn: string, ...args: unknown[]) => (w[fn] as (...a: unknown[]) => T)(...args);

/** Types `text` and sends it; resolves when the answer stream has been handled. */
function send(text: string): Promise<void> {
  (w.document.getElementById('input') as HTMLTextAreaElement).value = text;
  return call<Promise<void>>('handleSend');
}

/** The body of the last /api/chat request. */
const chatBody = () =>
  calls.filter((c) => c.url === '/api/chat').at(-1)!.body as { messages: { role: string; content: string }[]; pinned_docs?: unknown[] };

/** Sends `text` and ends its answer stream at once. */
async function sendAndFinish(text: string): Promise<void> {
  const done = send(text);
  await flush();
  streams.at(-1)!.push({ type: 'done' });
  streams.at(-1)!.end();
  await done;
}

/** An answer a third of the character limit long, starting with `tag`. */
const big = (tag: string) => tag + 'x'.repeat(Math.floor(MAX_CHAT_CHARS / 3));

const saved = (sessionId: string) =>
  calls.filter((c) => c.method === 'POST' && c.url === `/api/sessions/${sessionId}/messages`).map((c) => c.body as { role: string; content: string });

const messagesText = () => w.document.getElementById('messages')!.textContent ?? '';

describe('chat answer streaming', () => {
  it('scopes the question to every selected service', async () => {
    w.eval("scopeFilters = ['orders', 'payments'];");
    const done = send('refunds?');
    await flush();
    const chat = calls.find((c) => c.url === '/api/chat')!.body as Record<string, unknown>;
    expect(chat.library_ids).toEqual(['orders', 'payments']);
    expect(chat).not.toHaveProperty('library_id');
    streams[0].push({ type: 'done' });
    streams[0].end();
    await done;
  });

  it('sends no scope when every service is selected', async () => {
    const done = send('refunds?');
    await flush();
    expect(calls.find((c) => c.url === '/api/chat')!.body).not.toHaveProperty('library_ids');
    streams[0].end();
    await done;
  });

  it('keeps the Sources footer under the finished answer', async () => {
    const done = send('refunds?');
    await flush();
    streams[0].push({ type: 'text', content: 'Refunds are async.' });
    streams[0].push({ type: 'sources', docs: [{ library_id: 'orders', slug: 'orders/refund' }] });
    streams[0].push({ type: 'done' });
    streams[0].end();
    await done;
    const bubble = w.document.querySelector('.bubble.a')!;
    expect(bubble.textContent).toContain('Refunds are async.');
    const footer = bubble.querySelector('.retrieved-footer');
    expect(footer?.textContent).toContain('Sources:');
    expect(footer?.querySelector('.cite-chip')?.getAttribute('data-slug')).toBe('orders/refund');
  });
});

describe('switching chats while an answer streams', () => {
  beforeEach(async () => {
    sessions.A = { messages: [{ role: 'user', content: 'earlier question in A' }] };
    sessions.B = { messages: [{ role: 'user', content: 'question in B' }] };
    await call('loadSession', { id: 'A' });
  });

  it('saves the answer into the chat it was asked in, not the one open when it ends', async () => {
    const done = send('new question for A');
    await flush();
    streams[0].push({ type: 'text', content: 'Answer for A' });
    await flush();

    await call('loadSession', { id: 'B' });
    streams[0].push({ type: 'tool', name: 'search_lore', query: 'x' });
    streams[0].push({ type: 'text', content: ', continued' });
    streams[0].push({ type: 'sources', docs: [{ library_id: 'orders', slug: 'orders/refund' }] });
    streams[0].push({ type: 'done' });
    streams[0].end();
    await done;
    await flush();

    expect(saved('A')).toEqual([
      { role: 'user', content: 'new question for A', metadata: null },
      { role: 'assistant', content: 'Answer for A, continued', metadata: null },
    ]);
    expect(saved('B')).toEqual([]);
    expect(w.eval('chatHistory')).toEqual([{ role: 'user', content: 'question in B' }]);
    // B's view shows only B
    expect(messagesText()).toContain('question in B');
    expect(messagesText()).not.toContain('Answer for A');
    expect(w.document.querySelector('#messages .retrieved-footer')).toBeNull();
    expect(w.document.querySelector('#messages .search-notice')).toBeNull();
  });

  it('shows the answer in its chat when that chat is opened again before the answer ends', async () => {
    const done = send('new question for A');
    await flush();
    streams[0].push({ type: 'text', content: 'Answer for A' });
    await flush();

    await call('loadSession', { id: 'B' });
    await call('loadSession', { id: 'A' });
    expect(messagesText()).not.toContain('Answer for A');
    streams[0].push({ type: 'text', content: ', continued' });
    streams[0].push({ type: 'done' });
    streams[0].end();
    await done;
    await flush();

    expect(messagesText()).toContain('Answer for A, continued');
    expect(w.eval('chatHistory')).toEqual([
      { role: 'user', content: 'earlier question in A' },
      { role: 'user', content: 'new question for A' },
      { role: 'assistant', content: 'Answer for A, continued' },
    ]);
    expect(saved('A').filter((m) => m.role === 'assistant')).toHaveLength(1);
  });

  it('a new chat started mid-answer does not receive the answer', async () => {
    const done = send('new question for A');
    await flush();
    (w.document.getElementById('newChatBtn') as HTMLButtonElement).click();
    streams[0].push({ type: 'text', content: 'Answer for A' });
    streams[0].push({ type: 'done' });
    streams[0].end();
    await done;
    await flush();
    expect(saved('A').map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(w.eval('chatHistory')).toEqual([]);
    expect(w.eval('currentSessionId')).toBeNull();
    expect(messagesText()).not.toContain('Answer for A');
  });

  it('ignores a slow chat load once another chat was opened', async () => {
    let release!: (s: Session) => void;
    sessions.C = new Promise<Session>((r) => (release = r));
    const slow = call<Promise<void>>('loadSession', { id: 'C' });
    await flush();
    await call('loadSession', { id: 'B' });
    release({ messages: [{ role: 'user', content: 'question in C' }], pinned_docs: [{ library_id: 'orders', slug: 'orders/refund' }], scope_filters: ['orders'] });
    await slow;
    await flush();

    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
    expect(w.eval('contextDocs')).toEqual([]);
    expect(w.eval('scopeFilters')).toEqual([]);
    expect(w.eval('chatHistory')).toEqual([{ role: 'user', content: 'question in B' }]);
    expect(messagesText()).not.toContain('question in C');
  });
});

describe('staying within the /api/chat limits', () => {
  it('sends only the most recent messages of a long chat', async () => {
    const turns = Array.from({ length: 150 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    w.eval(`chatHistory = ${JSON.stringify(turns)};`);
    await sendAndFinish('latest question');
    const sent = chatBody().messages;
    expect(sent).toHaveLength(MAX_CHAT_MESSAGES);
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'latest question' });
    expect(sent.at(-2)).toEqual({ role: 'assistant', content: 'm149' });
    // the whole history stays on screen and in memory
    expect((w.eval('chatHistory') as unknown[]).length).toBe(151);
  });

  it('drops the oldest messages once the history holds too many characters', async () => {
    const turns = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: big('a1') },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: big('a2') },
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: big('a3') },
    ];
    w.eval(`chatHistory = ${JSON.stringify(turns)};`);
    await sendAndFinish('latest question');
    const sent = chatBody().messages;
    expect(sent.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(MAX_CHAT_CHARS);
    expect(sent.map((m) => m.content.slice(0, 2))).toEqual(['q2', 'a2', 'q3', 'a3', 'la']);
  });

  it('always sends the latest question, even when it alone is over the limit', async () => {
    w.eval(`chatHistory = ${JSON.stringify([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }])};`);
    const huge = 'y'.repeat(MAX_CHAT_CHARS + 1);
    await sendAndFinish(huge);
    expect(chatBody().messages).toEqual([{ role: 'user', content: huge }]);
  });

  it('shows the error the server gives instead of the bare status', async () => {
    chatFailure = { status: 400, body: { error: 'messages may hold at most 200000 characters in total' } };
    await send('question');
    await flush();
    expect(messagesText()).toContain('messages may hold at most 200000 characters in total');
    expect(messagesText()).not.toContain('HTTP 400');
  });

  it('falls back to the status when the error response has no message', async () => {
    chatFailure = { status: 502, body: null };
    await send('question');
    await flush();
    expect(messagesText()).toContain('HTTP 502');
  });

  it('pins at most the server limit of documents, and says so', async () => {
    const limit = w.document.getElementById('ctxLimit')!;
    expect(limit.hidden).toBe(true);
    for (let i = 0; i <= MAX_PINNED_DOCS; i++) call('addToContext', { library_id: 'orders', slug: `doc-${i}` });
    expect((w.eval('contextDocs') as unknown[]).length).toBe(MAX_PINNED_DOCS);
    expect(limit.hidden).toBe(false);
    expect(limit.textContent).toContain(String(MAX_PINNED_DOCS));

    await sendAndFinish('question');
    expect(chatBody().pinned_docs).toHaveLength(MAX_PINNED_DOCS);

    call('removeFromContext', 'doc-0', 'orders');
    expect(limit.hidden).toBe(true);
    expect(call('addToContext', { library_id: 'orders', slug: 'doc-extra' })).toBe(true);
    expect((w.eval('contextDocs') as unknown[]).length).toBe(MAX_PINNED_DOCS);
  });

  it('does not mark a suggested document as added when the context is full', async () => {
    for (let i = 0; i < MAX_PINNED_DOCS; i++) call('addToContext', { library_id: 'orders', slug: `doc-${i}` });
    const chip = w.document.createElement('span');
    chip.className = 'suggest-add';
    chip.setAttribute('data-lib', 'orders');
    chip.setAttribute('data-slug', 'one-more');
    chip.textContent = '+ one-more';
    w.document.getElementById('messages')!.appendChild(chip);
    chip.click();
    expect(chip.classList.contains('added')).toBe(false);
    expect(w.document.getElementById('ctxLimit')!.hidden).toBe(false);
  });
});
