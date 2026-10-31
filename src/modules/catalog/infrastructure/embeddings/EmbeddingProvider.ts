import { OpenAiCompatibleEmbeddingProvider } from './OpenAiCompatibleEmbeddings.js';
import { OllamaEmbeddingProvider } from './OllamaEmbeddings.js';
import { HashEmbeddingProvider } from './HashEmbeddings.js';
import type { EmbeddingProvider } from './types.js';
import type { Embedder } from '../../application/ports.js';

export type { EmbeddingProvider } from './types.js';

let provider: EmbeddingProvider | null = null;

/**
 * Initialise the embedding provider from LORE_EMBEDDING_PROVIDER:
 *   openai-compatible — any OpenAI-compatible /embeddings endpoint (OpenRouter by default);
 *     LORE_EMBEDDING_MODEL (required), LORE_EMBEDDING_BASE_URL / LORE_EMBEDDING_API_KEY,
 *     falling back to LLM_BASE_URL / LLM_API_KEY
 *   ollama — local Ollama server (LORE_OLLAMA_URL, LORE_OLLAMA_MODEL)
 *   hash   — deterministic offline feature hashing (tests, demos, no network)
 *   none   — no embeddings, full-text search only (default)
 */
export function initEmbeddings(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  const type = (env.LORE_EMBEDDING_PROVIDER || 'none').toLowerCase();
  provider = null;
  if (type === 'openai-compatible') {
    const model = env.LORE_EMBEDDING_MODEL;
    if (!model) throw new Error('LORE_EMBEDDING_MODEL is required when LORE_EMBEDDING_PROVIDER=openai-compatible');
    provider = new OpenAiCompatibleEmbeddingProvider({
      baseUrl: env.LORE_EMBEDDING_BASE_URL || env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: env.LORE_EMBEDDING_API_KEY || env.LLM_API_KEY || undefined,
      model,
    });
  } else if (type === 'ollama') {
    const baseUrl = env.LORE_OLLAMA_URL ?? 'http://localhost:11434';
    const model = env.LORE_OLLAMA_MODEL ?? 'nomic-embed-text';
    provider = new OllamaEmbeddingProvider(baseUrl, model);
  } else if (type === 'hash') {
    provider = new HashEmbeddingProvider();
  } else if (type !== 'none') {
    throw new Error(`Unknown LORE_EMBEDDING_PROVIDER "${type}" (expected openai-compatible, ollama, hash or none)`);
  }
  return provider;
}

/** Test seam: install (or clear) the provider without going through the environment. */
export function setEmbeddingProvider(p: EmbeddingProvider | null): void {
  provider = p;
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  return provider;
}

/** The Embedder port over the provider set up by initEmbeddings(), resolved on each call. */
export const providerEmbedder: Embedder = {
  available: () => provider !== null,
  minScore: () => provider?.minScore,
  modelId: () => provider?.id ?? null,
  embed(text) {
    if (!provider) return Promise.reject(new Error('No embedding provider configured'));
    return provider.embed(text);
  },
  embedBatch(texts) {
    if (!provider) return Promise.reject(new Error('No embedding provider configured'));
    return provider.embedBatch(texts);
  },
};
