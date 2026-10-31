import type { CatalogDeps } from '../../catalog/index.js';
import type { LanguageModel } from '../../llm/index.js';
import type { SearchDeps } from '../../search/index.js';
import type { ChatDeps } from '../application/ports.js';
import { catalogChatDocs } from './catalog-docs.js';
import { catalogInsightStore } from './catalog-insight-store.js';
import { pgChatRepository } from './pg-chat.js';

/** The chat module over Postgres, the catalog, the search module and the configured LLM. */
export function createPgChat(catalog: CatalogDeps, search: SearchDeps, model: LanguageModel): ChatDeps {
  return {
    chats: pgChatRepository,
    insights: catalogInsightStore(catalog),
    search,
    docs: catalogChatDocs(catalog),
    model,
  };
}
