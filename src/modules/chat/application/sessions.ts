import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { autoTitleOf, type ChatMessage, type ChatSession, type ChatSessionListItem, type NewSession, type SessionPatch } from '../domain/session.js';
import type { ChatDeps } from './ports.js';

/*
 * Every use case takes the owner's user id: a session of another user is reported exactly like a
 * missing one, so its id reveals nothing.
 */

export function createSession(d: ChatDeps, ownerId: string, o: NewSession): Promise<ChatSession> {
  return d.chats.create(ownerId, o);
}

export function listSessions(d: ChatDeps, ownerId: string, limit = 50): Promise<ChatSessionListItem[]> {
  return d.chats.list(ownerId, limit);
}

/** The owner's session with its messages, or null. */
export async function getSession(d: ChatDeps, ownerId: string, id: string): Promise<(ChatSession & { messages: ChatMessage[] }) | null> {
  const session = await d.chats.get(ownerId, id);
  if (!session) return null;
  const messages = await d.chats.messages(ownerId, id);
  if (!messages) return null;
  return { ...session, messages };
}

export function updateSession(d: ChatDeps, ownerId: string, id: string, patch: SessionPatch): Promise<ChatSession | null> {
  return d.chats.update(ownerId, id, patch);
}

export function deleteSession(d: ChatDeps, ownerId: string, id: string): Promise<boolean> {
  return d.chats.delete(ownerId, id);
}

/** Appends a message to the owner's session; the first user message also becomes its title. */
export async function addMessage(
  d: ChatDeps,
  ownerId: string,
  sessionId: string,
  role: string,
  content: string,
  metadata?: unknown,
): Promise<Result<ChatMessage, 'not_found'>> {
  const msg = await d.chats.addMessage(ownerId, sessionId, role, content, metadata);
  if (!msg) return err('not_found');
  if (role === 'user') {
    const userMessages = ((await d.chats.messages(ownerId, sessionId)) ?? []).filter((m) => m.role === 'user');
    if (userMessages.length === 1) await d.chats.setTitle(ownerId, sessionId, autoTitleOf(content));
  }
  return ok(msg);
}
