import type { Document, VersionFilter } from '../../catalog/index.js';
import { anyTermQuery, slugCandidates, termsAreTranslated } from '../domain/query.js';
import type { LinkedHit, SearchDeps, SearchHit, VectorHit } from './ports.js';
import { rrfFusion } from './ranking.js';

export interface ServiceSpec {
  library_id: string;
  /** Specific version to search. If omitted, falls back to the current version of `branch`. */
  version_id?: string;
  /** Branch to search. If omitted together with version_id, searches the current (is_current=true) version. */
  branch?: string;
}

export interface SearchPipelineOptions {
  /** List of services with optional version/branch pinning. Empty or omitted → cross-library search. */
  services?: ServiceSpec[];
  /** Override the relative drop factor for this call (0.0–1.0). Defaults to the deps' `dropFactor`, else 0.80. */
  dropFactor?: number;
  /** Pre-extracted search terms (skip LLM call if provided). */
  _preExtractedTerms?: string;
  /** Search mode. Defaults to 'hybrid' if an embedding provider is configured, 'fts' otherwise. Hybrid without a query embedding runs as 'fts'. */
  searchMode?: 'fts' | 'hybrid' | 'vector';
}

// Results with score < topScore × dropFactor are considered noise and filtered out.
const DEFAULT_DROP_FACTOR = 0.8;

/** The document a dotted slug in the question names directly (`orders.create-order`), if any. */
export async function lookupBySlug(
  d: SearchDeps,
  question: string,
  opts: { library_id?: string } & VersionFilter = {},
): Promise<Document | null> {
  const { library_id, ...versionFilter } = opts;
  const candidates = slugCandidates(question);
  if (!candidates) return null;
  const targetLibId = library_id ?? candidates.library_id;
  for (const slug of candidates.slugs) {
    const doc = await d.index.bySlug(targetLibId, slug, versionFilter);
    if (doc) return doc;
  }
  return null;
}

/**
 * Key technical terms of the query, translated to English (a cheap LLM call).
 * The extractor falls back to the original query on an empty response, an LLM error or timeout (5 s,
 * one attempt), or when no LLM is configured.
 */
export function extractSearchTerms(d: SearchDeps, query: string): Promise<string> {
  return d.terms.extract(query);
}

/**
 * Documents linked FROM the given results via document_links, not already among them.
 * Pass the services of the search so links are followed in the same version or branch;
 * other libraries are read in their current version. Only follows 1 hop, 0 LLM calls.
 */
export function expandLinks(
  d: SearchDeps,
  results: SearchHit[],
  opts: { maxLinked?: number; services?: ServiceSpec[] } = {},
): Promise<LinkedHit[]> {
  const scopes = opts.services?.map((svc) => ({ library_id: svc.library_id, ...serviceVersionFilter(svc) }));
  return d.index.linksFrom(results, opts.maxLinked, scopes);
}

function serviceVersionFilter(svc: ServiceSpec): VersionFilter {
  if (svc.version_id) return { version_id: svc.version_id };
  if (svc.branch) return { branch: svc.branch };
  return {};
}

/**
 * Search pipeline:
 * 1. LLM extracts English keywords from the query (any language in → English terms out)
 * 2. FTS (all terms, else any of them) and/or vector search (embedding of the terms) depending on mode
 * 3. RRF fusion when both result sets are available
 * 4. Results sorted by score descending, low-score noise filtered out
 */
export async function searchDocuments(d: SearchDeps, query: string, opts: SearchPipelineOptions = {}): Promise<SearchHit[]> {
  const { services, dropFactor = d.dropFactor ?? DEFAULT_DROP_FACTOR, _preExtractedTerms, searchMode } = opts;

  let searchTerms: string;
  if (_preExtractedTerms) {
    searchTerms = _preExtractedTerms;
  } else {
    try {
      searchTerms = await extractSearchTerms(d, query);
    } catch {
      searchTerms = query;
    }
  }

  // FTS first requires all terms; when that finds nothing (one extracted term the documents do
  // not use, e.g. "cost" for pages that say "fee"), it retries with any of the terms.
  const anyTerms = anyTermQuery(searchTerms);

  // Query embedding for hybrid/vector modes: of the question, which carries the intent, unless the
  // extracted terms translate it — then the question is not in English like the documents, and an
  // English-centric embedding model maps it far from the page that answers it, so the terms are
  // embedded. null means no embedding provider is configured; then, as after a failed embedding,
  // hybrid falls back to FTS only (drop factor included).
  const embedText = termsAreTranslated(query, searchTerms) ? searchTerms : query;
  let queryEmbedding: number[] | null = null;
  if (searchMode !== 'fts') {
    try {
      queryEmbedding = await d.index.embed(embedText);
    } catch {
      queryEmbedding = null;
    }
  }
  const effectiveMode = searchMode === 'vector' ? 'vector' : queryEmbedding ? (searchMode ?? 'hybrid') : 'fts';

  const ftsOnce = async (q: string): Promise<SearchHit[]> => {
    if (services && services.length > 0) {
      const perService = await Promise.all(
        services.map((svc) => d.index.fullText(q, { library_id: svc.library_id, ...serviceVersionFilter(svc), limit: 20 })),
      );
      return perService.flat().sort((a, b) => b.score - a.score);
    }
    return d.index.fullText(q, { limit: 50 });
  };
  const runFts = async (): Promise<SearchHit[]> => {
    const all = await ftsOnce(searchTerms);
    return all.length > 0 || !anyTerms || anyTerms === searchTerms ? all : ftsOnce(anyTerms);
  };

  const runVector = async (emb: number[]): Promise<VectorHit[]> => {
    if (services && services.length > 0) {
      const perService = await Promise.all(
        services.map((svc) => d.index.vector(emb, { library_id: svc.library_id, ...serviceVersionFilter(svc), limit: 20 })),
      );
      return perService.flat().sort((a, b) => b.score - a.score);
    }
    return d.index.vector(emb, { limit: 50 });
  };

  const [ftsResults, vectorResults] = await Promise.all([
    effectiveMode !== 'vector' ? runFts() : Promise.resolve([] as SearchHit[]),
    effectiveMode !== 'fts' && queryEmbedding ? runVector(queryEmbedding) : Promise.resolve([] as VectorHit[]),
  ]);

  // RRF fusion (when both results available) or single-mode pass-through
  let raw: SearchHit[];
  if (ftsResults.length > 0 && vectorResults.length > 0) {
    raw = rrfFusion(ftsResults, vectorResults);
  } else if (vectorResults.length > 0) {
    raw = vectorResults.map((r) => ({
      slug: r.slug,
      library_id: r.library_id,
      domain: r.domain,
      entry_type: r.entry_type,
      http_method: r.http_method,
      route: r.route,
      summary: r.summary,
      score: r.score,
    }));
  } else {
    raw = ftsResults;
  }

  if (raw.length === 0) return raw;
  // Apply drop factor only for FTS/vector-only (RRF scores have different distribution)
  if (effectiveMode !== 'hybrid') {
    const threshold = raw[0].score * dropFactor;
    return raw.filter((r) => r.score >= threshold);
  }
  return raw;
}
