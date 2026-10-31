/** In-memory catalog ports for application tests (no DB). */
import type { CatalogDeps } from '../../src/modules/catalog/application/ports.js';
import { storageOwnerKey, type Library } from '../../src/modules/catalog/domain/library.js';
import type { Namespace, ProjectKeyRecord } from '../../src/modules/catalog/domain/namespace.js';
import type { Version } from '../../src/modules/catalog/domain/version.js';
import {
  DocumentExistsError,
  type Document,
  type DocumentInput,
  type LinkSnapshot,
  type VersionFilter,
} from '../../src/modules/catalog/domain/document.js';

export interface StoredLink extends LinkSnapshot {
  confidence: number | null;
}

export interface StoredImage {
  library_id: string;
  version_id: string;
  slug: string;
  filename: string;
  file_size: number;
  image_hash: string;
  mime_type: string;
}

export interface FakeCatalogState {
  libraries: Map<string, Library>;
  /** Starts with the reserved `default` and `insights` namespaces, like the migration. */
  namespaces: Map<string, Namespace>;
  /** Stored project keys with their hashes. */
  projectKeys: (ProjectKeyRecord & { hash: string })[];
  /** What the fake clock returns. */
  now: Date;
  versions: Version[];
  documents: Document[];
  /** Outgoing links by document id. */
  links: Map<string, StoredLink[]>;
  images: StoredImage[];
  /** Saved blobs by path. */
  blobs: Map<string, Uint8Array>;
  deletedBlobs: string[];
  /** What the fake embedder does: `null` = no provider configured. */
  embedding: { vector: number[]; minScore?: number; fail?: boolean } | null;
  /** What the fake link suggester returns: `null` = no LLM configured. */
  suggestions: unknown[] | null;
  suggestCalls: { slug: string; knownSlugs: string[] }[];
  /** Stored vectors by document id (the fake vector index). */
  vectors: Map<string, { model: string; embedding: number[] }>;
  /** Calls recorded by the fake search port. */
  searchCalls: { method: string; args: unknown[] }[];
}

const toDocument = (id: string, input: DocumentInput): Document => ({
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
  content_hash: `hash:${input.slug}:${input.content}`,
  category: input.category ?? null,
  author_user_id: input.author_user_id ?? null,
  author_name: input.author_name ?? null,
});

