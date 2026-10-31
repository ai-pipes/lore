import { createHash } from 'crypto';
import { lstatSync, readFileSync, readdirSync, type Stats } from 'fs';
import { join, extname, basename, relative } from 'path';
import matter from 'gray-matter';
import type {
  BulkDocumentItem,
  BulkDocumentLink,
  CloneResponse,
  CreateLibraryRequest,
  CreateVersionRequest,
  DocumentHashItem,
  ImageListItem,
  VersionResponse,
} from '../contracts/catalog.js';
import { ApiError, apiRequest } from './client.js';

interface PushOptions {
  dir: string;
  library: string;
  version: string;
  branch?: string;
  promote?: boolean;
  incremental?: boolean;
  baseUrl: string;
  /** A personal `sk_` token, a project key `lpk_` or the admin key. */
  token: string;
  /** Namespace of a library this push creates (admins; a project key creates only in its own). */
  namespace?: string;
  noEnrich?: boolean;
}

interface ParsedDoc {
  filePath: string;
  slug: string;
  hash: string;
  raw: string;
  data: Record<string, unknown>;
  content: string;
  /** The frontmatter links exactly as the server keeps them. */
  links: BulkDocumentLink[];
}

async function apiPost<T = unknown>(baseUrl: string, path: string, body: unknown, token: string): Promise<T> {
  return apiRequest<T>(baseUrl, path, { method: 'POST', token: token, json: body });
}

async function apiDelete(baseUrl: string, path: string, token: string): Promise<void> {
  await apiRequest(baseUrl, path, { method: 'DELETE', token: token });
}

async function apiGet<T = unknown>(baseUrl: string, path: string, token: string): Promise<T> {
  return apiRequest<T>(baseUrl, path, { token: token });
}

async function uploadBulk(
  baseUrl: string,
  library: string,
  version: string,
  token: string,
  docs: ParsedDoc[],
  noEnrich?: boolean,
): Promise<void> {
  const body = docs.map((doc) => {
    const entry: Record<string, unknown> = { slug: doc.slug, content: doc.content.trim() };
    if (doc.data.domain) entry.domain = doc.data.domain;
    if (doc.data.project_name) entry.project_name = doc.data.project_name;
    if (doc.data.entry_type) entry.entry_type = doc.data.entry_type;
    if (doc.data.summary) entry.summary = doc.data.summary;
    if (doc.data.handler_class) entry.handler_class = doc.data.handler_class;
    if (doc.data.http_method) entry.http_method = doc.data.http_method;
    if (doc.data.route) entry.route = doc.data.route;
    if (doc.data.generated_at) entry.generated_at = doc.data.generated_at;
    if (doc.data.category) entry.category = doc.data.category;
    // Always sent, even empty: the server replaces the document's manual links with exactly these.
    entry.links = doc.links;
    return entry as unknown as BulkDocumentItem;
  });

  const path = `/api/libraries/${library}/versions/${version}/documents/bulk${noEnrich ? '?noEnrich=true' : ''}`;
  try {
    await apiRequest(baseUrl, path, { method: 'POST', token: token, json: body });
  } catch (e) {
    if (e instanceof ApiError) throw new Error(`Bulk upload failed ${e.status}: ${e.body}`, { cause: e });
    throw e;
  }
}

/**
 * `lstat` of a path under the docs directory, or undefined (with a warning) for a symbolic link.
 * Links are never followed: one could point anywhere (`/proc/self/environ`, a credentials file)
 * and publish it as a document, or loop.
 */
function lstatNoLink(path: string): Stats | undefined {
  const stat = lstatSync(path);
  if (!stat.isSymbolicLink()) return stat;
  console.warn(`Skipping symbolic link ${path}`);
  return undefined;
}

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = lstatNoLink(full);
    if (stat?.isDirectory()) {
      files.push(...collectMarkdownFiles(full));
    } else if (stat?.isFile() && extname(entry) === '.md') {
      files.push(full);
    }
  }
  return files;
}

