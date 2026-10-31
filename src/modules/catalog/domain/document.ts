import type { MetadataEntry } from './metadata.js';

/** Which version of a library to read: an explicit version wins, then a branch, else the current one. */
export interface VersionFilter {
  version_id?: string;
  branch?: string;
}

/** A library together with the version of it to read. */
export interface LibraryScope extends VersionFilter {
  library_id: string;
}

/** Link expansion: at most `maxLinked` documents; each library is read in its scope, else its current version. */
export interface LinksFromOptions {
  maxLinked?: number;
  scopes?: LibraryScope[];
}

/** A Markdown page in a version, addressed by `slug`. */
export interface Document {
  id: string;
  library_id: string;
  version_id: string;
  slug: string;
  domain: string | null;
  project_name: string | null;
  entry_type: string | null;
  handler_class: string | null;
  http_method: string | null;
  route: string | null;
  summary: string | null;
  content: string;
  generated_at: string | null;
  content_hash: string | null;
  category: string | null;
  /** The user who wrote the document (insights only); null when unknown or deleted. */
  author_user_id: string | null;
  /** The author's display name at publishing time; kept when the user is deleted. */
  author_name: string | null;
}

/** A document found by its metadata: the summary fields, without the content. */
export interface MetadataMatch {
  id: string;
  slug: string;
  library_id: string;
  domain: string | null;
  entry_type: string | null;
  summary: string | null;
}

export interface LinkInput {
  slug: string;
  library?: string;
  type: string;
}

export interface DocumentInput {
  library_id: string;
  version_id: string;
  slug: string;
  domain?: string;
  project_name?: string;
  entry_type?: string;
  handler_class?: string;
  http_method?: string;
  route?: string;
  summary?: string;
  content: string;
  generated_at?: string;
  metadata?: MetadataEntry[];
  category?: string;
  links?: LinkInput[];
  author_user_id?: string;
  author_name?: string;
}

/** Thrown by insertDocument({ onConflict: 'error' }) when the slug already exists in the version. */
export class DocumentExistsError extends Error {
  constructor(readonly library_id: string, readonly version_id: string, readonly slug: string) {
    super(`Document ${library_id}/${slug} already exists in version ${version_id}`);
  }
}

export interface DocHashEntry {
  slug: string;
  content_hash: string | null;
}

export interface ListDocumentsOptions extends VersionFilter {
  library_id: string;
  domain?: string;
  entry_type?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

/** An outgoing link of a document, as a diff compares it. */
export interface LinkSnapshot {
  toSlug: string;
  toLibraryId: string | null;
  linkType: string;
  source: string;
}

export interface ImageRecord {
  filename: string;
  file_size: number | null;
  image_hash: string | null;
  mime_type: string;
  created_at: string | null;
}

/* ── Search shapes ─────────────────────────────────────── */

export interface SearchResult {
  slug: string;
  library_id: string;
  domain: string | null;
  entry_type: string | null;
  http_method: string | null;
  route: string | null;
  summary: string | null;
  score: number;
}

export interface SearchOptions extends VersionFilter {
  query: string;
  library_id?: string;
  domain?: string;
  entry_type?: string;
  category?: string;
  minScore?: number;
  limit?: number;
}

export interface VectorSearchResult {
  documentId: string;
  slug: string;
  library_id: string;
  domain: string | null;
  entry_type: string | null;
  http_method: string | null;
  route: string | null;
  summary: string | null;
  score: number; // cosine similarity 0..1
}

export interface LinkedDoc {
  slug: string;
  library_id: string;
  domain: string | null;
  entry_type: string | null;
  http_method: string | null;
  route: string | null;
  summary: string | null;
  link_type: string;
  from_slug: string;
}

export interface DomainStat {
  domain: string | null;
  entry_type: string | null;
  count: number;
}

export interface ServiceInfo {
  id: string;
  display_name: string;
  doc_count: number;
}

export interface CategoryStat {
  category: string | null;
  count: number;
}

/* ── Relationships ─────────────────────────────────────── */

export interface LinkResult {
  link_type: string;
  direction: 'outbound' | 'inbound';
  slug: string;
  library_id: string;
  domain: string | null;
  entry_type: string | null;
  summary: string | null;
  source: 'explicit';
}

export interface InferredLinkResult {
  link_type: string; // 'grpc' | 'http' | 'queue' | 'dal'
  direction: 'outbound' | 'inbound';
  slug: string;
  library_id: string;
  domain: string | null;
  entry_type: string | null;
  summary: string | null;
  source: 'inferred';
  matched_via: string; // e.g. "grpc_service:PaymentService"
}

export interface FindRelatedOptions extends VersionFilter {
  library_id: string;
  slug: string;
  link_type?: string;
  direction?: 'outbound' | 'inbound' | 'both';
}
