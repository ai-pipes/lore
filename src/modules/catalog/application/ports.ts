import type { Clock } from '../../../shared-kernel/index.js';
import type { Library, LibraryWithStats } from '../domain/library.js';
import type { Namespace, ProjectKeyRecord } from '../domain/namespace.js';
import type { Version } from '../domain/version.js';
import type {
  CategoryStat,
  DocHashEntry,
  Document,
  DocumentInput,
  DomainStat,
  FindRelatedOptions,
  ImageRecord,
  InferredLinkResult,
  LinkedDoc,
  LinkResult,
  LinkSnapshot,
  ListDocumentsOptions,
  SearchOptions,
  SearchResult,
  ServiceInfo,
  VectorSearchResult,
  VersionFilter,
  LinksFromOptions,
  MetadataMatch,
} from '../domain/document.js';
import type { SuggestedLink } from '../domain/links.js';
import type { TopologyDoc, TopologyLink } from '../domain/topology.js';

export interface LibraryRepository {
  /** Creates the library in `namespaceId` (default `default`), or renames an existing one (its namespace is kept). */
  upsert(id: string, displayName: string, namespaceId?: string): Promise<Library>;
  /**
   * Atomically creates the library in `namespaceId`, or renames it when it already is there; null
   * (and nothing changed) when it exists in another namespace. `created` comes from the write itself.
   */
  upsertInNamespace(id: string, displayName: string, namespaceId: string): Promise<{ library: Library; created: boolean } | null>;
  get(id: string): Promise<Library | undefined>;
  /**
   * The id of an existing library that equals `id` ignoring letter case but is not `id` itself
   * (a legacy id from before validation), or undefined. Such ids share one image directory on
   * case-insensitive file systems.
   */
  caseVariantOf(id: string): Promise<string | undefined>;
  /** All libraries, or only those of `namespaceId`. */
  list(namespaceId?: string): Promise<LibraryWithStats[]>;
  /** Moves the library into `namespaceId`; false when the library does not exist. */
  setNamespace(id: string, namespaceId: string): Promise<boolean>;
}

export interface NamespaceRepository {
  /** Null when a namespace with this id exists. */
  insert(input: { id: string; displayName: string }): Promise<Namespace | null>;
  get(id: string): Promise<Namespace | undefined>;
  rename(id: string, displayName: string): Promise<Namespace | undefined>;
  list(): Promise<Namespace[]>;
}

export interface ProjectKeyRepository {
  insert(input: {
    namespaceId: string;
    libraryId: string | null;
    name: string;
    prefix: string;
    hash: string;
    createdBy: string | null;
  }): Promise<ProjectKeyRecord>;
  list(namespaceId?: string): Promise<ProjectKeyRecord[]>;
  findByHash(hash: string): Promise<ProjectKeyRecord | undefined>;
  /** Marks an active key revoked; false when there is no such active key. */
  revoke(id: string, at: Date): Promise<boolean>;
  touch(id: string, at: Date): Promise<void>;
}

/** Random secrets and their digests (Node's crypto behind the port). */
export interface KeySecrets {
  /** `prefix + base64url(32 random bytes)`. */
  random(prefix: string): string;
  sha256Hex(s: string): string;
}

export interface VersionRepository {
  create(id: string, libraryId: string, branch?: string): Promise<Version>;
  /** Makes `id` the library's only current version; false (nothing changed) if there is no such version. */
  promote(libraryId: string, id: string): Promise<boolean>;
  current(libraryId: string): Promise<Version | undefined>;
  list(libraryId: string): Promise<Version[]>;
  /**
   * Deletes a non-current version with its documents and image records; on success returns the
   * distinct hashes of the removed image records (their blobs may now be unreferenced).
   */
  delete(libraryId: string, id: string): Promise<{ imageHashes: string[] } | 'not_found' | 'is_current'>;
}

/** One document of an exact version and its outgoing links: what a diff compares. */
export interface VersionDocs {
  inVersion(libraryId: string, slug: string, versionId: string): Promise<Document | null>;
  linksOf(documentId: string): Promise<LinkSnapshot[]>;
}

export interface DocumentRepository extends VersionDocs {
  /** Inserts or updates one document (with its metadata, manual links and embedding). */
  insert(input: DocumentInput, opts?: { onConflict?: 'update' | 'error' }): Promise<Document>;
  /** Inserts or updates many documents in one transaction with one batch embedding call. */
  insertBatch(inputs: DocumentInput[]): Promise<Document[]>;
  delete(libraryId: string, versionId: string, slug: string): Promise<boolean>;
  list(opts: ListDocumentsOptions): Promise<Document[]>;
  bySlug(libraryId: string, slug: string, filter?: VersionFilter): Promise<Document | undefined>;
  byIds(ids: string[]): Promise<Document[]>;
  hashes(libraryId: string, versionId: string): Promise<DocHashEntry[]>;
  /** Copies the documents of `fromVersionId` missing from `toVersionId`; returns how many. */
  cloneVersion(libraryId: string, fromVersionId: string, toVersionId: string): Promise<number>;
  /** The `library/slug` keys of `refs` that exist in their library's current version. */
  existingCurrent(refs: { library: string; slug: string }[]): Promise<Set<string>>;
  /** Replaces the document's auto (LLM-suggested) links; manual links are never touched. */
  replaceAutoLinks(documentId: string, links: SuggestedLink[]): Promise<void>;
}

