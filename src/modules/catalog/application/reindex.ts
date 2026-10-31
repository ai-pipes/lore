import { err, ok, type Result } from '../../../shared-kernel/index.js';
import { embeddingText } from '../domain/embedding-text.js';
import type { CatalogDeps } from './ports.js';

export const REINDEX_BATCH_SIZE = 64;

/**
 * Recomputes the vectors of documents that have none of the current embedding model (all documents
 * with `all`), a batch at a time. Every batch is saved before the next is embedded, so a failure
 * (the rejection propagates) leaves earlier batches done and a re-run continues with the rest.
 */
export async function reindexEmbeddings(
  d: Pick<CatalogDeps, 'embedder' | 'vectors'>,
  o: { all?: boolean; batchSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<Result<{ done: number; total: number }, 'no_provider'>> {
  const modelId = d.embedder.modelId();
  if (!d.embedder.available() || modelId === null) return err('no_provider');
  const all = o.all ?? false;
  const limit = o.batchSize ?? REINDEX_BATCH_SIZE;
  const total = await d.vectors.countStale(modelId, { all });
  let done = 0;
  let afterId: string | null = null;
  while (done < total) {
    const batch = await d.vectors.staleAfter(modelId, { all, afterId, limit });
    if (batch.length === 0) break;
    const embeddings = await d.embedder.embedBatch(batch.map(embeddingText));
    await d.vectors.save(
      modelId,
      batch.map((doc, i) => ({
        document_id: doc.document_id,
        library_id: doc.library_id,
        version_id: doc.version_id,
        embedding: embeddings[i]!,
      })),
    );
    done += batch.length;
    afterId = batch[batch.length - 1]!.document_id;
    o.onProgress?.(done, total);
  }
  return ok({ done, total });
}
