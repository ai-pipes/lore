import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { createEnrichmentScheduler, enrichDocument, enrichmentSchedulerFor, findRelatedDocs, inferRelatedDocs } from './enrichment.js';

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const fake = createFakeCatalog();
  await fake.deps.libraries.upsert('lib', 'Lib');
  await fake.deps.versions.create('v1', 'lib');
  const doc = await fake.deps.documents.insert({
    library_id: 'lib', version_id: 'v1', slug: 'a', content: 'A', links: [{ slug: 'manual', type: 'references' }],
  });
  return { ...fake, doc };
}

describe('enrichDocument', () => {
  it('does nothing when no link suggester is configured', async () => {
    const { deps, state, doc } = await setup();
    expect(await enrichDocument(deps, doc, ['b'])).toEqual([]);
    expect(state.suggestCalls).toEqual([]);
  });

  it('keeps only valid suggestions and replaces the auto links, never the manual ones', async () => {
    const { deps, state, doc } = await setup();
    await deps.documents.replaceAutoLinks(doc.id, [{ toSlug: 'stale', linkType: 'references', confidence: 0.9 }]);
    state.suggestions = [
      { toSlug: 'b', linkType: 'calls-service', confidence: 0.8 },
      { toSlug: 'unknown', linkType: 'calls-service', confidence: 0.8 },
      { toSlug: 'b', linkType: 'references', confidence: 0.1 },
    ];
    const links = await enrichDocument(deps, doc, ['b']);
    expect(links).toEqual([{ toSlug: 'b', linkType: 'calls-service', confidence: 0.8 }]);
    expect((await deps.documents.linksOf(doc.id)).map((l) => `${l.source}:${l.toSlug}`)).toEqual(['manual:manual', 'auto:b']);
  });

  it('clears stale auto links when nothing valid is suggested', async () => {
    const { deps, state, doc } = await setup();
    await deps.documents.replaceAutoLinks(doc.id, [{ toSlug: 'stale', linkType: 'references', confidence: 0.9 }]);
    state.suggestions = [];
    expect(await enrichDocument(deps, doc, [])).toEqual([]);
    expect((await deps.documents.linksOf(doc.id)).map((l) => l.source)).toEqual(['manual']);
  });

  it('keeps the existing auto links when the suggester fails or times out', async () => {
    const { deps, state, doc } = await setup();
    await deps.documents.replaceAutoLinks(doc.id, [{ toSlug: 'b', linkType: 'references', confidence: 0.9 }]);
    state.suggestions = [];
    deps.links.suggest = () => Promise.reject(new Error('timeout'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await enrichDocument(deps, doc, ['b'])).toEqual([]);
    expect((await deps.documents.linksOf(doc.id)).map((l) => `${l.source}:${l.toSlug}`)).toEqual(['manual:manual', 'auto:b']);
  });

  it('logs and returns [] when saving fails, never rejecting', async () => {
    const { deps, state, doc } = await setup();
    state.suggestions = [{ toSlug: 'b', linkType: 'references', confidence: 0.9 }];
    deps.documents.replaceAutoLinks = () => Promise.reject(new Error('db down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await enrichDocument(deps, doc, ['b'])).toEqual([]);
    expect(error).toHaveBeenCalledWith('[enrichment] failed for a:', expect.any(Error));
  });
});

describe('enrichment scheduler', () => {
  it('keeps one default scheduler per deps', async () => {
    const { deps } = await setup();
    expect(enrichmentSchedulerFor(deps)).toBe(enrichmentSchedulerFor(deps));
    expect(enrichmentSchedulerFor(deps)).not.toBe(enrichmentSchedulerFor(createFakeCatalog().deps));
  });

  it('waits for the version to be quiet, then enriches each queued document once', async () => {
    vi.useFakeTimers();
    try {
      const { deps, state, doc } = await setup();
      state.suggestions = [];
      const scheduler = createEnrichmentScheduler(deps);
      const done = Promise.all([scheduler.schedule('lib', 'v1', [doc]), scheduler.schedule('lib', 'v1', [doc])]);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(state.suggestCalls).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(state.suggestCalls.map((c) => c.slug)).toEqual(['a']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('findRelatedDocs / inferRelatedDocs', () => {
  it('delegate to the search port', async () => {
    const { deps, state } = await setup();
    const opts = { library_id: 'lib', slug: 'a', direction: 'both' as const };
    expect(await findRelatedDocs(deps, opts)).toEqual([]);
    expect(await inferRelatedDocs(deps, opts)).toEqual([]);
    expect(state.searchCalls).toEqual([
      { method: 'related', args: [opts] },
      { method: 'inferRelated', args: [opts] },
    ]);
  });
});
