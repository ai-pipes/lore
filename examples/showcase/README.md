# Showcase: Parcelly

A demo dataset and a local stack for screenshots and videos of Lore, with no paid API key:
the chat and the embeddings run on [Ollama](https://ollama.com) on the host.

Parcelly is a fictional last-mile delivery platform: seven services in three namespaces,
52 documents with cross-service links, mermaid diagrams, releases with changes
(for version diffs) and one feature-branch push. `MANIFEST.md` describes the company and the flow.

| Namespace | Libraries |
|---|---|
| `platform` | `api-gateway`, `identity-service`, `notifications-service` (v1 `e17a5c2` → v2 `2b9f6d4`) |
| `commerce` | `orders-service` (v1 `a1f3c9e` → v2 `7d2e481`), `billing-service` (v1 `5d02b7a` → v2 `c4a90e3`) |
| `logistics` | `dispatch-service` (v1 `0e6f4d9`, branch `feature/batch-dispatch` `f8b3a61`), `tracking-service` |

## Start

```bash
brew install ollama && brew services start ollama
ollama pull qwen2.5:7b && ollama pull nomic-embed-text
# Ollama's default context (4k) truncates Lore's chat prompt; give it 32k
launchctl setenv OLLAMA_CONTEXT_LENGTH 32768 && brew services restart ollama

# examples/showcase/.env: LORE_API_KEY=<openssl rand -hex 32>, LORE_ADMIN_PASSWORD=<12+ chars>
cd examples/showcase && docker compose up -d --build && cd ../..
npm run build && examples/showcase/push.sh
```

Open http://localhost:4747 and sign in as `admin` with the password from `.env`.
MCP listens on http://localhost:4748/mcp: create a token on the Tokens page and copy the
`claude mcp add` command shown there.

`launchctl setenv` lasts until reboot; run it again after a restart. Another model: set
`LLM_MODEL` in `.env` (e.g. `qwen2.5:14b`, slower but better answers) and `docker compose up -d`.

Reset everything: `docker compose down -v` in this directory, then start again.

## Record the demo video

```bash
docker exec lore-showcase-postgres-1 psql -U lore -qc "delete from chat_messages; delete from chat_sessions;"
npx tsx examples/showcase/record-demo.ts   # drives the UI, captures frames to out/raw (~5 min)
npx tsx examples/showcase/make-video.ts    # out/lore-demo.mp4, LLM waits fast-forwarded
```

`record-demo.ts` asks three questions (a cross-service one, the order lifecycle with a
mermaid diagram, an on-call runbook scoped to `dispatch-service`), opens the cited documents
and publishes the last chat as an Insight, with chapter cards in between. A 7B model answers
in 30–70 s on an M1 Pro; `make-video.ts` squeezes each wait into 1.6 s. Answers differ between
runs: record again if one reads badly.

## More to show by hand

- Questions: *How is the delivery price calculated and when does surge apply?*,
  *Which services consume order.created and what does each of them do?*
- **Diff** (MCP `get_document_diff` or `GET /api/libraries/:id/diff/:slug`): `orders-service`
  `orders/cancel-order`, `billing-service` `refunds/issue-refund`, v1 → v2.
- **Branch** (MCP or `GET /api/search?branch=feature/batch-dispatch`): *How does batched dispatch work?*
- **MCP** in Claude Code: *Using Lore, what changed in billing-service's refund rules in the last release?*
