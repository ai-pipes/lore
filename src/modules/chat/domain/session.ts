/** Chat sessions: their shape and the validation of session input. Pure, no dependencies. */

/** The signed-in user a chat belongs to; every session operation is scoped to them. */
export interface ChatOwner {
  userId: string;
  displayName: string;
  /** Admins may choose an insight's slug and overwrite an existing insight. */
  isAdmin: boolean;
}

export interface ChatSession {
  id: string;
  /** The owner's user id. */
  user_id: string;
  title: string;
  pinned_docs: unknown[];
  scope_filters: unknown[];
  is_published: boolean;
  published_doc_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionListItem {
  id: string;
  title: string;
  is_published: boolean;
  updated_at: string;
  message_count: number;
}

export interface ChatMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  metadata: unknown | null;
  created_at: string;
}

export interface NewSession {
  title?: string;
  pinned_docs?: unknown[];
  scope_filters?: unknown[];
}

export interface SessionPatch {
  title?: string;
  pinned_docs?: unknown[];
  scope_filters?: unknown[];
  is_published?: boolean;
  published_doc_id?: string | null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PUBLISH_SLUG_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
export const MESSAGE_ROLES = new Set(['user', 'assistant', 'search']);

/** The error of a create/update session body, or null when it is valid. */
export function validateSessionBody(body: { title?: unknown; pinned_docs?: unknown; scope_filters?: unknown }): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'body must be a JSON object';
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 200)) return 'title must be a string (max 200 chars)';
  if (body.pinned_docs !== undefined && !Array.isArray(body.pinned_docs)) return 'pinned_docs must be an array';
  if (body.scope_filters !== undefined && !Array.isArray(body.scope_filters)) return 'scope_filters must be an array';
  return null;
}

/** A session title from its first user message: up to 60 characters, else 57 + "...". */
export function autoTitleOf(text: string): string {
  return text.length > 60 ? text.slice(0, 57) + '...' : text;
}
