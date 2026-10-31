export interface TopologyNode {
  slug: string;
  summary: string | null;
  entryType: string | null;
  domain: string | null;
  category: string | null;
  libraryId: string;
}

export interface TopologyEdge {
  fromSlug: string;
  toSlug: string;
  linkType: string;
  source: string;
  confidence: number | null;
}

export interface ServiceTopology {
  service: string;
  libraryId: string;
  versionId: string;
  documents: TopologyNode[];
  links: TopologyEdge[];
}

/** A document row as the topology reads it. */
export interface TopologyDoc {
  id: string;
  slug: string;
  summary: string | null;
  entry_type: string | null;
  domain: string | null;
  category: string | null;
}

/** An outgoing link row as the topology reads it. */
export interface TopologyLink {
  from_document_id: string;
  to_slug: string;
  to_library_id: string | null;
  link_type: string;
  source: string;
  confidence: number | null;
}

/** Distinct same-library link targets that are not already service documents. */
export function linkedSlugsToFetch(outLinks: TopologyLink[], serviceSlugs: Set<string>, libraryId: string): string[] {
  return [...new Set(
    outLinks
      .filter((l) => l.to_library_id === null || l.to_library_id === libraryId)
      .map((l) => l.to_slug),
  )].filter((s) => !serviceSlugs.has(s));
}

/**
 * The service graph: every service document, plus the 1-hop linked documents that have an
 * edge; edges only between documents of the graph.
 */
export function assembleTopology(
  service: string,
  libraryId: string,
  versionId: string,
  serviceDocs: TopologyDoc[],
  outLinks: TopologyLink[],
  linkedDocs: TopologyDoc[],
): ServiceTopology {
  const allDocById = new Map([
    ...serviceDocs.map((d) => [d.id, d] as const),
    ...linkedDocs.map((d) => [d.id, d] as const),
  ]);
  const allDocBySlug = new Map([
    ...serviceDocs.map((d) => [d.slug, d] as const),
    ...linkedDocs.map((d) => [d.slug, d] as const),
  ]);

  const edges: TopologyEdge[] = [];
  for (const link of outLinks) {
    const fromDoc = allDocById.get(link.from_document_id);
    if (!fromDoc) continue;
    // Only include edge if target is in our graph: a document of this library with that slug
    if (link.to_library_id !== null && link.to_library_id !== libraryId) continue;
    if (!allDocBySlug.has(link.to_slug)) continue;
    edges.push({
      fromSlug: fromDoc.slug,
      toSlug: link.to_slug,
      linkType: link.link_type,
      source: link.source,
      confidence: link.confidence,
    });
  }

  const toNode = (d: TopologyDoc): TopologyNode => ({
    slug: d.slug,
    summary: d.summary,
    entryType: d.entry_type,
    domain: d.domain,
    category: d.category,
    libraryId,
  });
  // Nodes: all service docs + linked docs that have actual edges
  const nodesInEdges = new Set([...edges.map((e) => e.fromSlug), ...edges.map((e) => e.toSlug)]);
  return {
    service,
    libraryId,
    versionId,
    documents: [...serviceDocs.map(toNode), ...linkedDocs.filter((d) => nodesInEdges.has(d.slug)).map(toNode)],
    links: edges,
  };
}
