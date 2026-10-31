import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type {
  CategoryStat,
  DomainStat,
  LibraryScope,
  LinkedDoc,
  LinksFromOptions,
  MetadataMatch,
  SearchOptions,
  SearchResult,
  ServiceInfo,
  VectorSearchResult,
  VersionFilter,
} from '../domain/document.js';
import type { DocumentSearch } from '../application/ports.js';
import { getEmbeddingProvider } from './embeddings/EmbeddingProvider.js';
import { documents, document_links, document_metadata, document_vectors, libraries, versions } from './schema.js';
import { versionCondition } from './version-filter.js';
import { findRelatedDocs, inferRelatedDocs } from './pg-relationships.js';

export type { CategoryStat, DomainStat, LinkedDoc, SearchOptions, SearchResult, ServiceInfo, VectorSearchResult };

export async function searchDocs(opts: SearchOptions): Promise<SearchResult[]> {
  const db = getDb();
  const verCond = versionCondition(opts);
  const conditions = [
    verCond,
    sql`"documents"."search_vector" @@ websearch_to_tsquery('english', ${opts.query})`,
  ];

  if (opts.library_id) conditions.push(eq(documents.library_id, opts.library_id));
  if (opts.domain) conditions.push(eq(documents.domain, opts.domain));
  if (opts.entry_type) conditions.push(eq(documents.entry_type, opts.entry_type));
  if (opts.category) conditions.push(eq(documents.category, opts.category));
  if (opts.minScore) {
    conditions.push(
      sql`ts_rank("documents"."search_vector", websearch_to_tsquery('english', ${opts.query})) >= ${opts.minScore}`,
    );
  }

  const rows = await db
    .select({
      slug: documents.slug,
      library_id: documents.library_id,
      domain: documents.domain,
      entry_type: documents.entry_type,
      http_method: documents.http_method,
      route: documents.route,
      summary: documents.summary,
      score: sql<number>`ts_rank("documents"."search_vector", websearch_to_tsquery('english', ${opts.query}))`,
    })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(and(...conditions))
    .orderBy(sql`ts_rank("documents"."search_vector", websearch_to_tsquery('english', ${opts.query})) DESC`)
    .limit(opts.limit ?? 20);

  return rows;
}

/** The most documents a find_by_* lookup returns. */
export const FIND_BY_METADATA_LIMIT = 100;

export async function findByAnyMetadataKey(
  keys: Record<string, string>,
  library_id?: string,
  filter: VersionFilter = {},
): Promise<MetadataMatch[]> {
  const db = getDb();
  const entries = Object.entries(keys);
  if (entries.length === 0) return [];

  const verCond = versionCondition(filter);
  const metaConditions = entries.map(
    ([k, v]) => sql`(${document_metadata.key} = ${k} AND ${document_metadata.value} = ${v})`,
  );

  // Each document once (matched through a subquery, not a join over its metadata rows), as a
  // summary without the content, and a bounded number of them.
  const matching = db
    .select({ id: document_metadata.document_id })
    .from(document_metadata)
    .where(sql`(${sql.join(metaConditions, sql` OR `)})`);
  const conditions = [verCond, inArray(documents.id, matching)];
  if (library_id) conditions.push(eq(documents.library_id, library_id));

  return db
    .select({
      id: documents.id,
      slug: documents.slug,
      library_id: documents.library_id,
      domain: documents.domain,
      entry_type: documents.entry_type,
      summary: documents.summary,
    })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(and(...conditions))
    .orderBy(documents.library_id, documents.slug)
    .limit(FIND_BY_METADATA_LIMIT);
}

