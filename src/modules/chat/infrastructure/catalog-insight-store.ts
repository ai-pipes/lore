/**
 * Insights live in their own library (LORE_INSIGHTS_LIBRARY, default "insights") with one
 * long-lived version, so service pushes (which delete documents missing from the pushed folder)
 * never touch them.
 */
import {
  DocumentExistsError,
  ensureLibraryVersion,
  existingCurrentDocuments,
  getDocumentBySlug,
  INSIGHTS_NAMESPACE,
  insertDocument,
  isValidLibraryId,
  type CatalogDeps,
} from '../../catalog/index.js';
import type { InsightStore } from '../application/ports.js';

export const INSIGHTS_VERSION = 'insights';

/** `LORE_INSIGHTS_LIBRARY` (default `insights`); throws for an invalid library id. */
export function insightsLibraryId(env: Record<string, string | undefined> = process.env): string {
  const id = env.LORE_INSIGHTS_LIBRARY || 'insights';
  if (!isValidLibraryId(id)) throw new Error(`Invalid LORE_INSIGHTS_LIBRARY "${id}"`);
  return id;
}

export function catalogInsightStore(catalog: CatalogDeps): InsightStore {
  return {
    // The insights library lives in the system namespace `insights`, whatever its id.
    ensureInsightsVersion: () =>
      ensureLibraryVersion(catalog, insightsLibraryId(), 'Insights', INSIGHTS_VERSION, INSIGHTS_NAMESPACE),
    existing: (refs) => existingCurrentDocuments(catalog, refs),
    exists: async (libraryId, versionId, slug) => Boolean(await getDocumentBySlug(catalog, libraryId, slug, { version_id: versionId })),
    insert: async (input, onConflict) => {
      try {
        const doc = await insertDocument(catalog, input, { onConflict });
        return { id: doc.id };
      } catch (e) {
        if (e instanceof DocumentExistsError) return 'exists';
        throw e;
      }
    },
  };
}