export interface ImageRepository {
  /**
   * Inserts or updates an image record. With `storeBlob`, the file is stored and the record
   * written as one step that no `releaseBlob` of the same library and hash can interleave with.
   */
  upsert(
    libraryId: string,
    versionId: string,
    slug: string,
    filename: string,
    fileSize: number,
    imageHash: string,
    mimeType: string,
    storeBlob?: () => Promise<void>,
  ): Promise<void>;
  list(libraryId: string, versionId: string, slug: string): Promise<ImageRecord[]>;
  get(
    libraryId: string,
    versionId: string,
    slug: string,
    filename: string,
  ): Promise<{ image_hash: string; mime_type: string } | undefined>;
  delete(libraryId: string, versionId: string, slug: string, filename: string): Promise<void>;
  cloneVersion(libraryId: string, fromVersionId: string, toVersionId: string): Promise<number>;
  /**
   * Calls `deleteBlob` (and answers true) only if no image record of `libraryId` (in any version)
   * still points at `imageHash`, serialized with uploads of the same library and hash. Files are
   * stored per library directory, so records of other libraries never keep this library's file,
   * except a library whose id differs only by case: on a case-insensitive file system it shares
   * the directory, so its records count too.
   */
  releaseBlob(libraryId: string, imageHash: string, deleteBlob: () => Promise<void>): Promise<boolean>;
}

/** Content-addressed image files: one file per (library, sha256). */
export interface BlobStore {
  hash(data: Uint8Array): string;
  path(libraryId: string, imageHash: string): string;
  save(libraryId: string, imageHash: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
}

/** The configured embedding provider, resolved on each call (it is set up at startup). */
export interface Embedder {
  available(): boolean;
  /** Suggested minimum cosine similarity for a vector hit, if the provider has one. */
  minScore(): number | undefined;
  /** Stable id of the model that produced the vectors (tags stored vectors); null without a provider. */
  modelId(): string | null;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** A document whose vector is missing or was produced by another model. */
export interface StaleDocument {
  document_id: string;
  library_id: string;
  version_id: string;
  summary: string | null;
  content: string;
}

/** Stored document vectors, as far as re-embedding needs them. */
export interface VectorIndex {
  /** Documents without a vector of `modelId` (all documents with `all`). */
  countStale(modelId: string, o: { all: boolean }): Promise<number>;
  /** The next `limit` of them with `document_id > afterId`, ordered by `document_id`. */
  staleAfter(modelId: string, o: { all: boolean; afterId: string | null; limit: number }): Promise<StaleDocument[]>;
  /** Upserts on `document_id`, setting `embedding` and `model`. */
  save(
    modelId: string,
    rows: { document_id: string; library_id: string; version_id: string; embedding: number[] }[],
  ): Promise<void>;
}

/** Suggests links from a document to known slugs (an LLM). Returns the raw, unvalidated items. */
export interface LinkSuggester {
  enabled(): boolean;
  suggest(doc: Document, knownSlugs: string[]): Promise<unknown[]>;
}

/** Read-side queries over documents: full-text, vectors, metadata, stats, links. */
export interface DocumentSearch {
  fullText(opts: SearchOptions): Promise<SearchResult[]>;
  vector(
    embedding: number[],
    filters: { library_id?: string } & VersionFilter,
    limit: number,
    minScore?: number,
  ): Promise<VectorSearchResult[]>;
  /** At most a bounded number of matches (the adapter's limit), ordered by library and slug. */
  byMetadata(keys: Record<string, string>, libraryId?: string, filter?: VersionFilter): Promise<MetadataMatch[]>;
  overview(libraryId: string, filter?: VersionFilter): Promise<DomainStat[]>;
  categories(libraryId: string, filter?: VersionFilter): Promise<CategoryStat[]>;
  services(libraryId?: string, filter?: VersionFilter): Promise<ServiceInfo[]>;
  linksFrom(results: SearchResult[], opts?: LinksFromOptions): Promise<LinkedDoc[]>;
  related(opts: FindRelatedOptions): Promise<LinkResult[]>;
  inferRelated(opts: FindRelatedOptions): Promise<InferredLinkResult[]>;
}

export interface TopologyReader {
  serviceDocs(libraryId: string, versionId: string, service: string): Promise<TopologyDoc[]>;
  outLinks(documentIds: string[]): Promise<TopologyLink[]>;
  docsBySlugs(libraryId: string, versionId: string, slugs: string[]): Promise<TopologyDoc[]>;
}

export interface CatalogDeps {
  libraries: LibraryRepository;
  versions: VersionRepository;
  documents: DocumentRepository;
  images: ImageRepository;
  blobs: BlobStore;
  embedder: Embedder;
  vectors: VectorIndex;
  links: LinkSuggester;
  search: DocumentSearch;
  topology: TopologyReader;
  namespaces: NamespaceRepository;
  projectKeys: ProjectKeyRepository;
  keySecrets: KeySecrets;
  clock: Clock;
  /** Library ids no push may write, in any namespace: the configured insights library. */
  reservedLibraryIds: ReadonlySet<string>;
}
