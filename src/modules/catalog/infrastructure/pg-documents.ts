import { createHash, randomUUID } from 'crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import {
  DocumentExistsError,
  type DocHashEntry,
  type Document,
  type DocumentInput,
  type LinkInput,
  type LinkSnapshot,
  type ListDocumentsOptions,
  type VersionFilter,
} from '../domain/document.js';
import type { SuggestedLink } from '../domain/links.js';
import type { DocumentRepository } from '../application/ports.js';
import { documents, document_metadata, document_vectors, document_links, versions } from './schema.js';
import { versionCondition } from './version-filter.js';
import { embeddingText } from '../domain/embedding-text.js';
import { getEmbeddingProvider } from './embeddings/EmbeddingProvider.js';

export type { Document, DocumentInput, LinkInput, DocHashEntry, ListDocumentsOptions };
export { DocumentExistsError };

function normalizeContent(s: string): string {
  return s.replace(/\r\n/g, '\n').trim();
}

export function computeDocHash(
  input: Omit<DocumentInput, 'library_id' | 'version_id' | 'metadata' | 'generated_at'>,
): string {
  const linksStr = (input.links ?? [])
    .map((l) => `${l.slug}|${l.library ?? ''}|${l.type}`)
    .sort()
    .join(',');
  const parts = [
    input.slug,
    input.domain ?? '',
    input.project_name ?? '',
    input.entry_type ?? '',
    input.handler_class ?? '',
    input.category ?? '',
    input.http_method ?? '',
    input.route ?? '',
    input.summary ?? '',
    normalizeContent(input.content),
    linksStr,
  ];
  return createHash('sha256').update(parts.join('\x00')).digest('hex');
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Makes a stored document's metadata and manual links exactly those of `input`: whatever an
 * earlier upload (or a clone from another version) stored is replaced, and missing metadata or
 * links mean none, as in computeDocHash. Auto (LLM-suggested) links are kept.
 */
async function replaceMetadataAndManualLinks(tx: Tx, documentId: string, input: DocumentInput): Promise<void> {
  await tx.delete(document_metadata).where(eq(document_metadata.document_id, documentId));
  const metadata = input.metadata ?? [];
  if (metadata.length > 0) {
    await tx.insert(document_metadata).values(metadata.map(({ key, value }) => ({ document_id: documentId, key, value })));
  }

  await tx.delete(document_links).where(
    and(eq(document_links.from_document_id, documentId), ne(document_links.source, 'auto')),
  );
  const links = input.links ?? [];
  if (links.length > 0) {
    await tx.insert(document_links).values(
      links.map((l) => ({
        from_document_id: documentId,
        to_slug: l.slug,
        to_library_id: l.library ?? null,
        link_type: l.type,
        source: 'manual' as const,
      })),
    );
  }
}

/**
 * Insert a document. By default an existing document with the same
 * (library, version, slug) is updated in place; with `onConflict: 'error'`
 * the insert fails with DocumentExistsError instead (atomic, no race).
 */
export async function insertDocument(
  input: DocumentInput,
  opts: { onConflict?: 'update' | 'error' } = {},
): Promise<Document> {
  const db = getDb();
  const id = randomUUID();
  const content_hash = computeDocHash(input);

  const embeddingProvider = getEmbeddingProvider();
  let embeddingVector: number[] | null = null;
  if (embeddingProvider) {
    try {
      embeddingVector = await embeddingProvider.embed(embeddingText(input));
    } catch (err) {
      console.error('Warning: failed to generate embedding:', err);
    }
  }

  const docValues = {
    id,
    library_id: input.library_id,
    version_id: input.version_id,
    slug: input.slug,
    domain: input.domain ?? null,
    project_name: input.project_name ?? null,
    entry_type: input.entry_type ?? null,
    handler_class: input.handler_class ?? null,
    http_method: input.http_method ?? null,
    route: input.route ?? null,
    summary: input.summary ?? null,
    content: input.content,
    generated_at: input.generated_at ?? null,
    content_hash,
    category: input.category ?? null,
    author_user_id: input.author_user_id ?? null,
    author_name: input.author_name ?? null,
  };

  let result!: Document;

  await db.transaction(async (tx) => {
    if (opts.onConflict === 'error') {
      const [created] = await tx.insert(documents).values(docValues).onConflictDoNothing().returning();
      if (!created) throw new DocumentExistsError(input.library_id, input.version_id, input.slug);
    }
    const [doc] = await tx
      .insert(documents)
      .values(docValues)
      .onConflictDoUpdate({
        target: [documents.library_id, documents.version_id, documents.slug],
        set: {
          domain: docValues.domain,
          project_name: docValues.project_name,
          entry_type: docValues.entry_type,
          handler_class: docValues.handler_class,
          http_method: docValues.http_method,
          route: docValues.route,
          summary: docValues.summary,
          content: docValues.content,
          generated_at: docValues.generated_at,
          content_hash: docValues.content_hash,
          category: docValues.category,
          author_user_id: docValues.author_user_id,
          author_name: docValues.author_name,
        },
      })
      .returning();

    result = doc;

    await replaceMetadataAndManualLinks(tx, doc.id, input);

    if (embeddingVector) {
      await tx
        .insert(document_vectors)
        .values({
          document_id: doc.id,
          library_id: input.library_id,
          version_id: input.version_id,
          embedding: embeddingVector,
          model: embeddingProvider!.id,
        })
        .onConflictDoUpdate({
          target: document_vectors.document_id,
          set: { embedding: embeddingVector, model: embeddingProvider!.id },
        });
    } else if (embeddingProvider) {
      // Embedding generation failed — remove any stale vector so it doesn't serve outdated data
      await tx.delete(document_vectors).where(eq(document_vectors.document_id, doc.id));
    }
  });

  return result;
}

/**
 * Insert multiple documents in a single transaction with one batch embedding call.
 * Significantly faster than calling insertDocument() in a loop when embeddings are enabled.
 */
export async function insertDocumentBatch(inputs: DocumentInput[]): Promise<Document[]> {
  if (inputs.length === 0) return [];

  const db = getDb();
  const embeddingProvider = getEmbeddingProvider();

  // Generate all embeddings in one batch API call
  let embeddings: (number[] | null)[] = inputs.map(() => null);
  if (embeddingProvider) {
    try {
      const batch = await embeddingProvider.embedBatch(inputs.map(embeddingText));
      embeddings = batch;
    } catch (err) {
      console.error('Warning: failed to generate batch embeddings:', err);
    }
  }

  const results: Document[] = [];

  await db.transaction(async (tx) => {
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const id = randomUUID();
      const content_hash = computeDocHash(input);
      const embeddingVector = embeddings[i];

      const docValues = {
        id,
        library_id: input.library_id,
        version_id: input.version_id,
        slug: input.slug,
        domain: input.domain ?? null,
        project_name: input.project_name ?? null,
        entry_type: input.entry_type ?? null,
        handler_class: input.handler_class ?? null,
        http_method: input.http_method ?? null,
        route: input.route ?? null,
        summary: input.summary ?? null,
        content: input.content,
        generated_at: input.generated_at ?? null,
        content_hash,
        category: input.category ?? null,
        author_user_id: input.author_user_id ?? null,
        author_name: input.author_name ?? null,
      };

      const [doc] = await tx
        .insert(documents)
        .values(docValues)
        .onConflictDoUpdate({
          target: [documents.library_id, documents.version_id, documents.slug],
          set: {
            domain: docValues.domain,
            project_name: docValues.project_name,
            entry_type: docValues.entry_type,
            handler_class: docValues.handler_class,
            http_method: docValues.http_method,
            route: docValues.route,
            summary: docValues.summary,
            content: docValues.content,
            generated_at: docValues.generated_at,
            content_hash: docValues.content_hash,
            category: docValues.category,
            author_user_id: docValues.author_user_id,
            author_name: docValues.author_name,
          },
        })
        .returning();

      results.push(doc);

      await replaceMetadataAndManualLinks(tx, doc.id, input);

      if (embeddingVector) {
        await tx
          .insert(document_vectors)
          .values({
            document_id: doc.id,
            library_id: input.library_id,
            version_id: input.version_id,
            embedding: embeddingVector,
            model: embeddingProvider!.id,
          })
          .onConflictDoUpdate({
            target: document_vectors.document_id,
            set: { embedding: embeddingVector, model: embeddingProvider!.id },
          });
      } else if (embeddingProvider) {
        await tx.delete(document_vectors).where(eq(document_vectors.document_id, doc.id));
      }
    }
  });

  return results;
}

