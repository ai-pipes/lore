import { createPatch } from 'diff';
import type { Document, LinkSnapshot } from '../domain/document.js';
import type { CatalogDeps } from './ports.js';

export type { LinkSnapshot };

export interface MetadataChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface LinkChanges {
  added: LinkSnapshot[];
  removed: LinkSnapshot[];
}

export interface DocumentDiff {
  slug: string;
  libraryId: string;
  fromVersion: string;
  toVersion: string;
  contentDiff: string; // unified diff, or empty string if unchanged or not computed
  /** Set when the content diff was not computed because it is too large; the rest of the diff is still valid. */
  contentDiffError: string | null;
  metadataChanges: MetadataChange[];
  linkChanges: LinkChanges;
  fromExists: boolean;
  toExists: boolean;
}

const METADATA_FIELDS = ['domain', 'project_name', 'entry_type', 'handler_class',
                         'http_method', 'route', 'summary', 'category'] as const;

/** Combined size of both contents above which no content diff is attempted. */
export const MAX_DIFF_INPUT_CHARS = 2_000_000;
/** Combined line count of both contents above which no content diff is attempted. */
export const MAX_DIFF_INPUT_LINES = 40_000;
/** Bounds on the diff algorithm itself, so a pathological edit cannot block the event loop. */
const DIFF_MAX_EDIT_LENGTH = 4_000;
const DIFF_TIMEOUT_MS = 500;

export const DIFF_TOO_LARGE_MESSAGE =
  'Content diff too large to compute; compare the two versions of the document directly.';

const lineCount = (s: string) => {
  let n = 1;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++;
  return n;
};

function contentPatch(slug: string, from: string, to: string, fromVersion: string, toVersion: string):
  { contentDiff: string; contentDiffError: string | null } {
  if (from === to) return { contentDiff: '', contentDiffError: null };
  if (from.length + to.length > MAX_DIFF_INPUT_CHARS || lineCount(from) + lineCount(to) > MAX_DIFF_INPUT_LINES) {
    return { contentDiff: '', contentDiffError: DIFF_TOO_LARGE_MESSAGE };
  }
  const patch = createPatch(slug, from, to, fromVersion, toVersion,
    { maxEditLength: DIFF_MAX_EDIT_LENGTH, timeout: DIFF_TIMEOUT_MS });
  return patch === undefined
    ? { contentDiff: '', contentDiffError: DIFF_TOO_LARGE_MESSAGE }
    : { contentDiff: patch, contentDiffError: null };
}

const linkKey = (l: LinkSnapshot) => `${l.toSlug}::${l.toLibraryId ?? ''}::${l.linkType}`;

/** Compares one document between two versions: content, metadata fields and outgoing links. */
export async function diffVersions(
  d: CatalogDeps,
  libraryId: string,
  slug: string,
  fromVersionId: string,
  toVersionId: string,
): Promise<DocumentDiff> {
  const [fromDoc, toDoc] = await Promise.all([
    d.documents.inVersion(libraryId, slug, fromVersionId),
    d.documents.inVersion(libraryId, slug, toVersionId),
  ]);

  const fromContent = fromDoc?.content ?? '';
  const toContent = toDoc?.content ?? '';
  const { contentDiff, contentDiffError } = contentPatch(slug, fromContent, toContent, fromVersionId, toVersionId);

  const metadataChanges: MetadataChange[] = [];
  for (const field of METADATA_FIELDS) {
    const from = fromDoc?.[field] ?? null;
    const to = toDoc?.[field] ?? null;
    if (from !== to) metadataChanges.push({ field, from, to });
  }

  const linksOf = (doc: Document | null) => (doc ? d.documents.linksOf(doc.id) : Promise.resolve([]));
  const [fromLinks, toLinks] = await Promise.all([linksOf(fromDoc), linksOf(toDoc)]);
  const fromSet = new Map(fromLinks.map((l) => [linkKey(l), l]));
  const toSet = new Map(toLinks.map((l) => [linkKey(l), l]));
  const added = [...toSet.entries()].filter(([k]) => !fromSet.has(k)).map(([, v]) => v);
  const removed = [...fromSet.entries()].filter(([k]) => !toSet.has(k)).map(([, v]) => v);

  return {
    slug,
    libraryId,
    fromVersion: fromVersionId,
    toVersion: toVersionId,
    contentDiff,
    contentDiffError,
    metadataChanges,
    linkChanges: { added, removed },
    fromExists: fromDoc !== null,
    toExists: toDoc !== null,
  };
}
