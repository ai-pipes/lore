import { describe, it, expect } from 'vitest';
import { HashEmbeddingProvider } from '../../modules/catalog/infrastructure/embeddings/HashEmbeddings.js';

function cosine(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

describe('HashEmbeddingProvider', () => {
  const provider = new HashEmbeddingProvider();

  it('produces 1536-dimensional unit vectors', async () => {
    const v = await provider.embed('Create an order for a pet');
    expect(v).toHaveLength(1536);
    expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6);
  });

  it('is deterministic', async () => {
    const [a, b] = await provider.embedBatch(['refund an order', 'refund an order']);
    expect(a).toEqual(b);
  });

  it('ranks texts with shared vocabulary above unrelated ones', async () => {
    const [q, related, unrelated] = await provider.embedBatch([
      'how do refunds work for orders',
      'Refund an order: the payments service reverses the charge for the order',
      'Upload a photo for a pet profile',
    ]);
    expect(cosine(q, related)).toBeGreaterThan(cosine(q, unrelated));
    expect(cosine(q, related)).toBeGreaterThan(provider.minScore);
  });

  it('tolerates typos through character trigrams', async () => {
    const [q, doc] = await provider.embedBatch(['paymnet', 'payment']);
    expect(cosine(q, doc)).toBeGreaterThan(0.2);
  });

  it('returns a valid unit vector for empty input', async () => {
    const v = await provider.embed('');
    expect(v.filter((x) => x !== 0)).toHaveLength(1);
  });
});