export async function cloneVersionDocs(
  library_id: string,
  fromVersionId: string,
  toVersionId: string,
): Promise<number> {
  const db = getDb();

  // Single bulk query using CTEs:
  // 1. id_mapping: generate new UUIDs for each source document (MATERIALIZED ensures
  //    gen_random_uuid() is called once and the same new_id is reused across all CTEs)
  // 2. inserted_docs: bulk-insert all document rows
  // 3. inserted_meta: bulk-insert all metadata rows using the id mapping
  // 4. inserted_vectors: bulk-insert all vector rows using the id mapping
  const result = await db.execute(sql`
    WITH id_mapping AS MATERIALIZED (
      SELECT id AS old_id, gen_random_uuid()::text AS new_id
      FROM documents src
      WHERE src.library_id = ${library_id} AND src.version_id = ${fromVersionId}
        -- Skip slugs the target version already has (re-pushing an existing version):
        -- otherwise metadata/links would reference document ids that were never inserted.
        AND NOT EXISTS (
          SELECT 1 FROM documents dst
          WHERE dst.library_id = ${library_id} AND dst.version_id = ${toVersionId} AND dst.slug = src.slug
        )
    ),
    inserted_docs AS (
      INSERT INTO documents
        (id, library_id, version_id, slug, domain, project_name, entry_type,
         handler_class, category, http_method, route, summary, content, generated_at, content_hash,
         author_user_id, author_name)
      SELECT
        m.new_id, d.library_id, ${toVersionId}, d.slug, d.domain, d.project_name, d.entry_type,
        d.handler_class, d.category, d.http_method, d.route, d.summary, d.content, d.generated_at, d.content_hash,
        d.author_user_id, d.author_name
      FROM documents d
      JOIN id_mapping m ON d.id = m.old_id
      ON CONFLICT DO NOTHING
    ),
    inserted_meta AS (
      INSERT INTO document_metadata (document_id, key, value)
      SELECT m.new_id, dm.key, dm.value
      FROM document_metadata dm
      JOIN id_mapping m ON dm.document_id = m.old_id
    ),
    inserted_vectors AS (
      INSERT INTO document_vectors (document_id, library_id, version_id, embedding, model)
      SELECT m.new_id, ${library_id}, ${toVersionId}, dv.embedding, dv.model
      FROM document_vectors dv
      JOIN id_mapping m ON dv.document_id = m.old_id
      ON CONFLICT DO NOTHING
    ),
    inserted_links AS (
      INSERT INTO document_links (from_document_id, to_slug, to_library_id, link_type, source, confidence)
      SELECT m.new_id, dl.to_slug, dl.to_library_id, dl.link_type, dl.source, dl.confidence
      FROM document_links dl
      JOIN id_mapping m ON dl.from_document_id = m.old_id
    )
    SELECT count(*)::int AS count FROM id_mapping
  `);

  // postgres.js returns rows as an array-like object
  const row = (result as unknown as Array<{ count: number }>)[0];
  return Number(row?.count ?? 0);
}

