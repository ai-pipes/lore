# 0002. A neutral LLM port and model-tagged embeddings

## Context

Lore called the OpenAI SDK directly from several modules, defaulted to `gpt-4o-mini` and the OpenAI endpoint, and stored embeddings in a fixed 1536-dimensional column. That tied every installation to one vendor. For an open-source release, users must be able to run Lore against OpenRouter, a local Ollama or vLLM, or any other OpenAI-compatible endpoint, and to pick the embedding model that fits them.

## Decision

- The `llm` module exposes a `LanguageModel` port. Search, catalog and chat depend on the port, never on a vendor SDK; only `src/modules/llm/infrastructure/` imports `openai`.
- The adapter speaks the OpenAI-compatible protocol and assembles streamed tool calls itself, so callers see complete tool calls regardless of how the provider chunks them. Timeouts and retries stay per call site.
- The default endpoint is OpenRouter (`https://openrouter.ai/api/v1`). `LLM_MODEL` has no default and is required once the LLM is configured (`LLM_API_KEY` or `LLM_BASE_URL` set). `OPENAI_API_KEY`, `LORE_EMBEDDING_PROVIDER=openai` and the `gpt-4o-mini` default are removed with no legacy path.
- Embeddings come from the `openai-compatible`, `ollama`, `hash` or `none` providers. Vectors have no fixed dimension and each is tagged with its model id (`openai-compatible:<model>`, `ollama:<model>`, `hash:<dimensions>`); queries only match vectors of the current model. Vectors copied between versions keep their source model.
- Changing the embedding model is an explicit admin action: `lore reindex-embeddings` embeds documents lacking a vector for the current model, and `--all` forces every document.

## Consequences

- Any OpenAI-compatible provider works without code changes, and the model can be switched with configuration plus a reindex.
- Without a fixed dimension there is no ANN (HNSW/IVFFlat) index for now; vector search scans the vectors of the current model. This is acceptable at the current corpus sizes and can be revisited with per-model indexes.
- After a model change, vector search finds only already re-embedded documents until the reindex finishes; full-text search is unaffected.
- Vectors stored before this change have no model tag, so vector search ignores them until `lore reindex-embeddings` has been run once after the upgrade.
- Native adapters (Anthropic, Gemini, ...) can be added behind the same port without touching callers.
- Existing installations must rename `OPENAI_API_KEY` to `LLM_API_KEY`, set `LLM_MODEL` and, for embeddings, use `openai-compatible` with `LORE_EMBEDDING_MODEL`.
