import { getDocumentBySlug, type CatalogDeps } from '../../catalog/index.js';
import type { ChatDocs } from '../application/ports.js';

/** The chat's read view of the catalog. */
export function catalogChatDocs(catalog: CatalogDeps): ChatDocs {
  return {
    bySlug: (libraryId, slug, o = {}) => getDocumentBySlug(catalog, libraryId, slug, o),
    listLibraries: () => catalog.libraries.list(),
    libraryExists: async (id) => (await catalog.libraries.get(id)) !== undefined,
  };
}
