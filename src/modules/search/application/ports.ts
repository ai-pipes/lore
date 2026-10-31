import type { Document, LibraryScope, LinkedDoc, SearchOptions, SearchResult, VectorSearchResult, VersionFilter } from '../../catalog/index.js';

export type SearchHit = SearchResult;
export type VectorHit = VectorSearchResult;
export type LinkedHit = LinkedDoc;

/** Scope and size of a vector search. The index applies the configured minimum similarity. */
export type VectorQuery = VersionFilter & { library_id?: string; limit?: number };

/** What the search pipeline reads from the catalog. */
export interface DocumentIndex {
  fullText(q: string, o: Omit<SearchOptions, 'query'>): Promise<SearchHit[]>;
  vector(embedding: number[], o: VectorQuery): Promise<VectorHit[]>;
  /** The query embedding, or null when no embedding provider is configured. Errors propagate. */
  embed(q: string): Promise<number[] | null>;
  bySlug(libraryId: string, slug: string, o?: VersionFilter): Promise<Document | null>;
  /** Documents linked from the hits; each library is read in its scope, else its current version. */
  linksFrom(hits: SearchHit[], max: number | undefined, scopes?: LibraryScope[]): Promise<LinkedHit[]>;
}

/** Turns a question (any language) into English search terms; returns the query when it cannot. */
export interface TermExtractor {
  extract(q: string): Promise<string>;
}

export interface SearchDeps {
  index: DocumentIndex;
  terms: TermExtractor;
  /** Default relative drop factor (0.0–1.0, `LORE_SEARCH_DROP_FACTOR`); 0.80 when unset. */
  dropFactor?: number;
}
