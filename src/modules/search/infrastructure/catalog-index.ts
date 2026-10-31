import {
  embedQuery,
  getDocumentBySlug,
  linksFrom,
  searchFullText,
  searchVectors,
  type CatalogDeps,
} from '../../catalog/index.js';
import type { DocumentIndex } from '../application/ports.js';

/**
 * The search pipeline's view of the catalog. The minimum vector similarity is
 * LORE_VECTOR_MIN_SCORE when set, else the embedding provider's default, else 0.
 */
export function catalogDocumentIndex(catalog: CatalogDeps): DocumentIndex {
  return {
    fullText: (query, o) => searchFullText(catalog, { ...o, query }),
    vector: (embedding, o) => {
      const { limit = 20, ...filters } = o;
      const envMin = parseFloat(process.env.LORE_VECTOR_MIN_SCORE ?? '');
      const minScore = Number.isFinite(envMin) ? envMin : (catalog.embedder.minScore() ?? 0);
      return searchVectors(catalog, embedding, filters, limit, minScore);
    },
    embed: (q) => embedQuery(catalog, q),
    bySlug: (libraryId, slug, o = {}) => getDocumentBySlug(catalog, libraryId, slug, o),
    linksFrom: (hits, max, scopes) =>
      linksFrom(catalog, hits, { ...(max === undefined ? {} : { maxLinked: max }), ...(scopes === undefined ? {} : { scopes }) }),
  };
}
