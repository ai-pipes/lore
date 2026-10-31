import type {
  CategoryStat,
  DomainStat,
  LinkedDoc,
  LinksFromOptions,
  MetadataMatch,
  SearchOptions,
  SearchResult,
  ServiceInfo,
  VectorSearchResult,
  VersionFilter,
} from '../domain/document.js';
import type { CatalogDeps } from './ports.js';

/** Full-text search (Postgres FTS, `websearch_to_tsquery`). */
export function searchFullText(d: CatalogDeps, opts: SearchOptions): Promise<SearchResult[]> {
  return d.search.fullText(opts);
}

/** Nearest-neighbour search over document embeddings, with the same version semantics as FTS. */
export function searchVectors(
  d: CatalogDeps,
  embedding: number[],
  filters: { library_id?: string } & VersionFilter,
  limit: number,
  minScore = 0,
): Promise<VectorSearchResult[]> {
  return d.search.vector(embedding, filters, limit, minScore);
}

/** The query embedding, or null when no embedding provider is configured. Errors propagate. */
export async function embedQuery(d: CatalogDeps, text: string): Promise<number[] | null> {
  if (!d.embedder.available()) return null;
  return d.embedder.embed(text);
}

export function findByAnyMetadataKey(
  d: CatalogDeps,
  keys: Record<string, string>,
  libraryId?: string,
  filter: VersionFilter = {},
): Promise<MetadataMatch[]> {
  return d.search.byMetadata(keys, libraryId, filter);
}

export function getLibraryOverview(d: CatalogDeps, libraryId: string, filter: VersionFilter = {}): Promise<DomainStat[]> {
  return d.search.overview(libraryId, filter);
}

export function getCategoryStats(d: CatalogDeps, libraryId: string, filter: VersionFilter = {}): Promise<CategoryStat[]> {
  return d.search.categories(libraryId, filter);
}

/** The services (document domains) of one library or of all, with document counts. */
export function listServices(d: CatalogDeps, libraryId?: string, filter: VersionFilter = {}): Promise<ServiceInfo[]> {
  return d.search.services(libraryId, filter);
}

/** Documents linked from the given results (1 hop, in each library's scope, else its current version), not already among them. */
export function linksFrom(d: CatalogDeps, results: SearchResult[], opts: LinksFromOptions = {}): Promise<LinkedDoc[]> {
  return d.search.linksFrom(results, opts);
}
