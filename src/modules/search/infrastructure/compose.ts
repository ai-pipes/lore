import type { LanguageModel } from '../../llm/index.js';
import type { CatalogDeps } from '../../catalog/index.js';
import type { SearchDeps } from '../application/ports.js';
import { catalogDocumentIndex } from './catalog-index.js';
import { createLlmTermExtractor } from './llm-term-extractor.js';

/** The search module over the catalog index and the LLM term extractor; `LORE_SEARCH_DROP_FACTOR` sets the drop factor. */
export function createSearch(catalog: CatalogDeps, model: LanguageModel, env: Record<string, string | undefined> = process.env): SearchDeps {
  const dropFactor = parseFloat(env.LORE_SEARCH_DROP_FACTOR ?? '');
  return {
    index: catalogDocumentIndex(catalog),
    terms: createLlmTermExtractor(model),
    ...(Number.isFinite(dropFactor) ? { dropFactor } : {}),
  };
}
