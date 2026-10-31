import { and, asc, count, gt, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { VectorIndex } from '../application/ports.js';
import { document_vectors, documents } from './schema.js';

/** Documents with no vector or one of another model; every document with `all`. */
function staleCondition(modelId: string, all: boolean): SQL | undefined {
  return all ? undefined : or(isNull(document_vectors.document_id), sql`${document_vectors.model} IS DISTINCT FROM ${modelId}`);
}

export const pgVectorIndex: VectorIndex = {
  async countStale(modelId, o) {
    const [row] = await getDb()
      .select({ n: count() })
      .from(documents)
      .leftJoin(document_vectors, sql`${document_vectors.document_id} = ${documents.id}`)
      .where(staleCondition(modelId, o.all));
    return row?.n ?? 0;
  },

  async staleAfter(modelId, o) {
    return getDb()
      .select({
        document_id: documents.id,
        library_id: documents.library_id,
        version_id: documents.version_id,
        summary: documents.summary,
        content: documents.content,
      })
      .from(documents)
      .leftJoin(document_vectors, sql`${document_vectors.document_id} = ${documents.id}`)
      .where(and(staleCondition(modelId, o.all), o.afterId === null ? undefined : gt(documents.id, o.afterId)))
      .orderBy(asc(documents.id))
      .limit(o.limit);
  },

  async save(modelId, rows) {
    if (rows.length === 0) return;
    await getDb()
      .insert(document_vectors)
      .values(rows.map((r) => ({ ...r, model: modelId })))
      .onConflictDoUpdate({
        target: document_vectors.document_id,
        set: { embedding: sql`excluded.embedding`, model: sql`excluded.model` },
      });
  },
};
