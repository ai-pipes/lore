import type { Document, DocumentInput, LibraryWithStats } from '../../catalog/index.js';
import type { LanguageModel } from '../../llm/index.js';
import type { SearchDeps } from '../../search/index.js';
import type { Ref } from '../domain/insight.js';
import type { ChatMessage, ChatSession, ChatSessionListItem, NewSession, SessionPatch } from '../domain/session.js';

/**
 * Chat sessions and messages, always scoped to an owner: a session of another owner behaves
 * exactly like a missing one (null / false), and nothing of it is read or changed.
 */
export interface ChatRepository {
  create(ownerId: string, o: NewSession): Promise<ChatSession>;
  list(ownerId: string, limit: number): Promise<ChatSessionListItem[]>;
  get(ownerId: string, id: string): Promise<ChatSession | null>;
  update(ownerId: string, id: string, data: SessionPatch): Promise<ChatSession | null>;
  delete(ownerId: string, id: string): Promise<boolean>;
  /** The new message, or null when the owner has no such session. */
  addMessage(ownerId: string, sessionId: string, role: string, content: string, metadata?: unknown): Promise<ChatMessage | null>;
  /** The session's messages, or null when the owner has no such session. */
  messages(ownerId: string, sessionId: string): Promise<ChatMessage[] | null>;
  setTitle(ownerId: string, id: string, title: string): Promise<void>;
}

/** Where insights are published: the insights library over the catalog. */
export interface InsightStore {
  /** The insights library (in the system namespace `insights`) and its long-lived version, created on first use. */
  ensureInsightsVersion(): Promise<{ library_id: string; version_id: string }>;
  /** The `library/slug` keys of `refs` that exist in their library's current version (one lookup). */
  existing(refs: Ref[]): Promise<Set<string>>;
  exists(libraryId: string, versionId: string, slug: string): Promise<boolean>;
  /** Inserts the insight; with `'error'` an existing one is left alone and the result is `'exists'`. */
  insert(input: DocumentInput, onConflict: 'update' | 'error'): Promise<{ id: string } | 'exists'>;
}

/** What the chat reads from the catalog. */
export interface ChatDocs {
  bySlug(libraryId: string, slug: string, o?: { branch?: string }): Promise<Document | null>;
  listLibraries(): Promise<LibraryWithStats[]>;
  libraryExists(id: string): Promise<boolean>;
}

export interface ChatDeps {
  chats: ChatRepository;
  insights: InsightStore;
  search: SearchDeps;
  docs: ChatDocs;
  /** The answering LLM: chat streams, insight summaries. */
  model: LanguageModel;
}
