export interface EmbeddingProvider {
  /** Stable model id that tags stored vectors: `openai-compatible:<model>`, `ollama:<model>`, `hash:<dimensions>`. */
  readonly id: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  /**
   * Suggested minimum cosine similarity for a vector hit to count as relevant.
   * Overridden by LORE_VECTOR_MIN_SCORE. Defaults to 0 (keep every neighbour).
   */
  readonly minScore?: number;
}
