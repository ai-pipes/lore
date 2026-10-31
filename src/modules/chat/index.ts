/**
 * Public API of the chat module: chat sessions and messages, answer streaming, insight publishing
 * and the chat UI. Drizzle tables are never exported from here; platform/db.ts imports
 * infrastructure/schema.ts.
 */
export {
  MESSAGE_ROLES,
  PUBLISH_SLUG_RE,
  UUID_RE,
  autoTitleOf,
  validateSessionBody,
  type ChatMessage,
  type ChatOwner,
  type ChatSession,
  type ChatSessionListItem,
  type NewSession,
  type SessionPatch,
} from './domain/session.js';
export { MAX_INSIGHT_LINKS, REF_RE, collectRefs, type Ref } from './domain/insight.js';
export type { ChatDeps, ChatDocs, ChatRepository, InsightStore } from './application/ports.js';
export { addMessage, createSession, deleteSession, getSession, listSessions, updateSession } from './application/sessions.js';
export { citedDocumentLinks, publishSession, type PublishError, type PublishResult } from './application/insights.js';
export { NO_LLM_MESSAGE, streamChat, type ChatEvent, type PinnedDoc, type StreamChatOptions } from './application/answer.js';
export { MAX_CHAT_CHARS, MAX_CHAT_MESSAGES, MAX_PINNED_DOCS, parseChatRequest, type ChatRequest } from './application/chat-request.js';
export { createPgChat } from './infrastructure/compose.js';
export { INSIGHTS_VERSION, insightsLibraryId } from './infrastructure/catalog-insight-store.js';
export { chatRoutes, type ChatRouteOptions } from './interfaces/http/routes.js';
export { getChatHTML } from './interfaces/web/chat-html.js';
export { CHAT_CSS, CHAT_JS } from './interfaces/web/chat-assets.js';
export { CHAT_MARKDOWN_JS } from './interfaces/web/chat-markdown.js';
