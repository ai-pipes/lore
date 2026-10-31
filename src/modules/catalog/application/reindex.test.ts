import { describe, it, expect } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { insertDocument } from './documents.js';
import { reindexEmbeddings } from './reindex.js';

async function setup(count: number) {
  const { deps, state } = createFakeCatalog();
  for (let i = 0; i < count; i++) {
    await insertDocument(deps, {
      library_id: 'lib',
      version_id: 'v1',
      slug: `doc/${String(i).padStart(3, '0')}`,
      content: `content ${i}`,
    });
  }
  state.vectors.clear();
  return { deps, state };
}

describe('reindexEmbeddings', () => {
  it('reports no_provider when the embedder is unavailable', async () => {
    const { deps } = await setup(1);
    expect(await reindexEmbeddings(deps)).toEqual({ ok: false, error: 'no_provider' });
  });

  it('embeds stale documents in batches, saves them with the model id and reports progress', async () => {
    const { deps, state } = await setup(130);
    state.embedding = { vector: [1, 2] };
    const batches: number[] = [];
    const embedBatch = deps.embedder.embedBatch.bind(deps.embedder);
    deps.embedder.embedBatch = (texts) => {
      batches.push(texts.length);
      return embedBatch(texts);
    };
    const progress: [number, number][] = [];
    const r = await reindexEmbeddings(deps, { onProgress: (done, total) => progress.push([done, total]) });
    expect(r).toEqual({ ok: true, value: { done: 130, total: 130 } });
    expect(batches).toEqual([64, 64, 2]);
    expect(progress).toEqual([[64, 130], [128, 130], [130, 130]]);
    expect(state.vectors.size).toBe(130);
    expect([...state.vectors.values()].every((v) => v.model === 'fake:1' && v.embedding.join() === '1,2')).toBe(true);
  });

  it('embeds the summary and content of each document', async () => {
    const { deps, state } = createFakeCatalog();
    await insertDocument(deps, { library_id: 'lib', version_id: 'v1', slug: 'a', summary: 'Sum', content: 'Body' });
    state.vectors.clear();
    state.embedding = { vector: [1] };
    const seen: string[][] = [];
    deps.embedder.embedBatch = async (texts) => (seen.push(texts), texts.map(() => [1]));
    await reindexEmbeddings(deps);
    expect(seen).toEqual([['Sum\nBody']]);
  });

  it('skips documents that are already current, unless all is set', async () => {
    const { deps, state } = await setup(3);
    state.embedding = { vector: [1] };
    state.vectors.set([...state.documents][0]!.id, { model: 'fake:1', embedding: [9] });
    expect(await reindexEmbeddings(deps)).toEqual({ ok: true, value: { done: 2, total: 2 } });
    expect(await reindexEmbeddings(deps, { all: true })).toEqual({ ok: true, value: { done: 3, total: 3 } });
  });

  it('honours batchSize', async () => {
    const { deps, state } = await setup(5);
    state.embedding = { vector: [1] };
    const progress: number[] = [];
    await reindexEmbeddings(deps, { batchSize: 2, onProgress: (d) => progress.push(d) });
    expect(progress).toEqual([2, 4, 5]);
  });

  it('propagates an embedBatch failure after earlier batches were saved and reported', async () => {
    const { deps, state } = await setup(5);
    state.embedding = { vector: [1] };
    const embedBatch = deps.embedder.embedBatch.bind(deps.embedder);
    let calls = 0;
    deps.embedder.embedBatch = (texts) => (++calls === 2 ? Promise.reject(new Error('boom')) : embedBatch(texts));
    const progress: number[] = [];
    await expect(reindexEmbeddings(deps, { batchSize: 2, onProgress: (d) => progress.push(d) })).rejects.toThrow('boom');
    expect(progress).toEqual([2]);
    expect(state.vectors.size).toBe(2);
  });

  it('does nothing when no document is stale', async () => {
    const { deps, state } = await setup(0);
    state.embedding = { vector: [1] };
    let called = false;
    deps.embedder.embedBatch = async () => ((called = true), []);
    expect(await reindexEmbeddings(deps)).toEqual({ ok: true, value: { done: 0, total: 0 } });
    expect(called).toBe(false);
  });
});
