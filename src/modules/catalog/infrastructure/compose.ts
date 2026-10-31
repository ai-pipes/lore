import type { LanguageModel } from '../../llm/index.js';
import { systemClock } from '../../../shared-kernel/index.js';
import type { CatalogDeps } from '../application/ports.js';
import { providerEmbedder } from './embeddings/EmbeddingProvider.js';
import { fileBlobStore } from './file-storage.js';
import { createLlmLinkSuggester } from './llm-link-suggester.js';
import { pgDocumentRepository } from './pg-documents.js';
import { pgDocumentSearch } from './pg-document-search.js';
import { pgImageRepository } from './pg-images.js';
import { pgLibraryRepository } from './pg-libraries.js';
import { pgNamespaceRepository } from './pg-namespaces.js';
import { nodeKeySecrets, pgProjectKeyRepository } from './pg-project-keys.js';
import { pgTopologyReader } from './pg-topology.js';
import { pgVectorIndex } from './pg-vectors.js';
import { pgVersionRepository } from './pg-versions.js';

/**
 * The catalog's ports bound to Postgres, the file store, the embedding provider and the LLM.
 * Everything is resolved lazily on each call (getDb, the provider set up by initEmbeddings).
 */
/** `reservedLibraryIds`: library ids no push may write (the configured insights library). */
export function createPgCatalog(o: { reservedLibraryIds?: Iterable<string>; llm: LanguageModel }): CatalogDeps {
  return {
    libraries: pgLibraryRepository,
    versions: pgVersionRepository,
    documents: pgDocumentRepository,
    images: pgImageRepository,
    blobs: fileBlobStore,
    embedder: providerEmbedder,
    vectors: pgVectorIndex,
    links: createLlmLinkSuggester(o.llm),
    search: pgDocumentSearch,
    topology: pgTopologyReader,
    namespaces: pgNamespaceRepository,
    projectKeys: pgProjectKeyRepository,
    keySecrets: nodeKeySecrets,
    clock: systemClock,
    reservedLibraryIds: new Set(o.reservedLibraryIds ?? []),
  };
}
