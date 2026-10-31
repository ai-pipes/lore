/**
 * Public API of the catalog module: libraries, versions, documents, images,
 * embeddings, diff, topology and enrichment.
 * Drizzle tables are never exported from here; platform/db.ts imports infrastructure/schema.ts.
 */
export { LIBRARY_ID_RE, isValidLibraryId, type Library, type LibraryWithStats } from './domain/library.js';
export type { Version } from './domain/version.js';
export {
  DEFAULT_NAMESPACE,
  INSIGHTS_NAMESPACE,
  NAMESPACE_ID_RE,
  isSystemNamespace,
  isValidNamespaceId,
  type Namespace,
  type ProjectCaller,
  type ProjectKeyRecord,
} from './domain/namespace.js';
export { decidePush, type PushActor, type PushDecision } from './domain/push-policy.js';
export {
  DocumentExistsError,
  type CategoryStat,
  type Document,
  type DocumentInput,
  type DomainStat,
  type FindRelatedOptions,
  type InferredLinkResult,
  type LibraryScope,
  type LinkedDoc,
  type LinkInput,
  type LinkResult,
  type ListDocumentsOptions,
  type SearchOptions,
  type SearchResult,
  type ServiceInfo,
  type VectorSearchResult,
  type VersionFilter,
} from './domain/document.js';
export type { ServiceTopology, TopologyEdge, TopologyNode } from './domain/topology.js';
export type {
  CatalogDeps,
  LibraryRepository,
  VersionRepository,
  DocumentRepository,
  ImageRepository,
  BlobStore,
  Embedder,
  VectorIndex,
  StaleDocument,
  LinkSuggester,
  DocumentSearch,
  TopologyReader,
  NamespaceRepository,
  ProjectKeyRepository,
  KeySecrets,
} from './application/ports.js';
export { registerLibrary, pushLibrary, ensureLibraryVersion, ensureSystemLibrary } from './application/libraries.js';
export { assignLibrary, createNamespace, listNamespaces, renameNamespace } from './application/namespaces.js';
export {
  authenticateProjectKey,
  createProjectKey,
  listProjectKeys,
  PROJECT_KEY_PREFIX,
  revokeProjectKey,
} from './application/project-keys.js';
export {
  getDocumentBySlug,
  getDocumentsByIds,
  insertDocument,
  listDocuments,
  existingCurrentDocuments,
} from './application/documents.js';
export {
  searchFullText,
  searchVectors,
  embedQuery,
  findByAnyMetadataKey,
  getLibraryOverview,
  getCategoryStats,
  listServices,
  linksFrom,
} from './application/search.js';
export { findRelatedDocs, inferRelatedDocs } from './application/enrichment.js';
export { reindexEmbeddings, REINDEX_BATCH_SIZE } from './application/reindex.js';
export { getTopology } from './application/topology.js';
export { diffVersions, type DocumentDiff } from './application/diff.js';
export { createPgCatalog } from './infrastructure/compose.js';
export { initEmbeddings } from './infrastructure/embeddings/EmbeddingProvider.js';
export { catalogRoutes } from './interfaces/http/routes.js';
export type { CatalogRouteOptions } from './interfaces/http/push-guard.js';

// Postgres-bound repository functions, used by code that has not moved into modules yet.
export { upsertLibrary, getLibrary, listLibraries } from './infrastructure/pg-libraries.js';
export {
  createVersion,
  promoteVersion,
  getCurrentVersion,
  listVersions,
  deleteVersion,
} from './infrastructure/pg-versions.js';
