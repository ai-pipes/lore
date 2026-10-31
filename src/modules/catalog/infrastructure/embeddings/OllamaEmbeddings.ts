import type { EmbeddingProvider } from './types.js';

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  // Dimensions depend on the model. nomic-embed-text = 768, mxbai-embed-large = 1024.
  // We read from the first response and cache it.
  private _dimensions = 768;
  readonly id: string;
  get dimensions(): number {
    return this._dimensions;
  }

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {
    this.id = `ollama:${model}`;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embeddings error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    this._dimensions = data.embedding.length;
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama does not yet support batched embeddings — run in parallel
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
