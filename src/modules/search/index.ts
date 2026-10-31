/**
 * Public API of the search module: query understanding, rank fusion, slug lookup and link
 * expansion over the catalog index. The module owns no tables.
 */
export { SLUG_PATTERN, parseDotSlug } from './domain/query.js';
export { groupByDomain, type DomainGroup } from './domain/grouping.js';
export type { DocumentIndex, TermExtractor, SearchDeps, SearchHit, VectorHit, LinkedHit, VectorQuery } from './application/ports.js';
export {
  searchDocuments,
  lookupBySlug,
  extractSearchTerms,
  expandLinks,
  type ServiceSpec,
  type SearchPipelineOptions,
} from './application/pipeline.js';
export { createSearch } from './infrastructure/compose.js';
