import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenAiCompatibleEmbeddingProvider } from './OpenAiCompatibleEmbeddings.js';
import { getEmbeddingProvider, initEmbeddings } from './EmbeddingProvider.js';

interface Recorded {
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

let server: Server;
let baseUrl: string;
let requests: Recorded[];
let reply: { status: number; body: unknown };

beforeEach(async () => {
  requests = [];
  reply = { status: 200, body: { data: [] } };
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({ url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('OpenAiCompatibleEmbeddingProvider', () => {
  it('posts to <baseUrl>/embeddings with a bearer key and returns vectors sorted by index', async () => {
    reply.body = {
      data: [
        { index: 1, embedding: [3, 4] },
        { index: 0, embedding: [1, 2] },
      ],
    };
    const p = new OpenAiCompatibleEmbeddingProvider({ baseUrl, apiKey: 'k', model: 'm' });
    expect(await p.embedBatch(['a', 'b'])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(requests[0].url).toBe('/v1/embeddings');
    expect(requests[0].headers.authorization).toBe('Bearer k');
    expect(requests[0].body).toEqual({ input: ['a', 'b'], model: 'm', encoding_format: 'float' });
  });

  it('sends no Authorization header without a key', async () => {
    reply.body = { data: [{ index: 0, embedding: [1] }] };
    const p = new OpenAiCompatibleEmbeddingProvider({ baseUrl: `${baseUrl}/`, model: 'm' });
    expect(await p.embed('a')).toEqual([1]);
    expect(requests[0].url).toBe('/v1/embeddings');
    expect(requests[0].headers.authorization).toBeUndefined();
  });

  it('rejects when the answer has another number of vectors than inputs', async () => {
    reply.body = { data: [{ index: 0, embedding: [1] }] };
    const p = new OpenAiCompatibleEmbeddingProvider({ baseUrl, model: 'm' });
    await expect(p.embedBatch(['a', 'b'])).rejects.toThrow(/1 vectors? for 2 inputs/);
  });

  it('rejects on an HTTP error without leaking the key', async () => {
    reply = { status: 402, body: { error: 'payment required' } };
    const p = new OpenAiCompatibleEmbeddingProvider({ baseUrl, apiKey: 'secret-key', model: 'm' });
    const err = await p.embed('a').then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toMatch(/402/);
    expect(err?.message).not.toContain('secret-key');
  });

  it('reports dimensions from the last answer and an id with the model', async () => {
    reply.body = { data: [{ index: 0, embedding: [1, 2, 3] }] };
    const p = new OpenAiCompatibleEmbeddingProvider({ baseUrl, model: 'qwen/qwen3-embedding-0.6b' });
    expect(p.id).toBe('openai-compatible:qwen/qwen3-embedding-0.6b');
    await p.embed('a');
    expect(p.dimensions).toBe(3);
  });
});

describe('initEmbeddings', () => {
  afterEach(() => initEmbeddings({}));

  function baseOf(env: Record<string, string>): Promise<{ url: string; auth?: string }> {
    return (async () => {
      const p = initEmbeddings(env);
      reply.body = { data: [{ index: 0, embedding: [1] }] };
      await p!.embed('x');
      return { url: requests[0].url, auth: requests[0].headers.authorization };
    })();
  }

  it('defaults to OpenRouter and the LLM_API_KEY', async () => {
    const p = initEmbeddings({
      LORE_EMBEDDING_PROVIDER: 'openai-compatible',
      LORE_EMBEDDING_MODEL: 'm',
      LLM_API_KEY: 'k',
    });
    expect(p?.id).toBe('openai-compatible:m');
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls.push(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer k');
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }));
    }) as typeof fetch;
    try {
      await p!.embed('x');
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual(['https://openrouter.ai/api/v1/embeddings']);
    expect(getEmbeddingProvider()).toBe(p);
  });

  it('prefers LORE_EMBEDDING_BASE_URL / _API_KEY over LLM_*', async () => {
    const got = await baseOf({
      LORE_EMBEDDING_PROVIDER: 'openai-compatible',
      LORE_EMBEDDING_MODEL: 'm',
      LORE_EMBEDDING_BASE_URL: baseUrl,
      LORE_EMBEDDING_API_KEY: 'own',
      LLM_BASE_URL: 'http://127.0.0.1:1/never',
      LLM_API_KEY: 'llm',
    });
    expect(got).toEqual({ url: '/v1/embeddings', auth: 'Bearer own' });
  });

  it('falls back to LLM_BASE_URL when LORE_EMBEDDING_BASE_URL is unset', async () => {
    const got = await baseOf({
      LORE_EMBEDDING_PROVIDER: 'openai-compatible',
      LORE_EMBEDDING_MODEL: 'm',
      LLM_BASE_URL: baseUrl,
    });
    expect(got).toEqual({ url: '/v1/embeddings', auth: undefined });
  });

  it('gives ollama and hash providers stable ids', () => {
    expect(initEmbeddings({ LORE_EMBEDDING_PROVIDER: 'hash' })?.id).toBe('hash:1536');
    expect(initEmbeddings({ LORE_EMBEDDING_PROVIDER: 'ollama', LORE_OLLAMA_MODEL: 'nomic-embed-text' })?.id).toBe(
      'ollama:nomic-embed-text',
    );
  });
});
