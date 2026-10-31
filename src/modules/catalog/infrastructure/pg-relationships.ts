import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { FindRelatedOptions, InferredLinkResult, LinkResult } from '../domain/document.js';
import { document_links, document_metadata, documents, versions } from './schema.js';
import { versionCondition } from './version-filter.js';

export type { FindRelatedOptions, InferredLinkResult, LinkResult };

/**
 * The requested version (version_id or branch head) of the requested library;
 * every other library in its current version — as link expansion (`linksFrom`)
 * reads libraries outside its scope. A version_id or branch names a version of
 * the requested library, so it says nothing about the other libraries.
 */
function relatedVersionCondition(opts: FindRelatedOptions): SQL {
  return or(
    and(eq(documents.library_id, opts.library_id), versionCondition(opts)),
    and(ne(documents.library_id, opts.library_id), versionCondition({})),
  )!;
}

export async function findRelatedDocs(opts: FindRelatedOptions): Promise<LinkResult[]> {
  const db = getDb();
  const { library_id, slug, link_type, direction = 'both' } = opts;
  const verCond = versionCondition(opts);
  const scopedCond = relatedVersionCondition(opts);
  const results: LinkResult[] = [];

  // Resolve the document id for the given slug + library + version
  const sourceDoc = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(and(eq(documents.library_id, library_id), eq(documents.slug, slug), verCond))
    .limit(1)
    .then((r) => r[0]);

  if (!sourceDoc) return [];

  // Outbound: links declared by this document
  if (direction === 'outbound' || direction === 'both') {
    const conditions = [eq(document_links.from_document_id, sourceDoc.id)];
    if (link_type) conditions.push(eq(document_links.link_type, link_type));

    const rows = await db
      .select({
        link_type: document_links.link_type,
        to_slug: document_links.to_slug,
        to_library_id: document_links.to_library_id,
      })
      .from(document_links)
      .where(and(...conditions));

    for (const row of rows) {
      const targetLibId = row.to_library_id ?? library_id;
      const target = await db
        .select({ doc: documents })
        .from(documents)
        .innerJoin(
          versions,
          and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
        )
        .where(and(eq(documents.library_id, targetLibId), eq(documents.slug, row.to_slug), scopedCond))
        .limit(1)
        .then((r) => r[0]?.doc);

      results.push({
        link_type: row.link_type,
        direction: 'outbound',
        slug: row.to_slug,
        library_id: targetLibId,
        domain: target?.domain ?? null,
        entry_type: target?.entry_type ?? null,
        summary: target?.summary ?? null,
        source: 'explicit',
      });
    }
  }

  // Inbound: links from other documents pointing to this slug. A link without a
  // target library points into the library of its source document.
  if (direction === 'inbound' || direction === 'both') {
    const conditions = [
      eq(document_links.to_slug, slug),
      or(
        eq(document_links.to_library_id, library_id),
        and(sql`${document_links.to_library_id} IS NULL`, eq(documents.library_id, library_id)),
      )!,
    ];
    if (link_type) conditions.push(eq(document_links.link_type, link_type));

    const rows = await db
      .select({
        link_type: document_links.link_type,
        from_document_id: document_links.from_document_id,
      })
      .from(document_links)
      .innerJoin(documents, eq(documents.id, document_links.from_document_id))
      .where(and(...conditions));

    if (rows.length > 0) {
      const sourceIds = rows.map((r) => r.from_document_id);
      const sourceDocs = await db
        .select()
        .from(documents)
        .innerJoin(
          versions,
          and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
        )
        .where(and(inArray(documents.id, sourceIds), scopedCond))
        .then((r) => r.map((row) => row.documents));
      const sourceMap = new Map(sourceDocs.map((d) => [d.id, d]));

      for (const row of rows) {
        const src = sourceMap.get(row.from_document_id);
        if (src) {
          results.push({
            link_type: row.link_type,
            direction: 'inbound',
            slug: src.slug,
            library_id: src.library_id,
            domain: src.domain,
            entry_type: src.entry_type,
            summary: src.summary,
            source: 'explicit',
          });
        }
      }
    }
  }

  return results;
}

/** Map metadata key to a short link_type label */
const KEY_TO_LINK_TYPE: Record<string, string> = {
  grpc_service: 'grpc',
  http_service: 'http',
  message_queue: 'queue',
  dal_interface: 'dal',
};

/**
 * The name other services would use for this handler: "PaymentServiceHandler" → "PaymentService",
 * "OrderController" → "Order".
 */
function handlerKeyword(handler_class: string): string {
  return handler_class.replace(/(?:Handler|Controller)$/, '');
}

/**
 * A case-insensitive Postgres regex matching `keyword` as a whole word: delimited by the start or
 * end of the value or by a character other than a letter, digit or underscore ("api-gateway"
 * matches "api-gateway.internal" and "grpc://api-gateway:443", not "rapid-api"). Every
 * non-alphanumeric character of the keyword is escaped, so it is matched literally.
 */
function wholeWordPattern(keyword: string): string {
  const escaped = keyword.replace(/[^A-Za-z0-9]/g, (c) => `\\${c}`);
  return `(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`;
}

