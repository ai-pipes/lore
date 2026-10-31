import { assembleTopology, linkedSlugsToFetch, type ServiceTopology, type TopologyDoc } from '../domain/topology.js';
import type { CatalogDeps } from './ports.js';

/**
 * The documents of a service (domain or project_name) in a version (default: the current one)
 * and their 1-hop links inside the library.
 */
export async function getTopology(
  d: CatalogDeps,
  libraryId: string,
  service: string,
  versionId?: string,
): Promise<ServiceTopology> {
  let resolvedVersionId = versionId;
  if (!resolvedVersionId) {
    const current = await d.versions.current(libraryId);
    if (!current) throw new Error(`No current version for library ${libraryId}`);
    resolvedVersionId = current.id;
  }

  const serviceDocs = await d.topology.serviceDocs(libraryId, resolvedVersionId, service);
  if (serviceDocs.length === 0) {
    return { service, libraryId, versionId: resolvedVersionId, documents: [], links: [] };
  }

  const outLinks = await d.topology.outLinks(serviceDocs.map((doc) => doc.id));
  const linkedSlugs = linkedSlugsToFetch(outLinks, new Set(serviceDocs.map((doc) => doc.slug)), libraryId);
  let linkedDocs: TopologyDoc[] = [];
  if (linkedSlugs.length > 0) {
    linkedDocs = await d.topology.docsBySlugs(libraryId, resolvedVersionId, linkedSlugs);
  }
  return assembleTopology(service, libraryId, resolvedVersionId, serviceDocs, outLinks, linkedDocs);
}
