# Provider-independent LLM and embeddings — design

Status: draft · 2026-10-31

## Intent

Lore is going open source. Whoever runs an instance must be able to choose the model provider for
chat answers and for embeddings. Today the engine is tied to OpenAI in two ways:

- three infrastructure adapters call the `openai` SDK directly (`getLLMClient().chat.completions.create`):
  chat answers (`chat/infrastructure/llm-answer-model.ts`), link suggestions
  (`catalog/infrastructure/llm-link-suggester.ts`) and query term extraction
  (`search/infrastructure/llm-term-extractor.ts`); and the chat's own `AnswerModel` port is shaped
  after the OpenAI wire format (`tool_calls`, `finish_reason: 'tool_calls'`, role `tool`, streamed
  tool-call fragments);
- the OpenAI embedding provider hard-codes `https://api.openai.com/v1/embeddings` and
  `text-embedding-3-small`, and the vector column is `vector(1536)`, so any model with another
  dimension (e.g. Ollama's default `nomic-embed-text`, 768) cannot be stored at all.

The decision (owner): **put one provider-neutral abstraction over LLM calls and one over embeddings,
and ship OpenRouter as the default provider** behind an OpenAI-compatible adapter. OpenRouter serves
both chat completions and embeddings (`POST /api/v1/embeddings`) in the OpenAI format with one key,
and gives access to most model vendors.

## Goals

1. A `LanguageModel` port owned by the `llm` module, in Lore's own types. No module except the
   `llm` adapter imports `openai`.
2. One adapter, `openai-compatible`, defaulting to OpenRouter (`https://openrouter.ai/api/v1`). It
   must keep working against any OpenAI-compatible server (OpenAI, Ollama `/v1`, vLLM, LiteLLM).
3. Embeddings: an `openai-compatible` embedding provider with configurable base URL, key and model,
   defaulting to OpenRouter and reusing the LLM's base URL and key unless set separately.
4. Any embedding dimension can be stored; each vector records the model that produced it; vector
   search only compares vectors of the configured model.
5. A server command `lore reindex-embeddings` that recomputes vectors with the configured model.
6. Documentation: README (configuration table, Compose quick start, chat section), `.env.example`,
   and an ADR.

## Non-goals

- Native adapters for Anthropic, Gemini, Bedrock, etc. The port must make them possible later
  without touching `chat`, `catalog` or `search`, but none is built now.
- Using a Claude Pro/Max subscription (via Claude Code) as a provider. Explicitly dropped by the owner.
- OpenRouter-specific features (provider routing, model fallbacks, `HTTP-Referer`/`X-Title`
  attribution headers, cost reporting).
- Automatic re-embedding when the model changes. Changing the embedding model is the admin's
  responsibility; the docs tell them to run `lore reindex-embeddings`.
- An ANN index (HNSW/IVFFlat) on vectors. Search stays an exact scan filtered by library/version,
  as today. (An ANN index would need a fixed dimension again; that is a later decision.)
- A reindex button in the admin UI.
- The example generator (`examples/generator/generate.ts`) is outside `src/` and stays as is.

## Anti-goals

- Lore types that are the OpenAI wire format renamed. If a native Anthropic adapter could not be
  written against the port without changes to callers, the port is wrong.
- A silent misconfiguration: a removed variable or value (`OPENAI_API_KEY`,
  `LORE_EMBEDDING_PROVIDER=openai`) that is still set must produce a clear message at startup, not
  be ignored or reinterpreted.
- A 500 on search because stored vectors have another dimension than the query vector.

## Compatibility

There are no consumers yet (owner): this change may break existing configuration. No legacy
paths, aliases or data adoption are kept. Removed:

- `OPENAI_API_KEY` (no longer a fallback for the LLM key or used for embeddings). If set, `serve`
  and `mcp` warn at startup that it is ignored and name the replacement (`LLM_API_KEY`,
  `LORE_EMBEDDING_API_KEY`) — the same pattern as the existing warning for the removed
  `LORE_READ_KEY` / `LORE_MCP_API_KEY`.
- `LORE_EMBEDDING_PROVIDER=openai`: a `checkConfig` error naming `openai-compatible` as the
  replacement.
- The `gpt-4o-mini` default model and the OpenAI default endpoint.
- `docker-compose.yml`: `OPENAI_API_KEY` goes, `LLM_MODEL` loses its `gpt-4o-mini` default, the
  new `LORE_EMBEDDING_*` variables are passed through, and the embeddings comment points to
  `openai-compatible`.

## The LLM port

Declared in `src/modules/llm/application/ports.ts`, exported from `src/modules/llm/index.ts`
(types plus a factory). Shape (names are the builder's to refine; the semantics are the design):

```ts
type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

interface LlmToolCall { id: string; name: string; arguments: string /* JSON text */ }
interface LlmTool { name: string; description: string; parameters: Record<string, unknown> /* JSON Schema */ }

type LlmStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: LlmToolCall }            // a complete call, never a fragment
  | { type: 'end'; reason: 'stop' | 'tool_calls' | 'length' | 'other' };

interface LanguageModel {
  configured(): boolean;
  complete(req: {
    messages: LlmMessage[];
    maxTokens?: number;
    temperature?: number;
    json?: boolean;              // ask for a JSON object; callers still parse defensively
    timeoutMs: number;
    maxRetries?: number;         // default 0
    signal?: AbortSignal;
  }): Promise<string>;
  stream(req: {
    messages: LlmMessage[];
    tools: LlmTool[];
    temperature?: number;
    timeoutMs: number;           // time to first byte, as today
    maxRetries?: number;
    signal?: AbortSignal;
  }): AsyncIterable<LlmStreamEvent>;
}
```

Key points:

- **Tool-call fragments are assembled in the adapter**, not in `chat`. Today
  `chat/application/answer.ts` accumulates OpenAI's indexed `tool_calls` deltas; that logic moves
  into the `openai-compatible` adapter, which emits whole `tool_call` events. Other vendors stream
  tool calls differently, so this belongs behind the port.
- **Finish reasons are normalised**: `stop`, `tool_calls`, `length`, anything else → `other`. The
  chat loop keeps its current rule: only `tool_calls` triggers another turn.
- **Timeouts and retries stay per call site** with today's values: summary 120 s / 1 retry, chat
  stream 60 s / 1 retry, link suggestions `SUGGEST_TIMEOUT_MS` / 0 retries, term extraction its
  `timeoutMs` / 0 retries.
- `configured()` replaces `isLLMConfigured()` with the same meaning: Lore skips LLM-only features
  (term extraction, link enrichment, chat answers) when no LLM is configured.

### Consumers

- `chat`: `AnswerModel` goes away as a separate OpenAI-shaped port; `ChatDeps.model` becomes the
  `LanguageModel` (or a thin chat port over it, builder's call), `ChatTurn`/`ToolCall`/`ToolSpec`/
  `ModelDelta`/`ToolCallDelta` are replaced by the `llm` types. `summarize` becomes a `complete`
  call with the `publish/summary` prompt, done in chat's application or infrastructure (builder's
  call). The chat's public exports in `chat/index.ts` change accordingly.
- `catalog` (`llm-link-suggester.ts`) and `search` (`llm-term-extractor.ts`) take a
  `LanguageModel` instead of calling `getLLMClient()`. They keep their own ports
  (`LinkSuggester`, `TermExtractor`); only their adapters change.
- `getLLMClient`, `getLLMModel`, `initLLM` and `isLLMConfigured` disappear from `llm/index.ts`.
  The `openai` package is imported only in `src/modules/llm/infrastructure/`.
- The `LanguageModel` instance is created once in `platform/` composition and passed into the
  `createPg<Module>` compose functions (they already return `<Module>Deps`). Lazy resolution on
  each call, as today, is fine too — builder's call, as long as tests can inject a fake.

### Configuration (LLM)

| Variable | Default | Meaning |
|---|---|---|
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint. |
| `LLM_API_KEY` | unset | Key for that endpoint. |
| `LLM_MODEL` | none — required when the LLM is configured | e.g. `anthropic/claude-sonnet-4.5`, `openai/gpt-4o-mini` on OpenRouter. |

- The LLM is configured when `LLM_API_KEY` or `LLM_BASE_URL` is set (a local server may need no
  key).
- `checkConfig` (`platform/config.ts`) reports an error when the LLM is configured and `LLM_MODEL`
  is unset.

## Embeddings

The `Embedder` port in `catalog/application/ports.ts` and the `EmbeddingProvider` interface stay.

### Providers (`LORE_EMBEDDING_PROVIDER`)

- `openai-compatible` — new. `POST {base}/embeddings` with Bearer key, batch input,
  `encoding_format: 'float'`, sorted by `index`. Config:
  `LORE_EMBEDDING_BASE_URL` (default `LLM_BASE_URL`, else `https://openrouter.ai/api/v1`),
  `LORE_EMBEDDING_API_KEY` (default `LLM_API_KEY`), `LORE_EMBEDDING_MODEL` (required, e.g.
  `openai/text-embedding-3-small` or `qwen/qwen3-embedding-0.6b` on OpenRouter). The dimension is
  whatever the model returns.
- `openai` — removed (see Compatibility); `OpenAiEmbeddings.ts` is replaced by the new provider.
- `ollama`, `hash`, `none` — unchanged.

The default of `LORE_EMBEDDING_PROVIDER` stays `none` (`hash` in Compose), so an offline quick
start keeps working without a key. "OpenRouter as the default" means: `openai-compatible` (the
provider the docs recommend) points at OpenRouter unless a base URL is set.

`checkConfig` validates the new provider name and its required variables, in the style of the
existing `openai` check.

### Storage: any dimension, tagged with its model

New forward-only migration in `drizzle/`:

- `document_vectors.embedding` becomes `vector` without a fixed dimension.
- New column `document_vectors.model text` — the embedding model identity.

Drizzle's built-in `vector()` requires `dimensions`; the schema will need a `customType` for a
dimensionless `vector` (builder's call how).

**Model identity**: each provider exposes a stable id, `<provider>:<model>` — e.g.
`openai-compatible:openai/text-embedding-3-small`, `ollama:nomic-embed-text`, `hash:1536`.

**Writes** (`insertDocument`, `insertDocumentBatch`): store the current model id next to the
vector. **Copies** between versions (the `inserted_vectors` CTE in `pg-documents.ts`) duplicate an
existing vector without re-embedding it, so they **keep the source row's `model`**. Tagging a copy
with the current id would label old-model vectors as current after a model change, and both search
and the default reindex would then trust them.

**Search** (`pg-document-search.ts`): add `document_vectors.model = <current id>` to the vector
query. Documents without a vector of the current model are simply not vector hits; full-text search
still finds them. This also makes mixed dimensions impossible inside one query.

**Existing rows**: the migration cannot know which model produced them, so it leaves `model`
NULL. A NULL never matches the current id, so those vectors are ignored by search until
`lore reindex-embeddings` replaces them (the default run picks them up as "stale"). No startup
adoption.

### `lore reindex-embeddings`

A server-side command next to `serve`/`status` in `platform/server-commands.ts`, with the use case
in `catalog/application/` (fake-port tested) and the Postgres side in `catalog/infrastructure/`.

- Default: (re)embeds every document, in every version, whose vector is missing or has another
  model id than the current one. This makes the command resumable after an interruption and a
  no-op when everything is current.
- `--all`: re-embeds every document regardless of its tag.
- Works in batches through `embedBatch` (batch size a constant, builder's call; OpenRouter's limits
  are per model), embedding the same text as on insert (summary + content, first 8000 chars — share
  the helper rather than duplicating it).
- Prints progress (`n / total`) and a final count; exits non-zero when the provider is `none` or a
  batch fails (after reporting how many were done).
- Requires the same configuration as `serve` for DB and embeddings (`REQUIRED_BY_COMMAND`).

## Documentation

- README: configuration table (new `LLM_*` defaults, `LORE_EMBEDDING_*`; `OPENAI_API_KEY` moves to
  the "Removed" line; drop the "must produce 1536-dimensional vectors" note), the Compose quick start
  (OpenRouter: `LLM_API_KEY`, `LLM_MODEL`, `LORE_EMBEDDING_PROVIDER=openai-compatible`,
  `LORE_EMBEDDING_MODEL`), the chat section, and a short "Changing the embedding model" section:
  change the variables, restart, run `lore reindex-embeddings`; until then vector search only
  finds documents already embedded with the new model.
- `.env.example`: same.
- `docs/adr/0002-llm-provider-port.md`: why a neutral port, why OpenRouter as default, why
  tool-call assembly lives in the adapter, why dimensionless vectors with a model tag.
- `CLAUDE.md`: the `llm` module row ("the OpenAI-compatible client" → the `LanguageModel` port and
  its adapters).

## Testing

- `llm` application/port: fake `LanguageModel` in `test/fakes/` used by chat, catalog and search
  tests. `chat/application/answer.test.ts` is rewritten against `LlmStreamEvent`s.
- `openai-compatible` adapter: tests against a local HTTP stub (no network) covering streamed text,
  streamed tool calls split across chunks (assembled into whole calls), multiple parallel tool
  calls, finish-reason mapping, JSON mode flag, timeout/abort.
- Embeddings: adapter test against a stub; integration tests (`src/__tests__/`) for storing
  vectors of two different dimensions, search filtering by model id (NULL-tagged rows ignored),
  copies between versions keeping the source tag, and `reindex-embeddings` (default and `--all`) with the `hash` provider at two different
  dimensions.
- `checkConfig` tests for the new rules (model required, new provider name, `openai` rejected) and
  the startup warning for a set `OPENAI_API_KEY`.
- Coverage of `domain/application` stays ≥ 90 %; `npm run verify` passes; tests stay offline.

## Decided by the owner

- Provider-neutral abstraction over LLM calls and over embeddings.
- OpenRouter as the default for both.
- No native adapters now; no Claude-subscription provider.
- Changing the embedding model is the admin's job; docs say to reindex; a `lore reindex-embeddings`
  CLI command is the tool for it.
- No consumers yet: existing configuration may break; no legacy paths.

## Calls made in this design (not the owner's)

- Tool-call fragments are assembled in the adapter; the port emits whole calls.
- `OPENAI_API_KEY` and `LORE_EMBEDDING_PROVIDER=openai` are removed, with a startup warning /
  config error rather than silent ignoring.
- `LLM_MODEL` and `LORE_EMBEDDING_MODEL` have no default.
- Embedding base URL and key fall back to the LLM's.
- Vectors are tagged with `<provider>:<model>`; existing untagged vectors are ignored until
  reindexed; search filters by the current model.
- `reindex-embeddings` defaults to "missing or stale only" and covers all versions; `--all` forces.
- Vectors copied between versions keep their source model tag.
- `LORE_EMBEDDING_PROVIDER` keeps its default `none` (`hash` in Compose); OpenRouter is the default
  endpoint of `openai-compatible`, not the default provider.
- Env var names: `LLM_*` kept for the LLM; new embedding variables use the `LORE_EMBEDDING_` prefix.

## Left to the builder

Exact type and function names; whether `ChatDeps.model` is the `LanguageModel` itself or a thin
chat port over it; where `summarize` lives; eager vs lazy construction of the model; the Drizzle
custom type; the reindex batch size; the stub server used in adapter tests.
