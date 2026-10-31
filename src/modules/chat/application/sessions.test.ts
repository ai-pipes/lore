import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeChat, type FakeChatState } from '../../../../test/fakes/chat.js';
import type { ChatDeps } from './ports.js';
import { addMessage, createSession, deleteSession, getSession, listSessions, updateSession } from './sessions.js';

let d: ChatDeps;
let state: FakeChatState;
const A = 'user-a';
const B = 'user-b';

beforeEach(() => {
  ({ deps: d, state } = createFakeChat());
});

describe('chat sessions', () => {
  it('creates, lists, gets, updates and deletes a session', async () => {
    const s = await createSession(d, A, { title: 'T', pinned_docs: [{ library_id: 'a', slug: 'b' }] });
    expect(s).toMatchObject({ title: 'T', is_published: false, user_id: A });
    expect((await listSessions(d, A)).map((x) => x.id)).toEqual([s.id]);
    expect(await getSession(d, A, s.id)).toMatchObject({ id: s.id, messages: [] });
    expect(await updateSession(d, A, s.id, { title: 'U' })).toMatchObject({ title: 'U' });
    expect(await deleteSession(d, A, s.id)).toBe(true);
    expect(await getSession(d, A, s.id)).toBeNull();
    expect(await updateSession(d, A, s.id, { title: 'V' })).toBeNull();
    expect(await deleteSession(d, A, s.id)).toBe(false);
  });

  it('lists at most `limit` sessions', async () => {
    for (let i = 0; i < 3; i++) await createSession(d, A, {});
    expect(await listSessions(d, A, 2)).toHaveLength(2);
  });

  it("another owner's session is invisible and unchanged", async () => {
    const s = await createSession(d, A, { title: 'Mine' });
    await addMessage(d, A, s.id, 'user', 'hello');
    expect(await listSessions(d, B)).toEqual([]);
    expect(await getSession(d, B, s.id)).toBeNull();
    expect(await updateSession(d, B, s.id, { title: 'Stolen' })).toBeNull();
    expect(await deleteSession(d, B, s.id)).toBe(false);
    expect(await addMessage(d, B, s.id, 'user', 'injected')).toEqual({ ok: false, error: 'not_found' });
    expect(state.sessions[0]).toMatchObject({ title: 'hello', user_id: A });
    expect(state.messages.map((m) => m.content)).toEqual(['hello']);
  });
});

describe('a session deleted between two repository calls', () => {
  it('getSession returns null when its messages are gone', async () => {
    const s = await createSession(d, A, {});
    d.chats.messages = async () => null;
    expect(await getSession(d, A, s.id)).toBeNull();
  });

  it('addMessage still succeeds and leaves the title alone', async () => {
    const s = await createSession(d, A, {});
    d.chats.messages = async () => null;
    expect(await addMessage(d, A, s.id, 'user', 'hi')).toMatchObject({ ok: true, value: { content: 'hi' } });
    expect(state.sessions[0].title).toBe('New chat');
  });
});

describe('addMessage', () => {
  it('returns not_found for a missing session', async () => {
    expect(await addMessage(d, A, 'missing', 'user', 'hi')).toEqual({ ok: false, error: 'not_found' });
    expect(state.messages).toEqual([]);
  });

  it('titles the session after its first user message only', async () => {
    const s = await createSession(d, A, {});
    await addMessage(d, A, s.id, 'assistant', 'hello');
    expect(state.sessions[0].title).toBe('New chat');
    const first = await addMessage(d, A, s.id, 'user', 'z'.repeat(70), { a: 1 });
    expect(first).toMatchObject({ ok: true, value: { role: 'user', metadata: { a: 1 } } });
    expect(state.sessions[0].title).toBe('z'.repeat(57) + '...');
    await addMessage(d, A, s.id, 'user', 'second question');
    expect(state.sessions[0].title).toBe('z'.repeat(57) + '...');
    expect((await getSession(d, A, s.id))!.messages).toHaveLength(3);
  });
});