export async function listDocumentHashes(library_id: string, version_id: string): Promise<DocHashEntry[]> {
  return getDb()
    .select({ slug: documents.slug, content_hash: documents.content_hash })
    .from(documents)
    .where(and(eq(documents.library_id, library_id), eq(documents.version_id, version_id)));
}

export async function deleteDocument(
  library_id: string,
  version_id: string,
  slug: string,
): Promise<boolean> {
  const db = getDb();
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.library_id, library_id),
        eq(documents.version_id, version_id),
        eq(documents.slug, slug),
      ),
    )
    .limit(1);

  if (!doc) return false;

  await db.delete(documents).where(eq(documents.id, doc.id));
  return true;
}

export async function listDocuments(opts: ListDocumentsOptions): Promise<Document[]> {
  const db = getDb();
  const verCond = versionCondition(opts);
  const conditions = [eq(documents.library_id, opts.library_id), verCond];

  if (opts.domain) conditions.push(eq(documents.domain, opts.domain));
  if (opts.entry_type) conditions.push(eq(documents.entry_type, opts.entry_type));
  if (opts.category) conditions.push(eq(documents.category, opts.category));

  return db
    .select({ doc: documents })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(and(...conditions))
    .orderBy(documents.domain, documents.slug)
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0)
    .then((rows) => rows.map((r) => r.doc));
}

