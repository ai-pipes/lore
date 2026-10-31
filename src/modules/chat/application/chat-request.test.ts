import { describe, expect, it } from 'vitest';
import { MAX_CHAT_CHARS, MAX_CHAT_MESSAGES, MAX_PINNED_DOCS, MAX_SCOPE_LIBRARIES, parseChatRequest } from './chat-request.js';

const user = (content: string) => ({ role: 'user', content });
const distinct = (n: number) => Array.from({ length: n }, (_, i) => ({ library_id: 'orders', slug: `doc-${i}` }));

describe('parseChatRequest', () => {
  it('accepts a minimal request', () => {
    expect(parseChatRequest({ messages: [user('hi')] })).toEqual({ ok: true, value: { messages: [{ role: 'user', content: 'hi' }] } });
  });

  it('keeps the optional fields and drops unknown ones', () => {
    const r = parseChatRequest({
      messages: [user('a'), { role: 'assistant', content: 'b' }],
      library_id: 'orders',
      branch: 'main',
      mode: 'brainstorm',
      pinned_docs: [{ library_id: 'orders', slug: 'orders/refund' }],
      extra: 1,
    });
    expect(r).toEqual({
      ok: true,
      value: {
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
        library_ids: ['orders'],
        branch: 'main',
        mode: 'brainstorm',
        pinned_docs: [{ library_id: 'orders', slug: 'orders/refund' }],
      },
    });
  });

  it('scopes to library_ids and the older single library_id together, without repeats', () => {
    const r = parseChatRequest({ messages: [user('a')], library_id: 'orders', library_ids: ['payments', 'orders', 'payments'] });
    expect(r.ok && r.value.library_ids).toEqual(['orders', 'payments']);
    const none = parseChatRequest({ messages: [user('a')], library_ids: [] });
    expect(none.ok && none.value.library_ids).toBeUndefined();
  });

  it('caps the libraries of the scope', () => {
    const ids = Array.from({ length: MAX_SCOPE_LIBRARIES + 1 }, (_, i) => `lib-${i}`);
    expect(parseChatRequest({ messages: [user('a')], library_ids: ids.slice(1) }).ok).toBe(true);
    expect(parseChatRequest({ messages: [user('a')], library_ids: ids }).ok).toBe(false);
  });

  it.each([
    ['library_ids not an array', { messages: [user('a')], library_ids: 'orders' }],
    ['a non-string library id', { messages: [user('a')], library_ids: [1] }],
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['no messages', {}],
    ['empty messages', { messages: [] }],
    ['a system message', { messages: [{ role: 'system', content: 'x' }] }],
    ['a tool message', { messages: [{ role: 'tool', content: 'x' }] }],
    ['non-string content', { messages: [{ role: 'user', content: 1 }] }],
    ['null content', { messages: [{ role: 'user', content: null }] }],
    ['a bad mode', { messages: [user('a')], mode: 'chaos' }],
    ['a non-string library_id', { messages: [user('a')], library_id: 5 }],
    ['an empty library_id', { messages: [user('a')], library_id: '' }],
    ['a bad pinned doc', { messages: [user('a')], pinned_docs: [{ slug: 'x' }] }],
    ['pinned_docs not an array', { messages: [user('a')], pinned_docs: 'x' }],
  ])('rejects %s', (_name, body) => {
    const r = parseChatRequest(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual(expect.any(String));
  });

  it('caps the number of messages', () => {
    const many = Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => user('a'));
    expect(parseChatRequest({ messages: many.slice(1) }).ok).toBe(true);
    const r = parseChatRequest({ messages: many });
    expect(r).toEqual({ ok: false, error: expect.stringContaining('messages') });
  });

  it('caps the total characters of the messages', () => {
    const half = 'x'.repeat(MAX_CHAT_CHARS / 2);
    expect(parseChatRequest({ messages: [user(half), user(half)] }).ok).toBe(true);
    expect(parseChatRequest({ messages: [user(half), user(half + 'x')] })).toEqual({
      ok: false,
      error: `messages may hold at most ${MAX_CHAT_CHARS} characters in total`,
    });
  });

  it('de-duplicates pinned documents and caps the distinct ones', () => {
    const doc = { library_id: 'orders', slug: 'orders/refund' };
    const r = parseChatRequest({ messages: [user('a')], pinned_docs: Array.from({ length: 50 }, () => doc) });
    expect(r).toEqual({ ok: true, value: { messages: [{ role: 'user', content: 'a' }], pinned_docs: [doc] } });

    expect(parseChatRequest({ messages: [user('a')], pinned_docs: distinct(MAX_PINNED_DOCS) }).ok).toBe(true);
    expect(parseChatRequest({ messages: [user('a')], pinned_docs: distinct(MAX_PINNED_DOCS + 1) })).toEqual({
      ok: false,
      error: `pinned_docs may name at most ${MAX_PINNED_DOCS} documents`,
    });
  });

  it('rejects a huge pinned_docs array before de-duplicating it', () => {
    const doc = { library_id: 'orders', slug: 'orders/refund' };
    expect(parseChatRequest({ messages: [user('a')], pinned_docs: Array.from({ length: 15_000 }, () => doc) }).ok).toBe(false);
  });
});
