import type {
  DocHashEntry,
  Document,
  DocumentInput,
  ListDocumentsOptions,
  VersionFilter,
} from '../domain/document.js';
import { extractMetadata } from '../domain/metadata.js';
import { enrichmentSchedulerFor, type EnrichmentScheduler } from './enrichment.js';
import type { CatalogDeps } from './ports.js';

/** A pushed document before metadata extraction. */
export type DocumentUpload = Omit<DocumentInput, 'metadata'>;

/** Stores one pushed document, with metadata extracted from its content. */
export function ingestDocument(d: CatalogDeps, input: DocumentUpload): Promise<Document> {
  return d.documents.insert({ ...input, metadata: extractMetadata(input.content) });
}

/**
 * Stores many pushed documents of one version in one batch, with metadata extracted from each.
 * With `enrich` (and a configured link suggester), every stored document is then queued for
 * enrichment with LLM-suggested links to the slugs of the version, read once the push's batches
 * stop arriving (see EnrichmentScheduler). That runs in the background, a few at a time:
 * `enrichment` settles when it is done and never rejects.
 */
export async function ingestBulk(
  d: CatalogDeps,
  libraryId: string,
  versionId: string,
  items: Omit<DocumentUpload, 'library_id' | 'version_id'>[],
  opts: { enrich: boolean; scheduler?: EnrichmentScheduler },
): Promise<{ documents: Document[]; enrichment: Promise<void> }> {
  const documents = await d.documents.insertBatch(
    items.map((item) => ({
      ...item,
      library_id: libraryId,
      version_id: versionId,
      metadata: extractMetadata(item.content),
    })),
  );
  if (!opts.enrich || !d.links.enabled() || documents.length === 0) {
    return { documents, enrichment: Promise.resolve() };
  }
  const scheduler = opts.scheduler ?? enrichmentSchedulerFor(d);
  return { documents, enrichment: scheduler.schedule(libraryId, versionId, documents) };
}

/**
 * Inserts a document as given. By default an existing document with the same
 * (library, version, slug) is updated; with `onConflict: 'error'` it fails with DocumentExistsError.
 */
export function insertDocument(
  d: CatalogDeps,
  input: DocumentInput,
  opts?: { onConflict?: 'update' | 'error' },
): Promise<Document> {
  return d.documents.insert(input, opts);
}

export function deleteDocument(d: CatalogDeps, libraryId: string, versionId: string, slug: string): Promise<boolean> {
  return d.documents.delete(libraryId, versionId, slug);
}

/** The most documents one page of `listDocuments` returns, whatever limit is asked for. */
export const MAX_LIST_LIMIT = 500;

/** One page of documents; a limit above MAX_LIST_LIMIT is clamped to it. */
export function listDocuments(d: CatalogDeps, opts: ListDocumentsOptions): Promise<Document[]> {
  const limit = opts.limit === undefined ? undefined : Math.min(opts.limit, MAX_LIST_LIMIT);
  return d.documents.list({ ...opts, limit });
}

/** Every (slug, content hash) of exactly one version, unpaginated: what an incremental push diffs against. */
export function versionDocumentHashes(d: CatalogDeps, libraryId: string, versionId: string): Promise<DocHashEntry[]> {
  return d.documents.hashes(libraryId, versionId);
}

export async function getDocumentBySlug(
  d: CatalogDeps,
  libraryId: string,
  slug: string,
  opts: VersionFilter = {},
): Promise<Document | null> {
  return (await d.documents.bySlug(libraryId, slug, opts)) ?? null;
}

export function getDocumentsByIds(d: CatalogDeps, ids: string[]): Promise<Document[]> {
  return d.documents.byIds(ids);
}

/** The `library/slug` keys of `refs` that exist in their library's current version. */
export async function existingCurrentDocuments(
  d: CatalogDeps,
  refs: { library: string; slug: string }[],
): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  return d.documents.existingCurrent(refs);
}

/** Copies the documents and images of `sourceVersionId` that `versionId` does not have yet. */
export async function cloneVersion(
  d: CatalogDeps,
  libraryId: string,
  versionId: string,
  sourceVersionId: string,
): Promise<{ cloned: number } | 'library_not_found'> {
  if (!(await d.libraries.get(libraryId))) return 'library_not_found';
  const cloned = await d.documents.cloneVersion(libraryId, sourceVersionId, versionId);
  await d.images.cloneVersion(libraryId, sourceVersionId, versionId);
  return { cloned };
}
