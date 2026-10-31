import { z } from 'zod';
import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { uniquePinned, type PinnedDoc } from './answer.js';

// The chat UI (interfaces/web/chat-assets.ts) is built from these same constants: it sends only
// the most recent messages that fit and pins at most MAX_PINNED_DOCS documents.

/** Most messages one `/api/chat` request may carry (the conversation so far). */
export const MAX_CHAT_MESSAGES = 100;
/** Most characters of all messages of one request together. */
export const MAX_CHAT_CHARS = 200_000;
/** Most distinct pinned documents put into the model's context. */
export const MAX_PINNED_DOCS = 20;
/** Most libraries a chat may be scoped to. */
export const MAX_SCOPE_LIBRARIES = 50;
/** Most entries of the raw `pinned_docs` array, before de-duplication. */
const MAX_PINNED_ENTRIES = 100;

const id = z.string().min(1).max(200);

const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .min(1)
    .max(MAX_CHAT_MESSAGES),
  /** The older single-library scope; still accepted and merged into `library_ids`. */
  library_id: id.optional(),
  library_ids: z.array(id).max(MAX_SCOPE_LIBRARIES).optional(),
  branch: id.optional(),
  pinned_docs: z.array(z.object({ library_id: id, slug: z.string().min(1).max(500) })).max(MAX_PINNED_ENTRIES).optional(),
  mode: z.enum(['qa', 'brainstorm']).optional(),
});

/** A validated `/api/chat` request body. */
export interface ChatRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** The libraries the answer searches; absent: all libraries. */
  library_ids?: string[];
  branch?: string;
  pinned_docs?: PinnedDoc[];
  mode?: 'qa' | 'brainstorm';
}

/**
 * The `/api/chat` body, validated and bounded: only user and assistant messages with string
 * content, at most MAX_CHAT_MESSAGES of them and MAX_CHAT_CHARS characters in total, and at most
 * MAX_PINNED_DOCS distinct pinned documents (duplicates are dropped). The scope is `library_ids`
 * plus the older single `library_id`. Unknown fields are dropped.
 */
export function parseChatRequest(body: unknown): Result<ChatRequest, string> {
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : `body: ${issue.message}`);
  }
  const { library_id, library_ids, ...rest } = parsed.data;
  const req: ChatRequest = rest;
  const scope = [...new Set([...(library_id ? [library_id] : []), ...(library_ids ?? [])])];
  if (scope.length > MAX_SCOPE_LIBRARIES) return err(`library_ids may name at most ${MAX_SCOPE_LIBRARIES} libraries`);
  if (scope.length > 0) req.library_ids = scope;

  const chars = req.messages.reduce((n, m) => n + m.content.length, 0);
  if (chars > MAX_CHAT_CHARS) return err(`messages may hold at most ${MAX_CHAT_CHARS} characters in total`);

  if (req.pinned_docs) {
    req.pinned_docs = uniquePinned(req.pinned_docs);
    if (req.pinned_docs.length > MAX_PINNED_DOCS) return err(`pinned_docs may name at most ${MAX_PINNED_DOCS} documents`);
  }
  return ok(req);
}