export async function getDocumentBySlug(
  library_id: string,
  slug: string,
  filter: VersionFilter = {},
): Promise<Document | undefined> {
  const verCond = versionCondition(filter);
  return getDb()
    .select({ doc: documents })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(and(eq(documents.library_id, library_id), eq(documents.slug, slug), verCond))
    .limit(1)
    .then((rows) => rows[0]?.doc);
}

export async function getDocumentsByIds(ids: string[]): Promise<Document[]> {
  if (ids.length === 0) return [];
  return getDb().select().from(documents).where(inArray(documents.id, ids));
}

/** One document of an exact version (no current/branch resolution), or null. */
export async function getDocumentInVersion(
  library_id: string,
  slug: string,
  version_id: string,
): Promise<Document | null> {
  return getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.library_id, library_id), eq(documents.slug, slug), eq(documents.version_id, version_id)))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/** The outgoing links of a document. */
export async function getDocumentLinks(documentId: string): Promise<LinkSnapshot[]> {
  const rows = await getDb().select().from(document_links).where(eq(document_links.from_document_id, documentId));
  return rows.map((link) => ({
    toSlug: link.to_slug,
    toLibraryId: link.to_library_id,
    linkType: link.link_type,
    source: link.source,
  }));
}

/**
 * The `library/slug` keys of `refs` that exist in their library's current version,
 * resolved with a single query.
 */
export async function existingCurrentDocuments(refs: { library: string; slug: string }[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const found = await getDb()
    .select({ slug: documents.slug, library_id: documents.library_id })
    .from(documents)
    .innerJoin(versions, and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)))
    .where(and(
      eq(versions.is_current, true),
      sql`(${documents.slug}, ${documents.library_id}) IN (${sql.join(refs.map((r) => sql`(${r.slug}, ${r.library})`), sql`, `)})`,
    ));
  return new Set(found.map((f) => `${f.library_id}/${f.slug}`));
}

/** Replaces the auto links of a document in one transaction; manual links are kept. */
export async function replaceAutoLinks(documentId: string, links: SuggestedLink[]): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Always remove stale auto links so re-enrichment never leaves orphans
    await tx.delete(document_links).where(
      and(
        eq(document_links.from_document_id, documentId),
        eq(document_links.source, 'auto'),
      ),
    );

    if (links.length > 0) {
      await tx.insert(document_links).values(
        links.map((l) => ({
          from_document_id: documentId,
          to_slug: l.toSlug,
          to_library_id: null,
          link_type: l.linkType,
          source: 'auto' as const,
          confidence: l.confidence,
        })),
      );
    }
  });
}

export const pgDocumentRepository: DocumentRepository = {
  insert: insertDocument,
  insertBatch: insertDocumentBatch,
  delete: deleteDocument,
  list: listDocuments,
  bySlug: getDocumentBySlug,
  byIds: getDocumentsByIds,
  hashes: listDocumentHashes,
  cloneVersion: cloneVersionDocs,
  existingCurrent: existingCurrentDocuments,
  replaceAutoLinks,
  inVersion: getDocumentInVersion,
  linksOf: getDocumentLinks,
};