/**
 * The frontmatter links the server keeps (the bulk route drops entries without a string slug),
 * in the form it stores them. Sent as is and hashed as is, so the local hash matches the server's.
 */
function docLinks(data: Record<string, unknown>): BulkDocumentLink[] {
  if (!Array.isArray(data.links)) return [];
  return (data.links as unknown[])
    .filter((l): l is Record<string, unknown> => l !== null && typeof l === 'object' && typeof (l as { slug?: unknown }).slug === 'string' && (l as { slug: string }).slug !== '')
    .map((l) => ({
      slug: l.slug as string,
      ...(l.library ? { library: String(l.library) } : {}),
      type: String(l.type ?? 'references'),
    }));
}

/** Same hash logic as computeDocHash on the server — must stay in sync */
function hashDoc(slug: string, data: Record<string, unknown>, links: BulkDocumentLink[], content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const linksStr = links
    .map((l) => `${l.slug}|${l.library ?? ''}|${l.type ?? 'references'}`)
    .sort()
    .join(',');
  const parts = [
    slug,
    String(data.domain ?? ''),
    String(data.project_name ?? ''),
    String(data.entry_type ?? ''),
    String(data.handler_class ?? ''),
    String(data.category ?? ''),
    String(data.http_method ?? ''),
    String(data.route ?? ''),
    String(data.summary ?? ''),
    normalized,
    linksStr,
  ];
  return createHash('sha256').update(parts.join('\x00')).digest('hex');
}

/** A parsed document, or null when its frontmatter has no slug (required: see docs/usage.md). */
function parseDoc(filePath: string): ParsedDoc | null {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const content = parsed.content;
  if (typeof data.slug !== 'string' || data.slug.trim() === '') return null;
  const slug = data.slug;
  const links = docLinks(data);
  const hash = hashDoc(slug, data, links, content);
  return { filePath, slug, hash, raw, data, content, links };
}

/** Every document under `dir`; throws, naming the files, when any lacks a frontmatter slug. */
function readDocs(dir: string): ParsedDoc[] {
  const docs: ParsedDoc[] = [];
  const missing: string[] = [];
  for (const file of collectMarkdownFiles(dir)) {
    const doc = parseDoc(file);
    if (doc) docs.push(doc);
    else missing.push(relative(dir, file));
  }
  if (missing.length > 0) {
    throw new Error(`Every document needs a string \`slug\` in its frontmatter; missing in: ${missing.join(', ')}`);
  }
  return docs;
}

