import { createHash } from 'crypto';
import type { EmbeddingProvider } from './types.js';

/**
 * Deterministic, offline embedding provider based on feature hashing.
 *
 * Every lower-cased word and every character trigram of the input is hashed
 * into one of `dimensions` buckets (with a hashed sign), and the resulting
 * vector is L2-normalised. Texts that share vocabulary end up close in cosine
 * space, which is enough for tests, demos and air-gapped setups. It has no
 * semantic understanding: use `openai-compatible` or `ollama` for real deployments.
 *
 * Enable with LORE_EMBEDDING_PROVIDER=hash.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  /** Unrelated texts share almost no hashed features; below this they are noise. */
  readonly minScore = 0.2;

  readonly id: string;

  constructor(readonly dimensions = 1536) {
    this.id = `hash:${dimensions}`;
  }

  async embed(text: string): Promise<number[]> {
    return this.embedSync(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedSync(t));
  }

  embedSync(text: string): number[] {
    const vec = Array.from({ length: this.dimensions }, () => 0);
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

    const add = (feature: string, weight: number) => {
      const digest = createHash('sha1').update(feature).digest();
      const bucket = digest.readUInt32BE(0) % this.dimensions;
      const sign = digest[4] & 1 ? 1 : -1;
      vec[bucket] += sign * weight;
    };

    for (const word of words) {
      add(`w:${word}`, 1);
      const padded = `#${word}#`;
      for (let i = 0; i + 3 <= padded.length; i++) add(`t:${padded.slice(i, i + 3)}`, 0.5);
    }

    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm === 0) {
      // pgvector cosine distance is undefined for zero vectors — return a fixed unit vector
      vec[0] = 1;
      return vec;
    }
    return vec.map((v) => v / norm);
  }
}
