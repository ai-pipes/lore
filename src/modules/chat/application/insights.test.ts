import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeChat, type FakeChatState } from '../../../../test/fakes/chat.js';
import { renderPrompt } from '../../llm/index.js';
import type { ChatOwner } from '../domain/session.js';
import type { ChatDeps } from './ports.js';
import { citedDocumentLinks, publishSession } from './insights.js';

let d: ChatDeps;
let state: FakeChatState;
let sessionId: string;
const ALICE: ChatOwner = { userId: 'user-alice', displayName: 'Alice', isAdmin: false };
const ADMIN: ChatOwner = { userId: 'user-admin', displayName: 'Ada Admin', isAdmin: true };

beforeEach(async () => {
  ({ deps: d, state } = createFakeChat());
  state.libraries = [{ id: 'orders-api', display_name: 'Orders', namespace_id: 'default', created_at: 't', current_version: 'v1', document_count: 1 }];
  state.currentDocs.add('orders-api/orders/refund');
  const s = await d.chats.create(ALICE.userId, { title: 'Session title', pinned_docs: [{ library_id: 'orders-api', slug: 'orders/refund' }] });
  sessionId = s.id;
  await d.chats.addMessage(ALICE.userId, sessionId, 'user', 'how do refunds work?');
  await d.chats.addMessage(ALICE.userId, sessionId, 'assistant', 'see [ref:orders-api/orders/refund] and [ref:orders-api/missing]');
});