export function createFakeCatalog(): { deps: CatalogDeps; state: FakeCatalogState } {
  const state: FakeCatalogState = {
    libraries: new Map(),
    namespaces: new Map([
      ['default', { id: 'default', display_name: 'Default', system: false, created_at: '2026-01-01T00:00:00.000Z' }],
      ['insights', { id: 'insights', display_name: 'Insights', system: true, created_at: '2026-01-01T00:00:00.000Z' }],
    ]),
    projectKeys: [],
    now: new Date(Date.UTC(2026, 0, 1)),
    versions: [],
    documents: [],
    links: new Map(),
    images: [],
    blobs: new Map(),
    deletedBlobs: [],
    embedding: null,
    vectors: new Map(),
    suggestions: null,
    suggestCalls: [],
    searchCalls: [],
  };
  let docSeq = 0;
  const isStale = (id: string, modelId: string, all: boolean) => all || state.vectors.get(id)?.model !== modelId;
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString();

  const inFilter = (d: Document, filter: VersionFilter = {}) => {
    const v = state.versions.find((x) => x.id === d.version_id && x.library_id === d.library_id);
    if (!v) return false;
    if (filter.version_id) return v.id === filter.version_id;
    if (filter.branch) return v.branch === filter.branch;
    return v.is_current;
  };

  const upsertDoc = (input: DocumentInput): Document => {
    const i = state.documents.findIndex(
      (d) => d.library_id === input.library_id && d.version_id === input.version_id && d.slug === input.slug,
    );
    const doc = toDocument(i >= 0 ? state.documents[i].id : `doc-${++docSeq}`, input);
    if (i >= 0) state.documents[i] = doc;
    else state.documents.push(doc);
    {
      // Like the Postgres adapter: the upload's manual links replace the stored ones (missing = none).
      const auto = (state.links.get(doc.id) ?? []).filter((l) => l.source === 'auto');
      const manual = (input.links ?? []).map((l) => ({
        toSlug: l.slug,
        toLibraryId: l.library ?? null,
        linkType: l.type,
        source: 'manual',
        confidence: null,
      }));
      state.links.set(doc.id, [...manual, ...auto]);
    }
    return { ...doc };
  };

  const record = (method: string, args: unknown[]) => state.searchCalls.push({ method, args });

  const deps: CatalogDeps = {
    libraries: {
      async upsert(id, displayName, namespaceId) {
        const existing = state.libraries.get(id);
        const library = {
          id,
          display_name: displayName,
          namespace_id: existing?.namespace_id ?? namespaceId ?? 'default',
          created_at: existing?.created_at ?? tick(),
        };
        state.libraries.set(id, library);
        return { ...library };
      },
      async upsertInNamespace(id, displayName, namespaceId) {
        const existing = state.libraries.get(id);
        if (existing && existing.namespace_id !== namespaceId) return null;
        const library = { id, display_name: displayName, namespace_id: namespaceId, created_at: existing?.created_at ?? tick() };
        state.libraries.set(id, library);
        return { library: { ...library }, created: !existing };
      },
      async get(id) {
        const l = state.libraries.get(id);
        return l && { ...l };
      },
      async caseVariantOf(id) {
        return [...state.libraries.keys()].find((k) => k !== id && storageOwnerKey(k) === storageOwnerKey(id));
      },
      async setNamespace(id, namespaceId) {
        const l = state.libraries.get(id);
        if (!l) return false;
        l.namespace_id = namespaceId;
        return true;
      },
      async list(namespaceId) {
        return [...state.libraries.values()].filter((l) => namespaceId === undefined || l.namespace_id === namespaceId).map((l) => ({
          ...l,
          current_version: state.versions.find((v) => v.library_id === l.id && v.is_current)?.id ?? null,
          document_count: 0,
        }));
      },
    },
    versions: {
      async create(id, libraryId, branch) {
        let v = state.versions.find((x) => x.id === id && x.library_id === libraryId);
        if (!v) {
          v = { id, library_id: libraryId, branch: branch ?? null, is_current: false, pushed_at: tick() };
          state.versions.unshift(v); // newest first, like ORDER BY pushed_at DESC
        } else if (branch !== undefined && v.branch !== branch) {
          // Moves to the new branch as its newest version
          v.branch = branch;
          v.pushed_at = tick();
          state.versions.splice(state.versions.indexOf(v), 1);
          state.versions.unshift(v);
        }
        return { ...v };
      },
      async promote(libraryId, id) {
        if (!state.versions.some((v) => v.library_id === libraryId && v.id === id)) return false;
        for (const v of state.versions) if (v.library_id === libraryId) v.is_current = v.id === id;
        return true;
      },
      async current(libraryId) {
        const v = state.versions.find((x) => x.library_id === libraryId && x.is_current);
        return v && { ...v };
      },
      async list(libraryId) {
        return state.versions.filter((v) => v.library_id === libraryId).map((v) => ({ ...v }));
      },
      async delete(libraryId, id) {
        const i = state.versions.findIndex((v) => v.id === id && v.library_id === libraryId);
        if (i < 0) return 'not_found';
        if (state.versions[i].is_current) return 'is_current';
        state.versions.splice(i, 1);
        state.documents = state.documents.filter((d) => !(d.library_id === libraryId && d.version_id === id));
        const removed = state.images.filter((img) => img.library_id === libraryId && img.version_id === id);
        state.images = state.images.filter((img) => !removed.includes(img));
        return { imageHashes: [...new Set(removed.map((img) => img.image_hash))] };
      },
    },
    documents: {
      async insert(input, opts = {}) {
        const exists = state.documents.some(
          (d) => d.library_id === input.library_id && d.version_id === input.version_id && d.slug === input.slug,
        );
        if (exists && opts.onConflict === 'error') {
          throw new DocumentExistsError(input.library_id, input.version_id, input.slug);
        }
        return upsertDoc(input);
      },
      async insertBatch(inputs) {
        return inputs.map(upsertDoc);
      },
      async delete(libraryId, versionId, slug) {
        const i = state.documents.findIndex(
          (d) => d.library_id === libraryId && d.version_id === versionId && d.slug === slug,
        );
        if (i < 0) return false;
        state.links.delete(state.documents[i].id);
        state.documents.splice(i, 1);
        return true;
      },
      async list(opts) {
        return state.documents
          .filter((d) => d.library_id === opts.library_id && inFilter(d, opts))
          .filter((d) => !opts.domain || d.domain === opts.domain)
          .filter((d) => !opts.entry_type || d.entry_type === opts.entry_type)
          .filter((d) => !opts.category || d.category === opts.category)
          .slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100))
          .map((d) => ({ ...d }));
      },
      async bySlug(libraryId, slug, filter = {}) {
        const d = state.documents.find((x) => x.library_id === libraryId && x.slug === slug && inFilter(x, filter));
        return d && { ...d };
      },
      async byIds(ids) {
        return state.documents.filter((d) => ids.includes(d.id)).map((d) => ({ ...d }));
      },
      async hashes(libraryId, versionId) {
        return state.documents
          .filter((d) => d.library_id === libraryId && d.version_id === versionId)
          .map((d) => ({ slug: d.slug, content_hash: d.content_hash }));
      },
      async cloneVersion(libraryId, fromVersionId, toVersionId) {
        const source = state.documents.filter((d) => d.library_id === libraryId && d.version_id === fromVersionId);
        const missing = source.filter(
          (s) => !state.documents.some((d) => d.library_id === libraryId && d.version_id === toVersionId && d.slug === s.slug),
        );
        for (const s of missing) {
          const copy = { ...s, id: `doc-${++docSeq}`, version_id: toVersionId };
          state.documents.push(copy);
          state.links.set(copy.id, (state.links.get(s.id) ?? []).map((l) => ({ ...l })));
        }
        return missing.length;
      },
      async existingCurrent(refs) {
        const found = new Set<string>();
        for (const r of refs) {
          if (state.documents.some((d) => d.library_id === r.library && d.slug === r.slug && inFilter(d))) {
            found.add(`${r.library}/${r.slug}`);
          }
        }
        return found;
      },
      async replaceAutoLinks(documentId, links) {
        const manual = (state.links.get(documentId) ?? []).filter((l) => l.source !== 'auto');
        const auto = links.map((l) => ({
          toSlug: l.toSlug,
          toLibraryId: null,
          linkType: l.linkType,
          source: 'auto',
          confidence: l.confidence,
        }));
        state.links.set(documentId, [...manual, ...auto]);
      },
      async inVersion(libraryId, slug, versionId) {
        const d = state.documents.find((x) => x.library_id === libraryId && x.slug === slug && x.version_id === versionId);
        return d ? { ...d } : null;
      },
      async linksOf(documentId) {
        return (state.links.get(documentId) ?? []).map(({ toSlug, toLibraryId, linkType, source }) => ({
          toSlug,
          toLibraryId,
          linkType,
          source,
        }));
      },
    },
    images: {
      async upsert(library_id, version_id, slug, filename, file_size, image_hash, mime_type, storeBlob) {
        if (storeBlob) await storeBlob();
        const i = state.images.findIndex(
          (x) => x.library_id === library_id && x.version_id === version_id && x.slug === slug && x.filename === filename,
        );
        const img = { library_id, version_id, slug, filename, file_size, image_hash, mime_type };
        if (i >= 0) state.images[i] = img;
        else state.images.push(img);
      },
      async list(libraryId, versionId, slug) {
        return state.images
          .filter((x) => x.library_id === libraryId && x.version_id === versionId && x.slug === slug)
          .map((x) => ({ filename: x.filename, file_size: x.file_size, image_hash: x.image_hash, mime_type: x.mime_type, created_at: null }));
      },
      async get(libraryId, versionId, slug, filename) {
        const x = state.images.find(
          (i) => i.library_id === libraryId && i.version_id === versionId && i.slug === slug && i.filename === filename,
        );
        return x && { image_hash: x.image_hash, mime_type: x.mime_type };
      },
      async delete(libraryId, versionId, slug, filename) {
        state.images = state.images.filter(
          (i) => !(i.library_id === libraryId && i.version_id === versionId && i.slug === slug && i.filename === filename),
        );
      },
      async cloneVersion(libraryId, fromVersionId, toVersionId) {
        const source = state.images.filter((i) => i.library_id === libraryId && i.version_id === fromVersionId);
        for (const s of source) {
          const exists = state.images.some(
            (i) => i.library_id === libraryId && i.version_id === toVersionId && i.slug === s.slug && i.filename === s.filename,
          );
          if (!exists) state.images.push({ ...s, version_id: toVersionId });
        }
        return source.length;
      },
      async releaseBlob(libraryId, imageHash, deleteBlob) {
        const owner = storageOwnerKey(libraryId);
        if (state.images.some((i) => storageOwnerKey(i.library_id) === owner && i.image_hash === imageHash)) return false;
        await deleteBlob();
        return true;
      },
    },
    blobs: {
      hash: (data) => `sha(${Array.from(data).join(',')})`,
      path: (libraryId, imageHash) => `/blobs/${libraryId}/${imageHash}`,
      async save(libraryId, imageHash, data) {
        state.blobs.set(`/blobs/${libraryId}/${imageHash}`, data);
      },
      async delete(path) {
        if (!state.blobs.delete(path)) throw new Error('ENOENT');
        state.deletedBlobs.push(path);
      },
    },
    vectors: {
      async countStale(modelId, o) {
        return state.documents.filter((d) => isStale(d.id, modelId, o.all)).length;
      },
      async staleAfter(modelId, o) {
        return state.documents
          .filter((d) => isStale(d.id, modelId, o.all) && (o.afterId === null || d.id > o.afterId))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, o.limit)
          .map((d) => ({
            document_id: d.id,
            library_id: d.library_id,
            version_id: d.version_id,
            summary: d.summary,
            content: d.content,
          }));
      },
      async save(modelId, rows) {
        for (const r of rows) state.vectors.set(r.document_id, { model: modelId, embedding: r.embedding });
      },
    },
    embedder: {
      available: () => state.embedding !== null,
      minScore: () => state.embedding?.minScore,
      modelId: () => (state.embedding ? 'fake:1' : null),
      async embed() {
        if (!state.embedding) throw new Error('no embedding provider');
        if (state.embedding.fail) throw new Error('embedding failed');
        return [...state.embedding.vector];
      },
      async embedBatch(texts) {
        if (!state.embedding) throw new Error('no embedding provider');
        if (state.embedding.fail) throw new Error('embedding failed');
        return texts.map(() => [...state.embedding!.vector]);
      },
    },
    links: {
      enabled: () => state.suggestions !== null,
      async suggest(doc, knownSlugs) {
        state.suggestCalls.push({ slug: doc.slug, knownSlugs });
        return state.suggestions ?? [];
      },
    },
    search: {
      async fullText(...args) {
        record('fullText', args);
        return [];
      },
      async vector(...args) {
        record('vector', args);
        return [];
      },
      async byMetadata(...args) {
        record('byMetadata', args);
        return [];
      },
      async overview(...args) {
        record('overview', args);
        return [];
      },
      async categories(...args) {
        record('categories', args);
        return [];
      },
      async services(...args) {
        record('services', args);
        return [];
      },
      async linksFrom(...args) {
        record('linksFrom', args);
        return [];
      },
      async related(...args) {
        record('related', args);
        return [];
      },
      async inferRelated(...args) {
        record('inferRelated', args);
        return [];
      },
    },
    topology: {
      async serviceDocs(libraryId, versionId, service) {
        return state.documents
          .filter((d) => d.library_id === libraryId && d.version_id === versionId)
          .filter((d) => d.domain === service || d.project_name === service)
          .map(({ id, slug, summary, entry_type, domain, category }) => ({ id, slug, summary, entry_type, domain, category }));
      },
      async outLinks(documentIds) {
        return documentIds.flatMap((id) =>
          (state.links.get(id) ?? []).map((l) => ({
            from_document_id: id,
            to_slug: l.toSlug,
            to_library_id: l.toLibraryId,
            link_type: l.linkType,
            source: l.source,
            confidence: l.confidence,
          })),
        );
      },
      async docsBySlugs(libraryId, versionId, slugs) {
        return state.documents
          .filter((d) => d.library_id === libraryId && d.version_id === versionId && slugs.includes(d.slug))
          .map(({ id, slug, summary, entry_type, domain, category }) => ({ id, slug, summary, entry_type, domain, category }));
      },
    },
    namespaces: {
      async insert({ id, displayName }) {
        if (state.namespaces.has(id)) return null;
        const ns = { id, display_name: displayName, system: false, created_at: tick() };
        state.namespaces.set(id, ns);
        return { ...ns };
      },
      async get(id) {
        const ns = state.namespaces.get(id);
        return ns && { ...ns };
      },
      async rename(id, displayName) {
        const ns = state.namespaces.get(id);
        if (!ns) return undefined;
        ns.display_name = displayName;
        return { ...ns };
      },
      async list() {
        return [...state.namespaces.values()].map((ns) => ({ ...ns }));
      },
    },
    projectKeys: {
      async insert(input) {
        const rec = { ...input, id: `key-${state.projectKeys.length + 1}`, createdAt: state.now, lastUsedAt: null, revokedAt: null };
        state.projectKeys.push(rec);
        const { hash: _hash, ...stored } = rec;
        return stored;
      },
      async list(namespaceId) {
        return state.projectKeys
          .filter((k) => namespaceId === undefined || k.namespaceId === namespaceId)
          .map(({ hash: _hash, ...stored }) => stored);
      },
      async findByHash(hash) {
        const k = state.projectKeys.find((x) => x.hash === hash);
        if (!k) return undefined;
        const { hash: _hash, ...stored } = k;
        return stored;
      },
      async revoke(id, at) {
        const k = state.projectKeys.find((x) => x.id === id && x.revokedAt === null);
        if (!k) return false;
        k.revokedAt = at;
        return true;
      },
      async touch(id, at) {
        const k = state.projectKeys.find((x) => x.id === id);
        if (k) k.lastUsedAt = at;
      },
    },
    keySecrets: {
      random: (prefix) => `${prefix}secret-${state.projectKeys.length + 1}-0123456789abcdefghij`,
      sha256Hex: (s) => `sha256(${s})`,
    },
    clock: { now: () => state.now },
    reservedLibraryIds: new Set<string>(),
  };
  return { deps, state };
}
