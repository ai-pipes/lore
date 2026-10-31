import { and, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { TopologyDoc, TopologyLink } from '../domain/topology.js';
import type { TopologyReader } from '../application/ports.js';
import { documents, document_links } from './schema.js';

const topologyColumns = {
  id: documents.id,
  slug: documents.slug,
  summary: documents.summary,
  entry_type: documents.entry_type,
  domain: documents.domain,
  category: documents.category,
};

/** The documents of a service (domain OR project_name match) in one version. */
export async function topologyServiceDocs(libraryId: string, versionId: string, service: string): Promise<TopologyDoc[]> {
  return getDb()
    .select(topologyColumns)
    .from(documents)
    .where(
      and(
        eq(documents.library_id, libraryId),
        eq(documents.version_id, versionId),
        or(eq(documents.domain, service), eq(documents.project_name, service)),
      ),
    );
}

/** Outgoing links of the given documents (1 hop). */
export async function topologyOutLinks(documentIds: string[]): Promise<TopologyLink[]> {
  return getDb()
    .select({
      from_document_id: document_links.from_document_id,
      to_slug: document_links.to_slug,
      to_library_id: document_links.to_library_id,
      link_type: document_links.link_type,
      source: document_links.source,
      confidence: document_links.confidence,
    })
    .from(document_links)
    .where(inArray(document_links.from_document_id, documentIds));
}

/** The documents with the given slugs in one version. */
export async function topologyDocsBySlugs(libraryId: string, versionId: string, slugs: string[]): Promise<TopologyDoc[]> {
  return getDb()
    .select(topologyColumns)
    .from(documents)
    .where(
      and(
        eq(documents.library_id, libraryId),
        eq(documents.version_id, versionId),
        inArray(documents.slug, slugs),
      ),
    );
}

export const pgTopologyReader: TopologyReader = {
  serviceDocs: topologyServiceDocs,
  outLinks: topologyOutLinks,
  docsBySlugs: topologyDocsBySlugs,
};