/**
 * Infer outbound and inbound relationships from auto-extracted metadata,
 * without any explicit `links:` declarations in frontmatter.
 *
 * Outbound: this doc has grpc_service/http_service/queue → FTS search in other libs.
 * Inbound:  other libs have grpc_service/http_service/queue values that mention
 *           this doc's library_id or handler_class → those docs depend on us.
 */
export async function inferRelatedDocs(
  opts: FindRelatedOptions,
): Promise<InferredLinkResult[]> {
  const db = getDb();
  const { library_id, slug, direction = 'both' } = opts;
  const results: InferredLinkResult[] = [];

  // Resolve source doc id + handler_class
  const sourceDoc = await db
    .select({ id: documents.id, handler_class: documents.handler_class })
    .from(documents)
    .innerJoin(
      versions,
      and(eq(versions.id, documents.version_id), eq(versions.library_id, documents.library_id)),
    )
    .where(and(eq(documents.library_id, library_id), eq(documents.slug, slug), versionCondition(opts)))
    .limit(1)
    .then((r) => r[0]);

  if (!sourceDoc) return [];

  // ── Outbound: this doc's metadata → find matching docs in other libraries ──
  if (direction === 'outbound' || direction === 'both') {
    const metaRows = await db
      .select({ key: document_metadata.key, value: document_metadata.value })
      .from(document_metadata)
      .where(
        and(
          eq(document_metadata.document_id, sourceDoc.id),
          sql`${document_metadata.key} = ANY(${sql.raw("ARRAY['grpc_service','http_service','message_queue','dal_interface']")})`,
        ),
      );

    // Track already-found slugs to avoid duplicates across metadata entries
    const seen = new Set<string>();

    for (const meta of metaRows) {
      const linkType = KEY_TO_LINK_TYPE[meta.key] ?? meta.key;
      const matchedVia = `${meta.key}:${meta.value}`;

      // FTS search in other libraries' current versions
      const hits = await db.execute<{
        slug: string;
        library_id: string;
        domain: string | null;
        entry_type: string | null;
        summary: string | null;
      }>(sql`
        SELECT d.slug, d.library_id, d.domain, d.entry_type, d.summary
        FROM documents d
        JOIN versions v ON v.id = d.version_id AND v.library_id = d.library_id
        WHERE d.library_id != ${library_id}
          AND v.is_current = true
          AND d.search_vector @@ websearch_to_tsquery('english', ${meta.value})
        ORDER BY ts_rank(d.search_vector, websearch_to_tsquery('english', ${meta.value})) DESC
        LIMIT 2
      `);

      for (const hit of hits as unknown as Array<{ slug: string; library_id: string; domain: string | null; entry_type: string | null; summary: string | null }>) {
        const key = `${hit.library_id}:${hit.slug}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            link_type: linkType,
            direction: 'outbound',
            slug: hit.slug,
            library_id: hit.library_id,
            domain: hit.domain,
            entry_type: hit.entry_type,
            summary: hit.summary,
            source: 'inferred',
            matched_via: matchedVia,
          });
        }
      }
    }
  }

  // ── Inbound: find other libraries whose metadata references us ──
  if (direction === 'inbound' || direction === 'both') {
    // Names other services might use to reference us: the library id and the handler name
    const keywords: string[] = [library_id];
    if (sourceDoc.handler_class) {
      const hkw = handlerKeyword(sourceDoc.handler_class);
      if (hkw && hkw.toLowerCase() !== library_id.toLowerCase()) keywords.push(hkw);
    }

    // Each keyword must appear in the metadata value as a whole word
    const valueMatch = sql.join(keywords.map((kw) => sql`dm.value ~* ${wholeWordPattern(kw)}`), sql` OR `);

    const rows = await db.execute<{
      slug: string;
      library_id: string;
      domain: string | null;
      entry_type: string | null;
      summary: string | null;
      meta_key: string;
      meta_value: string;
    }>(sql`
      SELECT DISTINCT ON (d.id)
        d.slug, d.library_id, d.domain, d.entry_type, d.summary,
        dm.key AS meta_key, dm.value AS meta_value
      FROM document_metadata dm
      JOIN documents d ON d.id = dm.document_id
      JOIN versions v ON v.id = d.version_id AND v.library_id = d.library_id
      WHERE d.library_id != ${library_id}
        AND v.is_current = true
        AND dm.key = ANY(ARRAY['grpc_service','http_service','message_queue'])
        AND (${valueMatch})
      LIMIT 10
    `);

    for (const row of rows as unknown as Array<{ slug: string; library_id: string; domain: string | null; entry_type: string | null; summary: string | null; meta_key: string; meta_value: string }>) {
      const linkType = KEY_TO_LINK_TYPE[row.meta_key] ?? row.meta_key;
      results.push({
        link_type: linkType,
        direction: 'inbound',
        slug: row.slug,
        library_id: row.library_id,
        domain: row.domain,
        entry_type: row.entry_type,
        summary: row.summary,
        source: 'inferred',
        matched_via: `${row.meta_key}:${row.meta_value}`,
      });
    }
  }

  return results;
}