export async function getLibraryOverview(library_id: string, filter: VersionFilter = {}): Promise<DomainStat[]> {
  const verCond = versionCondition(filter);
  return getDb()
    .select({
      domain: documents.domain,
      entry_type: documents.entry_type,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(and(eq(documents.library_id, library_id), verCond))
    .groupBy(documents.domain, documents.entry_type)
    .orderBy(documents.domain, documents.entry_type);
}

/**
 * The services of the chat scope selector: one entry per library with documents in the
 * requested version (current by default), with its document count. The selector sends the
 * ids as `library_ids`, so they must be library ids, not document domains.
 */
export async function listServices(library_id?: string, filter: VersionFilter = {}): Promise<ServiceInfo[]> {
  const db = getDb();
  const conditions = [versionCondition(filter)];
  if (library_id) conditions.push(eq(documents.library_id, library_id));

  const count = sql<number>`cast(count(*) as int)`;
  return db
    .select({ id: libraries.id, display_name: libraries.display_name, doc_count: count })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .innerJoin(libraries, eq(libraries.id, documents.library_id))
    .where(and(...conditions))
    .groupBy(libraries.id, libraries.display_name)
    .orderBy(sql`count(*) DESC`, libraries.id);
}

export async function getCategoryStats(library_id: string, filter: VersionFilter = {}): Promise<CategoryStat[]> {
  const verCond = versionCondition(filter);
  return getDb()
    .select({
      category: documents.category,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(and(eq(documents.library_id, library_id), verCond))
    .groupBy(documents.category)
    .orderBy(documents.category);
}

/**
 * Nearest-neighbour search over document embeddings.
 * Version semantics match full-text search: an explicit version_id wins, then
 * branch, otherwise only the current (promoted) version of each library.
 */
export async function vectorSearch(
  embedding: number[],
  filters: { library_id?: string } & VersionFilter,
  limit: number,
  minScore = 0,
): Promise<VectorSearchResult[]> {
  if (embedding.length === 0) return [];
  // Only vectors of the current model are comparable: other models (and rows from before the
  // model column) may have a different dimension or a different space altogether.
  const provider = getEmbeddingProvider();
  if (!provider) return [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('vectorSearch: limit must be an integer between 1 and 1000');
  if (!embedding.every(n => typeof n === 'number' && isFinite(n))) throw new Error('vectorSearch: embedding contains invalid values');

  const embeddingParam = sql`${`[${embedding.join(',')}]`}::vector`;
  // The distance is computed only for vectors of the current model: other models may have another
  // dimension, and `<=>` would raise on them. A CASE guarantees it, whatever order Postgres picks
  // for the WHERE terms (it also covers the score and the ORDER BY).
  const distance = sql`(CASE WHEN ${document_vectors.model} = ${provider.id} THEN ${document_vectors.embedding} <=> ${embeddingParam} END)`;

  const conditions: SQL[] = [
    sql`${document_vectors.embedding} IS NOT NULL`,
    eq(document_vectors.model, provider.id),
    versionCondition(filters),
  ];
  if (filters.library_id) conditions.push(eq(documents.library_id, filters.library_id));
  if (minScore > 0) conditions.push(sql`1 - ${distance} >= ${minScore}`);

  const rows = await getDb()
    .select({
      documentId: documents.id,
      slug: documents.slug,
      library_id: documents.library_id,
      domain: documents.domain,
      entry_type: documents.entry_type,
      http_method: documents.http_method,
      route: documents.route,
      summary: documents.summary,
      score: sql<number>`1 - ${distance}`,
    })
    .from(document_vectors)
    .innerJoin(documents, eq(documents.id, document_vectors.document_id))
    .innerJoin(versions, and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)))
    .where(and(...conditions))
    .orderBy(distance)
    .limit(limit);

  return rows.map(r => ({ ...r, score: Number(r.score) }));
}

/**
 * The documents with the given (library, slug) pairs, each library read in its
 * scope (the first one given for it), else in its current version.
 */
function inScope(pairs: { library_id: string; slug: string }[], scopes: LibraryScope[]): SQL {
  const filterOf = new Map<string, VersionFilter>();
  for (const s of scopes) if (!filterOf.has(s.library_id)) filterOf.set(s.library_id, s);
  const slugsOf = new Map<string, string[]>();
  for (const p of pairs) slugsOf.set(p.library_id, [...(slugsOf.get(p.library_id) ?? []), p.slug]);
  const perLibrary = [...slugsOf].map(([lib, slugs]) =>
    and(eq(documents.library_id, lib), inArray(documents.slug, slugs), versionCondition(filterOf.get(lib) ?? {}))!,
  );
  return sql`(${sql.join(perLibrary, sql` OR `)})`;
}

/**
 * Given a list of search results, finds documents linked FROM them via document_links.
 * Returns related docs that are NOT already in the original results (deduped).
 * Each library is read in its scope (the search's version or branch), else its current version.
 * Only follows 1 hop. Cost: 3 SQL queries, 0 LLM calls.
 */
export async function linksFrom(
  results: SearchResult[],
  opts: LinksFromOptions = {},
): Promise<LinkedDoc[]> {
  if (results.length === 0) return [];
  const { maxLinked = 10, scopes = [] } = opts;

  const db = getDb();

  // Step 1: find document IDs for our search results
  const docRows = await db
    .select({ id: documents.id, slug: documents.slug, library_id: documents.library_id })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(inScope(results, scopes));

  if (docRows.length === 0) return [];

  const docIds = docRows.map(d => d.id);
  const sourceById = new Map(docRows.map(d => [d.id, d]));

  // Step 2: fetch outgoing links from these documents
  const links = await db
    .select({
      from_document_id: document_links.from_document_id,
      to_slug: document_links.to_slug,
      to_library_id: document_links.to_library_id,
      link_type: document_links.link_type,
    })
    .from(document_links)
    .where(inArray(document_links.from_document_id, docIds));

  if (links.length === 0) return [];

  // Deduplicate: skip links pointing to docs already in search results
  const resultKey = new Set(results.map(r => `${r.library_id}::${r.slug}`));
  const uniqueTargets = new Map<string, { to_slug: string; to_library_id: string; link_type: string; from_slug: string }>();

  for (const link of links) {
    const source = sourceById.get(link.from_document_id);
    if (!source) continue;
    // A link without a target library points into the library of its source document.
    const targetLib = link.to_library_id ?? source.library_id;
    const key = `${targetLib}::${link.to_slug}`;
    if (resultKey.has(key)) continue;
    if (uniqueTargets.has(key)) continue;
    uniqueTargets.set(key, {
      to_slug: link.to_slug,
      to_library_id: targetLib,
      link_type: link.link_type,
      from_slug: source.slug,
    });
  }

  if (uniqueTargets.size === 0) return [];

  // Step 3: fetch summaries for linked documents
  const targets = [...uniqueTargets.values()].slice(0, maxLinked);
  const linkedDocs = await db
    .select({
      slug: documents.slug,
      library_id: documents.library_id,
      domain: documents.domain,
      entry_type: documents.entry_type,
      http_method: documents.http_method,
      route: documents.route,
      summary: documents.summary,
    })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(inScope(targets.map(t => ({ library_id: t.to_library_id, slug: t.to_slug })), scopes));

  // Merge with link metadata
  const targetMap = new Map(targets.map(t => [`${t.to_library_id}::${t.to_slug}`, t]));

  return linkedDocs.map(d => {
    const meta = targetMap.get(`${d.library_id}::${d.slug}`);
    return {
      ...d,
      link_type: meta?.link_type ?? 'references',
      from_slug: meta?.from_slug ?? '',
    };
  });
}

export const pgDocumentSearch: DocumentSearch = {
  fullText: searchDocs,
  vector: vectorSearch,
  byMetadata: findByAnyMetadataKey,
  overview: getLibraryOverview,
  categories: getCategoryStats,
  services: listServices,
  linksFrom,
  related: findRelatedDocs,
  inferRelated: inferRelatedDocs,
};