describe('publishSession', () => {
  it('publishes into the insights library at insight/<session id> with links to cited documents', async () => {
    const r = await publishSession(d, ALICE, { sessionId, libraryId: 'orders-api' });
    expect(r).toEqual({
      ok: true,
      value: { doc_id: 'doc-1', title: 'Summary title', slug: `insight/${sessionId}`, library_id: 'insights', links: 1 },
    });
    const stored = state.insightDocs.get(`insights/insights/insight/${sessionId}`)!.input;
    expect(stored).toMatchObject({
      library_id: 'insights',
      version_id: 'insights',
      domain: 'orders-api',
      entry_type: 'insight',
      summary: 'Summary title',
      content: 'Summary title\n\nbody',
      category: 'knowledge',
      links: [{ slug: 'orders/refund', library: 'orders-api', type: 'references' }],
      author_user_id: 'user-alice',
      author_name: 'Alice',
    });
    expect(state.completeCalls).toEqual([
      {
        messages: [
          { role: 'system', content: renderPrompt('publish/summary') },
          { role: 'user', content: '**User:** how do refunds work?\n\n**AI:** see [ref:orders-api/orders/refund] and [ref:orders-api/missing]' },
        ],
        timeoutMs: 120_000,
        maxRetries: 1,
      },
    ]);
    expect(state.sessions[0]).toMatchObject({ is_published: true, published_doc_id: 'doc-1' });
  });

  it('uses the given title and domain', async () => {
    const r = await publishSession(d, ALICE, { sessionId, title: ' Mine ', domain: 'refunds' });
    expect(r.ok && r.value.title).toBe('Mine');
    expect(state.insightDocs.get(`insights/insights/insight/${sessionId}`)!.input.domain).toBe('refunds');
  });

  it('returns slug_forbidden for a non-admin with a slug, and writes nothing', async () => {
    expect(await publishSession(d, ALICE, { sessionId, slug: 'team/x' })).toEqual({ ok: false, error: 'slug_forbidden' });
    expect(state.insightDocs.size).toBe(0);
    expect(state.completeCalls).toEqual([]);
  });

  it('lets an admin choose the slug and overwrite an existing insight', async () => {
    const other = await d.chats.create(ADMIN.userId, {});
    await d.chats.addMessage(ADMIN.userId, other.id, 'user', 'q');
    const mine = await d.chats.create(ADMIN.userId, {});
    await d.chats.addMessage(ADMIN.userId, mine.id, 'user', 'q2');
    expect((await publishSession(d, ADMIN, { sessionId: other.id, slug: 'team/x' })).ok).toBe(true);
    const r = await publishSession(d, ADMIN, { sessionId: mine.id, slug: 'team/x' });
    expect(r).toMatchObject({ ok: true, value: { slug: 'team/x', doc_id: 'doc-1' } });
    expect(state.insightDocs.get('insights/insights/team/x')!.input).toMatchObject({ author_user_id: ADMIN.userId, author_name: 'Ada Admin' });
  });

  it('returns slug_taken when the slug exists, for a non-admin', async () => {
    state.insightDocs.set(`insights/insights/insight/${sessionId}`, { id: 'old', input: {} as never });
    expect(await publishSession(d, ALICE, { sessionId })).toEqual({ ok: false, error: 'slug_taken' });
    expect(state.sessions[0].is_published).toBe(false);
  });

  it('returns slug_taken when the insert races with another publish', async () => {
    d.insights.insert = async () => 'exists';
    expect(await publishSession(d, ALICE, { sessionId })).toEqual({ ok: false, error: 'slug_taken' });
  });

  it('rethrows other insert errors', async () => {
    d.insights.insert = async () => {
      throw new Error('db down');
    };
    await expect(publishSession(d, ALICE, { sessionId })).rejects.toThrow('db down');
  });

  it('returns already_published on a second call', async () => {
    expect((await publishSession(d, ALICE, { sessionId })).ok).toBe(true);
    expect(await publishSession(d, ALICE, { sessionId })).toEqual({ ok: false, error: 'already_published' });
  });

  it('checks the library with one lookup, not by listing every library', async () => {
    d.docs.listLibraries = async () => {
      throw new Error('listLibraries must not be used');
    };
    expect((await publishSession(d, ALICE, { sessionId, libraryId: 'orders-api' })).ok).toBe(true);
  });

  it('returns not_found, library_not_found, empty and no_llm', async () => {
    expect(await publishSession(d, ALICE, { sessionId: 'nope' })).toEqual({ ok: false, error: 'not_found' });
    expect(await publishSession(d, ADMIN, { sessionId, libraryId: 'ghost' })).toEqual({ ok: false, error: 'library_not_found' });
    const empty = await d.chats.create(ALICE.userId, {});
    expect(await publishSession(d, ALICE, { sessionId: empty.id })).toEqual({ ok: false, error: 'empty' });
    state.configured = false;
    expect(await publishSession(d, ALICE, { sessionId })).toEqual({ ok: false, error: 'no_llm' });
    expect(state.ensureCalls).toBe(0);
    expect(state.completeCalls).toEqual([]);
  });

  it("returns not_found for another owner's session, even for an admin, and writes nothing", async () => {
    expect(await publishSession(d, ADMIN, { sessionId })).toEqual({ ok: false, error: 'not_found' });
    expect(await publishSession(d, { ...ALICE, userId: 'user-bob', displayName: 'Bob' }, { sessionId })).toEqual({ ok: false, error: 'not_found' });
    expect(state.insightDocs.size).toBe(0);
    expect(state.completeCalls).toEqual([]);
    expect(state.sessions[0].is_published).toBe(false);
  });

  it('returns not_found when the session is deleted while publishing', async () => {
    d.chats.messages = async () => null;
    expect(await publishSession(d, ALICE, { sessionId })).toEqual({ ok: false, error: 'not_found' });
    expect(state.insightDocs.size).toBe(0);
  });

  it('falls back to the session title when the summary is empty', async () => {
    state.summary = '';
    const r = await publishSession(d, ALICE, { sessionId });
    expect(r.ok && r.value.title).toBe('Session title');
  });
});

describe('citedDocumentLinks', () => {
  it('resolves refs in one lookup and drops missing ones', async () => {
    const links = await citedDocumentLinks(d, ['[ref:orders-api/orders/refund] [ref:orders-api/nope]'], [], 'insights');
    expect(links).toEqual([{ slug: 'orders/refund', library: 'orders-api', type: 'references' }]);
    expect(state.existingCalls).toHaveLength(1);
  });

  it('makes no lookup when there is nothing to resolve', async () => {
    expect(await citedDocumentLinks(d, ['no refs'], [], 'insights')).toEqual([]);
    expect(state.existingCalls).toHaveLength(0);
  });
});