interface LocalImage {
  filePath: string;
  filename: string;
  hash: string;
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function collectImageFiles(dir: string): string[] {
  let stat: Stats | undefined;
  try {
    stat = lstatNoLink(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  if (!stat?.isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => extname(f).toLowerCase() in IMAGE_TYPES)
    .map((f) => join(dir, f))
    .filter((p) => lstatNoLink(p)?.isFile() === true);
}

function hashFile(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/** Collect images for all local docs: slug → LocalImage[] */
function collectLocalImages(dir: string, docs: ParsedDoc[]): Map<string, LocalImage[]> {
  const result = new Map<string, LocalImage[]>();
  for (const doc of docs) {
    const mdPath = doc.filePath;
    // Images live in a directory with the same name as the .md file (without extension)
    const imgDir = mdPath.slice(0, -3); // strip '.md'
    const imagePaths = collectImageFiles(imgDir);
    if (imagePaths.length > 0) {
      result.set(doc.slug, imagePaths.map((p) => ({
        filePath: p,
        filename: basename(p),
        hash: hashFile(p),
      })));
    }
  }
  return result;
}

async function syncImages(
  baseUrl: string,
  library: string,
  version: string,
  token: string,
  localImageMap: Map<string, LocalImage[]>,
): Promise<void> {
  let uploaded = 0;
  let skipped = 0;
  let deleted = 0;

  for (const [slug, localImages] of localImageMap) {
    // Fetch remote images for this slug+version
    const remoteImages = await apiGet<ImageListItem[]>(
      baseUrl,
      `/api/libraries/${library}/versions/${version}/images?slug=${encodeURIComponent(slug)}`,
      token,
    ).catch((e: unknown) => {
      if (e instanceof ApiError) return [] as ImageListItem[];
      throw e;
    });
    const remoteMap = new Map(remoteImages.map((r) => [r.filename, r.image_hash]));
    const localFilenames = new Set(localImages.map((i) => i.filename));

    // Upload new or changed images
    for (const img of localImages) {
      const remoteHash = remoteMap.get(img.filename);
      if (remoteHash === img.hash) {
        skipped++;
        continue;
      }
      const fileBuffer = readFileSync(img.filePath);
      const formData = new FormData();
      formData.append('slug', slug);
      formData.append('filename', img.filename);
      formData.append('image', new Blob([fileBuffer], { type: IMAGE_TYPES[extname(img.filename).toLowerCase()] }), img.filename);

      try {
        await apiRequest(baseUrl, `/api/libraries/${library}/versions/${version}/images`, {
          method: 'POST',
          token: token,
          form: formData,
        });
      } catch (e) {
        if (e instanceof ApiError) throw new Error(`Image upload failed for ${slug}/${img.filename}: ${e.body}`, { cause: e });
        throw e;
      }
      uploaded++;
    }

    // Delete remote images no longer present locally
    for (const remoteFilename of remoteMap.keys()) {
      if (!localFilenames.has(remoteFilename)) {
        // Best effort, as before: a failed delete does not fail the push.
        await apiDelete(
          baseUrl,
          `/api/libraries/${library}/versions/${version}/images/${slug}/${remoteFilename}`,
          token,
        ).catch((e: unknown) => {
          if (!(e instanceof ApiError)) throw e;
        });
        deleted++;
      }
    }
  }

  if (uploaded > 0 || deleted > 0) {
    const parts = [];
    if (uploaded > 0) parts.push(`${uploaded} uploaded`);
    if (skipped > 0) parts.push(`${skipped} unchanged`);
    if (deleted > 0) parts.push(`${deleted} deleted`);
    console.log(`Images: ${parts.join(', ')}`);
  }
}

export async function push(opts: PushOptions): Promise<void> {
  const { dir, library, version, branch, promote = true, incremental = true, baseUrl, token, namespace, noEnrich } = opts;

  // Read and check every document before anything is created on the server.
  const localDocs = readDocs(dir);
  const localSlugs = new Set(localDocs.map((d) => d.slug));

  let exists = true;
  try {
    await apiGet(baseUrl, `/api/libraries/${encodeURIComponent(library)}`, token);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 404) throw new Error(`GET ${baseUrl}/api/libraries/${library} failed ${e.status}: ${e.body}`, { cause: e });
    exists = false;
  }
  if (!exists) {
    // Creating a library needs an admin or a project key of the namespace.
    console.log(`Registering library: ${library}${namespace ? ` (namespace: ${namespace})` : ''}`);
    const create: CreateLibraryRequest = { id: library, display_name: library, ...(namespace ? { namespace_id: namespace } : {}) };
    await apiPost(baseUrl, '/api/libraries', create, token);
  }

  console.log(`Creating version: ${version}${branch ? ` (branch: ${branch})` : ''}`);
  // An empty --branch (an unset GIT_BRANCH, say) means no branch.
  const createVersion: CreateVersionRequest = { id: version, ...(branch ? { branch } : {}) };
  await apiPost(baseUrl, `/api/libraries/${library}/versions`, createVersion, token);

  const start = Date.now();
  let toUpload = localDocs;
  let unchangedCount = 0;
  const orphanSlugs: string[] = [];

  if (incremental) {
    type VersionItem = Pick<VersionResponse, 'id' | 'is_current'>;
    const versions = await apiGet<VersionItem[]>(
      baseUrl,
      `/api/libraries/${library}/versions`,
      token,
    ).catch(() => [] as unknown as VersionItem[]);
    const current = Array.isArray(versions) ? versions.find((v) => v.is_current === true) : undefined;
    const hashesOf = (versionId: string) =>
      apiGet<DocumentHashItem[]>(
        baseUrl,
        `/api/libraries/${library}/versions/${encodeURIComponent(versionId)}/document-hashes`,
        token,
      );

    // Pushing a version that already holds documents (the same commit again) diffs against that
    // version itself; a new version starts as a clone of the current one and diffs against it.
    let remoteDocs = await hashesOf(version);
    if (remoteDocs.length === 0 && current && current.id !== version) {
      process.stdout.write(`Cloning from ${current.id}...`);
      const cloneResult = await apiPost<CloneResponse>(
        baseUrl,
        `/api/libraries/${library}/versions/${version}/clone-from/${current.id}`,
        {},
        token,
      );
      console.log(` ${cloneResult.cloned} docs cloned`);
      // Every remote doc of the current version (unpaginated) for the diff
      remoteDocs = await hashesOf(current.id);
    }
    const remoteHashes = new Map(remoteDocs.map((d) => [d.slug, d.content_hash]));

    // Docs that are in remote but not in local → deleted by developer
    for (const remoteSlug of remoteHashes.keys()) {
      if (!localSlugs.has(remoteSlug)) {
        orphanSlugs.push(remoteSlug);
      }
    }

    // Only upload docs whose hash differs or that are new
    toUpload = localDocs.filter((d) => remoteHashes.get(d.slug) !== d.hash);
    unchangedCount = localDocs.length - toUpload.length;
  }

  if (toUpload.length === 0) {
    console.log('Nothing changed.');
  } else {
    console.log(`Uploading ${toUpload.length} documents${unchangedCount > 0 ? ` (${unchangedCount} unchanged)` : ''}...`);
    const BULK_SIZE = 100;
    let uploaded = 0;
    for (let i = 0; i < toUpload.length; i += BULK_SIZE) {
      const batch = toUpload.slice(i, i + BULK_SIZE);
      await uploadBulk(baseUrl, library, version, token, batch, noEnrich);
      uploaded += batch.length;
      process.stdout.write(`\r  ${uploaded}/${toUpload.length}`);
    }
    process.stdout.write('\n');
  }

  // Remove docs that no longer exist locally
  if (orphanSlugs.length > 0) {
    console.log(`Removing ${orphanSlugs.length} deleted document(s)...`);
    await Promise.all(
      orphanSlugs.map((slug) =>
        apiDelete(
          baseUrl,
          `/api/libraries/${library}/versions/${version}/documents/${encodeURIComponent(slug)}`,
          token,
        ),
      ),
    );
    console.log(`  removed: ${orphanSlugs.join(', ')}`);
  }

  const localImageMap = collectLocalImages(dir, localDocs);
  if (localImageMap.size > 0) {
    await syncImages(baseUrl, library, version, token, localImageMap);
  }

  if (promote) {
    console.log(`Promoting version: ${version}`);
    await apiPost(
      baseUrl,
      `/api/libraries/${library}/versions/${version}/promote`,
      {},
      token,
    );
  } else {
    console.log(`Skipping promote (--no-promote). Query with --branch ${branch ?? version}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const newCount = localDocs.length - unchangedCount;
  const deletedCount = orphanSlugs.length;
  const parts = [`${unchangedCount} unchanged`, `${newCount} updated/new`];
  if (deletedCount > 0) parts.push(`${deletedCount} deleted`);
  console.log(`Done in ${elapsed}s: ${parts.join(', ')}`);
}
