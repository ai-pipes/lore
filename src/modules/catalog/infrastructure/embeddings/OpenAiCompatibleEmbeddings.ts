import type { EmbeddingProvider } from './types.js';

interface EmbeddingsResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

export interface OpenAiCompatibleEmbeddingConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

/** Embeddings over any OpenAI-compatible `/embeddings` endpoint (OpenRouter, OpenAI, vLLM, …). */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  private _dimensions = 0;

  /** Known after the first call (the vector length of the model). */
  get dimensions(): number {
    return this._dimensions;
  }

  constructor(private readonly cfg: OpenAiCompatibleEmbeddingConfig) {
    this.id = `openai-compatible:${cfg.model}`;
  }

  async embed(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;

    const response = await fetch(`${this.cfg.baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: texts, model: this.cfg.model, encoding_format: 'float' }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embeddings API error ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as EmbeddingsResponse;
    if (!Array.isArray(data.data) || data.data.length !== texts.length) {
      throw new Error(
        `Embeddings API returned ${Array.isArray(data.data) ? data.data.length : 0} vectors for ${texts.length} inputs`,
      );
    }
    const vectors = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length > 0) this._dimensions = vectors[0].length;
    return vectors;
  }
}
