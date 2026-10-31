import type { Document, FindRelatedOptions, InferredLinkResult, LinkResult } from '../domain/document.js';
import { acceptSuggestedLinks, type SuggestedLink } from '../domain/links.js';
import type { CatalogDeps } from './ports.js';

/**
 * Asks the link suggester (an LLM) for relationships of a document to known slugs and saves
 * the valid ones as auto links, replacing the document's previous auto links (also when none
 * is valid, so re-enrichment never leaves stale ones). Manual links are never touched.
 * When the suggester fails (it rejects on an LLM error or timeout), the existing auto links are
 * kept. Never rejects: failures are logged, so it is safe to call fire-and-forget.
 */
export async function enrichDocument(d: CatalogDeps, doc: Document, knownSlugs: string[]): Promise<SuggestedLink[]> {
  if (!d.links.enabled()) return [];
  try {
    const links = acceptSuggestedLinks(await d.links.suggest(doc, knownSlugs), knownSlugs);
    await d.documents.replaceAutoLinks(doc.id, links);
    return links;
  } catch (err) {
    console.error(`[enrichment] failed for ${doc.slug}:`, err);
    return [];
  }
}

/** Enriches stored documents in the background, a bounded number at a time. */
export interface EnrichmentScheduler {
  /**
   * Queues documents of one version for enrichment. The returned promise settles when they have
   * all been enriched (or failed); it never rejects.
   */
  schedule(libraryId: string, versionId: string, docs: Document[]): Promise<void>;
}

export interface EnrichmentSchedulerOptions {
  /** Link suggestions (LLM calls) running at once, across all versions. Default 4. */
  concurrency?: number;
  /**
   * How long a version must receive no new documents before its queued documents are enriched.
   * A push uploads a new library in batches; waiting until the batches stop lets every document
   * link to the slugs of all of them, not only those uploaded so far. Default 5 s.
   */
  quietMs?: number;
}

interface PendingVersion {
  libraryId: string;
  versionId: string;
  docs: Map<string, Document>;
  waiters: (() => void)[];
  timer: ReturnType<typeof setTimeout> | null;
}

export function createEnrichmentScheduler(d: CatalogDeps, opts: EnrichmentSchedulerOptions = {}): EnrichmentScheduler {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const quietMs = opts.quietMs ?? 5_000;
  const pending = new Map<string, PendingVersion>();
  const queue: (() => Promise<void>)[] = [];
  let running = 0;

  const next = () => {
    running--;
    pump();
  };
  function pump(): void {
    while (running < concurrency && queue.length > 0) {
      running++;
      queue.shift()!().then(next, next);
    }
  }
  /** Runs `task` when a slot is free; settles when it has (whether it resolved or rejected). */
  const run = (task: () => Promise<unknown>) => new Promise<void>((resolve) => {
    queue.push(async () => {
      try {
        await task();
      } finally {
        resolve();
      }
    });
    pump();
  });

  async function flush(key: string): Promise<void> {
    const entry = pending.get(key)!;
    pending.delete(key);
    try {
      // The allowed link targets: every slug of the version now, after the push's batches.
      const knownSlugs = (await d.documents.hashes(entry.libraryId, entry.versionId)).map((h) => h.slug);
      await Promise.all([...entry.docs.values()].map((doc) => run(() => enrichDocument(d, doc, knownSlugs))));
    } catch (err) {
      console.error(`[enrichment] failed for ${entry.libraryId}@${entry.versionId}:`, err);
    } finally {
      for (const resolve of entry.waiters) resolve();
    }
  }

  return {
    schedule(libraryId, versionId, docs) {
      const key = `${libraryId}\u0000${versionId}`;
      let entry = pending.get(key);
      if (!entry) {
        entry = { libraryId, versionId, docs: new Map(), waiters: [], timer: null };
        pending.set(key, entry);
      }
      for (const doc of docs) entry.docs.set(doc.id, doc);
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => void flush(key), quietMs);
      const waiters = entry.waiters;
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}

const defaultSchedulers = new WeakMap<CatalogDeps, EnrichmentScheduler>();

/** The process-wide scheduler of these deps, created on first use. */
export function enrichmentSchedulerFor(d: CatalogDeps): EnrichmentScheduler {
  let scheduler = defaultSchedulers.get(d);
  if (!scheduler) {
    scheduler = createEnrichmentScheduler(d);
    defaultSchedulers.set(d, scheduler);
  }
  return scheduler;
}

/** Explicit links of a document (outbound, inbound or both). */
export function findRelatedDocs(d: CatalogDeps, opts: FindRelatedOptions): Promise<LinkResult[]> {
  return d.search.related(opts);
}

/** Relationships inferred from extracted metadata (gRPC/HTTP services, queues, DAL interfaces). */
export function inferRelatedDocs(d: CatalogDeps, opts: FindRelatedOptions): Promise<InferredLinkResult[]> {
  return d.search.inferRelated(opts);
}
