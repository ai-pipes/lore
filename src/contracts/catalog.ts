/**
 * Request and response bodies of the catalog HTTP API, shared by the server routes and the
 * client CLI. Field names are the JSON field names on the wire.
 */

/** `GET /api/libraries/:id`, and the body of `POST /api/libraries` for an existing library. */
export interface LibraryResponse {
  id: string;
  display_name: string;
  namespace_id: string;
  created_at: string;
}

/** One entry of `GET /api/libraries`. */
export interface LibraryListItem extends LibraryResponse {
  current_version: string | null;
  document_count: number;
}

/** `POST /api/libraries`. */
export interface CreateLibraryRequest {
  id: string;
  display_name: string;
  /** Namespace of a new library (admins only; default `default`). A project key may give only its own. */
  namespace_id?: string;
}

/** `POST /api/libraries`: 201 when the library was created, 200 when it existed. */
export type CreateLibraryResponse = LibraryResponse;

/** `GET /api/libraries/:id/versions` (one entry) and `POST /api/libraries/:id/versions`. */
export interface VersionResponse {
  id: string;
  library_id: string;
  branch: string | null;
  is_current: boolean;
  pushed_at: string;
}

/** `POST /api/libraries/:id/versions`. */
export interface CreateVersionRequest {
  id: string;
  branch?: string;
}

/** One link of a pushed document. */
export interface BulkDocumentLink {
  slug: string;
  library?: string;
  type?: string;
}

/** One element of the `POST /api/libraries/:id/versions/:versionId/documents/bulk` body. */
export interface BulkDocumentItem {
  slug: string;
  content: string;
  domain?: string;
  project_name?: string;
  entry_type?: string;
  summary?: string;
  handler_class?: string;
  http_method?: string;
  route?: string;
  generated_at?: string;
  category?: string;
  links?: BulkDocumentLink[];
}

/** `POST /api/libraries/:id/versions/:versionId/documents/bulk`. */
export interface BulkDocumentsResponse {
  inserted: number;
}

/**
 * One entry of `GET /api/libraries/:id/versions/:versionId/document-hashes`: every document of the
 * version, unpaginated, as the CLI reads it to diff an incremental push.
 */
export interface DocumentHashItem {
  slug: string;
  content_hash: string | null;
}

/** One entry of `GET /api/libraries/:id/versions/:versionId/images?slug=…`. */
export interface ImageListItem {
  filename: string;
  file_size: number | null;
  image_hash: string | null;
  mime_type: string;
  created_at: string | null;
}

/** `POST /api/libraries/:id/versions/:versionId/images`. */
export interface ImageUploadResponse {
  filename: string;
  url: string;
}

/** `POST /api/libraries/:id/versions/:versionId/clone-from/:sourceId`. */
export interface CloneResponse {
  cloned: number;
}
