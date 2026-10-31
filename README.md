# lore

Living documentation for your services. Every service pushes per-endpoint Markdown docs from CI on each merge; Lore keeps every version, diffs them, and answers questions across all services — in a browser chat that cites its sources, and over MCP for AI agents.

[![Lore demo: a question answered across services with cited documents, a mermaid diagram, a runbook scoped to one service, and publishing the chat as an Insight](docs/media/lore-demo.gif)](docs/media/lore-demo.mp4)

<sub>Demo at 2× speed, LLM waits cut ([full video, 2 min](docs/media/lore-demo.mp4)). Recorded on the [Parcelly showcase](examples/showcase/) with a local 7B model on Ollama.</sub>

**The problem it solves.** Hand-written docs drift from the code, and the knowledge you need ("what happens after an order is placed?") is spread across several services. With Lore the docs are rebuilt from the code on every merge (by your own generator, or the example one in this repo), so they describe what is actually deployed, and one question can be answered from the docs of every service involved — with a link to each document it used.

**Who it is for.** Teams with several services who want searchable, versioned, AI-readable reference docs inside their own network. It is a single Node.js process plus Postgres (pgvector). It is **not** a docs website generator or a wiki: there is no editor. Every reader signs in (see [Security](#security)).

## How it works

```mermaid
flowchart LR
  subgraph CI["CI of each service (on merge to main)"]
    G[doc generator<br/>OpenAPI / code + LLM] --> D[docs/*.md]
    D --> P["lore push -l service -v $GIT_SHA"]
  end
  P -->|HTTP API, project key lpk_| L[Lore]
  L --- DB[(Postgres + pgvector<br/>versions, links, embeddings)]
  B[Browser chat] -->|question| L
  L -->|answer with ref chips| B
  A[Claude Code / agents] -->|MCP /mcp, personal sk_ token| L
  L -.->|optional| LLM[OpenAI-compatible LLM<br/>OpenRouter, Ollama, ...]
```

- **Push.** `lore push` registers a version (usually the git SHA), clones the current version, uploads only documents whose content hash changed, deletes documents removed locally, syncs images and promotes the version. Feature branches can push with `--no-promote` and be queried by branch.
- **Store.** Every version is kept. `get_document_diff` / `GET /api/libraries/:id/diff/:slug` show what changed between releases. Links between documents come from frontmatter, from metadata extracted from the text (tables, queues, services), and optionally from LLM enrichment.
- **Search.** Hybrid: Postgres full-text search plus vector search, fused with reciprocal rank fusion. An LLM (if configured) first turns the question into English search terms, so questions can be asked in any language.
- **Chat.** The top results are fetched in full and given to the LLM together with documents linked from them. Answers carry `[ref:library/slug]` markers that the UI renders as chips; clicking one opens the source document. A brainstorm mode and a "pinned documents" mode are available, and a chat can be published as an `insight` document into a dedicated insights library, linked to the documents it cited.
- **MCP.** Eleven tools (`ask_lore`, `search_docs`, `get_document`, `find_related_docs`, `get_document_diff`, ...) over Streamable HTTP, SSE or stdio.

## Quick start (Docker Compose)

Requirements: Docker with Compose. An LLM is optional: any OpenAI-compatible endpoint works (OpenRouter by default, or a local server such as Ollama). Without one, search, MCP and pushing work, and the chat shows search results instead of written answers.

```sh
git clone https://github.com/ai-pipes/lore.git && cd lore
cp .env.example .env
sed -i.bak "s|^LORE_API_KEY=.*|LORE_API_KEY=$(openssl rand -hex 32)|" .env   # break-glass admin key, required
# the first admin user (password at least 12 characters)
printf 'LORE_ADMIN_LOGIN=admin\nLORE_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 16)" >> .env
# optional, for written chat answers and semantic search (OpenRouter), add to .env:
#   LLM_API_KEY=sk-or-...
#   LLM_MODEL=anthropic/claude-sonnet-4.5
#   LORE_EMBEDDING_PROVIDER=openai-compatible
#   LORE_EMBEDDING_MODEL=openai/text-embedding-3-small
docker compose up -d --build
curl http://localhost:4737/health/ready        # {"status":"ok"}
```

<http://localhost:4737> redirects to the sign-in page (`/login`); sign in with `LORE_ADMIN_LOGIN` and the password from `.env` (`grep ^LORE_ADMIN_PASSWORD= .env`). From there an admin adds users (**Users**), namespaces and project keys (**Namespaces & keys**), and everyone creates personal tokens for MCP and scripts (**Tokens**). To sign in through your identity provider instead of passwords, see [Single sign-on](#single-sign-on-oidc).

API clients send `Authorization: Bearer <token>`: a user's personal `sk_` token, a project key `lpk_` (pushes only), or the break-glass admin key `LORE_API_KEY`.

Compose refuses to start without `LORE_API_KEY`, and the server (which runs with `NODE_ENV=production` in the image) rejects well-known defaults such as `changeme` and keys shorter than 24 characters. Load the key into your shell for the commands below: `export $(grep ^LORE_API_KEY= .env)`.

Compose builds the image from source; to run a released image instead, put `image: ghcr.io/ai-pipes/lore:0.2` in place of `build: .` (see [Released images](#released-images)). Compose runs Lore and `pgvector/pgvector:pg17`. Migrations run on startup. Ports are published on `127.0.0.1` only: `4737` (HTTP API + chat UI), `4738` (MCP), `5433` (Postgres). Embeddings default to the offline `hash` provider; set `LORE_EMBEDDING_PROVIDER=openai-compatible` together with `LORE_EMBEDDING_MODEL` and `LLM_API_KEY` (OpenRouter by default) for semantic search. For a fully local setup point `LLM_BASE_URL` at the host's Ollama (`http://host.docker.internal:11434/v1`, plus `LLM_MODEL`) and use `LORE_EMBEDDING_PROVIDER=ollama`; from inside Compose `localhost` is the container itself, so Compose passes `LORE_OLLAMA_URL=http://host.docker.internal:11434` and `LORE_OLLAMA_MODEL=nomic-embed-text` by default (the Compose file maps `host.docker.internal` to the host on Linux too). To switch embedding models later, see [Changing the embedding model](#changing-the-embedding-model).

## Demo

`examples/demo-docs` contains two fictional services in Lore's format: `petstore-api` (12 documents: pets, adoption orders, refunds, an expiry job, an event, a table) and `notifications-service` (4 documents, consuming the order event). They include business rules and cross-service links, so the chat has something to answer.

With Node.js 22 on the host:

```sh
npm ci
npm run demo          # pushes to LORE_URL (default http://localhost:4737) with LORE_TOKEN, else LORE_API_KEY from .env
```

or without Node.js on the host:

```sh
for lib in petstore-api notifications-service; do
  docker compose exec -T lore sh -c "LORE_TOKEN=\$LORE_API_KEY node dist/cli.js push examples/demo-docs/$lib -l $lib -v demo-1"
done
```

Then open <http://localhost:4737> and ask, for example, "How do refunds work for delivered orders?" or "What happens after an order is placed, across services?". Or search from the shell:

```sh
curl -s -H "Authorization: Bearer $LORE_API_KEY" "http://localhost:4737/api/search?q=refund+delivered+order" | jq '.groups[].results[].slug'
```

For a bigger dataset (seven services, releases with diffs, a feature branch) with a local LLM and no API key, see [examples/showcase](examples/showcase/).

`npm run demo` always talks to `LORE_URL` (default `http://localhost:4737`), never to the server stored by `lore login`, so the local `LORE_API_KEY` is not sent elsewhere.

## Users and roles

Every reader signs in. A user has a login, a display name, a role and a sign-in method:

- **member** — reads all docs, searches, chats (with a private chat history), publishes insights and manages their own personal tokens.
- **admin** — everything a member does, plus pushing docs to any namespace, the **Users** page (`/admin/users`: add users, reset passwords, unlock a locked password sign-in, change roles, disable and enable) and the **Namespaces & keys** page (`/admin/namespaces`).

With passwords (the default, no OIDC settings), the first admin comes from `LORE_ADMIN_LOGIN` / `LORE_ADMIN_PASSWORD` when the database has no users yet; admins add everyone else. Passwords are 12 to 1024 characters and stored as scrypt hashes; ten failed sign-ins from one IP address within 15 minutes lock that address out for 15 minutes. Disabling a user ends their web sessions at once and makes their `sk_` tokens stop working (on `/api` and MCP); enabling them again restores the tokens. Nobody can disable themselves.

**Personal tokens** (`sk_…`, the **Tokens** page `/tokens`) authenticate MCP clients, the CLI and scripts as their owner. A token is shown once, together with a ready `claude mcp add …` command, never expires and can be revoked at any time (tokens minted by `lore login` expire, see below). Tokens are created, listed and revoked only from a signed-in browser session, so a leaked token cannot mint more.

**Chat history is per user**: everyone sees only their own sessions, and another user's session id answers 404.

## Single sign-on (OIDC)

SSO is optional. When `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are all set, the web UI signs in **only** through the identity provider (Authorization Code + PKCE S256, with state and nonce). Setting some but not all three, or SSO without `PUBLIC_URL`, is a startup error.

What changes in SSO mode:

- The sign-in page shows one "Sign in with SSO" button; `POST /api/auth/login` answers `403 sso_only`. Existing `sk_` tokens (also of users created with a password before SSO) keep working.
- Access and role come from the person's groups: a member of `OIDC_ADMIN_GROUP` is an admin, a member of `OIDC_LOGIN_GROUP` a member, anyone else is refused. The role is re-synced on every sign-in. A known person who left both groups is refused and loses their web sessions; their tokens are not revoked, so disable the user on the Users page to off-board them completely. SSO web sessions also end on their own: 24 hours after sign-in at the latest (`LORE_SSO_SESSION_MAX_HOURS`), however active the person is, so the next request sends them to the provider again and their groups and role are re-read.
- The first sign-in of an unknown person creates a user. Its login is `preferred_username`, else the local part of a verified email, else `sub`, normalized, with `-2`, `-3`, … on collision.
- People are managed in the provider: adding users and resetting passwords answer `409 sso_managed`. Disabling and enabling still work and win over group membership.
- `LORE_ADMIN_LOGIN` / `LORE_ADMIN_PASSWORD` are ignored (with a warning); the first admin is whoever signs in as a member of `OIDC_ADMIN_GROUP`. Starting a sign-in is limited to 30 per IP address per 10 minutes.

### Provider setup

1. Create two groups: `lore-users` (may sign in) and `lore-admins` (may sign in, and are admins).
2. Create a confidential OIDC client (Authorization Code with a client secret, PKCE allowed) with the redirect URI `<PUBLIC_URL>/api/auth/sso/callback`, and make the provider put the groups into the ID token or the UserInfo response (claim `groups` by default).
3. Set `PUBLIC_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` in `.env` (next to `docker-compose.yml`, which forwards them and the optional `OIDC_*` variables below to the `lore` service) and recreate the container (`docker compose up -d`). The startup log says `Sign-in: single sign-on via <issuer>` or `Sign-in: password` (a partial setting is a configuration error); check with `docker compose exec lore env | grep -E '^(PUBLIC_URL|OIDC_)'` that the values arrived.

**Example: Pocket ID** (the reference provider) at `https://id.example.com`, Lore at `https://lore.example.com`:

1. In Pocket ID, **User Groups** → create `lore-users` and `lore-admins` and add people to them.
2. **OIDC Clients** → add a client "Lore" with the callback URL `https://lore.example.com/api/auth/sso/callback`; keep it confidential (not a public client) and copy the client ID and secret. Pocket ID puts the `groups` claim into the token when the `groups` scope is requested, which Lore does by default.
3. `.env`:

   ```sh
   PUBLIC_URL=https://lore.example.com
   OIDC_ISSUER=https://id.example.com
   OIDC_CLIENT_ID=<client id>
   OIDC_CLIENT_SECRET=<client secret>
   # Lore is published on 127.0.0.1:4737; a TLS-terminating reverse proxy serves
   # https://lore.example.com, forwards the Host header and needs the Secure cookie flag:
   LORE_COOKIE_SECURE=true
   ```

4. `docker compose up -d`, open `https://lore.example.com`, and sign in with SSO as a member of `lore-admins`: that person becomes the first admin.

Other providers: Authentik, Authelia and Kanidm work with the defaults; Keycloak needs a client scope `groups` with a Group Membership mapper (claim name `groups`, "Full group path" off); for providers that name the claim differently set `OIDC_GROUPS_CLAIM` (and `OIDC_SCOPES`).

| Variable | Default | Meaning |
|----------|---------|---------|
| `PUBLIC_URL` | unset (required with SSO) | The URL people open Lore at; the redirect URI is `${PUBLIC_URL}/api/auth/sso/callback`. Also the base of the CLI's approval link. |
| `OIDC_ISSUER` | unset | Issuer URL; discovery at `<OIDC_ISSUER>/.well-known/openid-configuration`. |
| `OIDC_CLIENT_ID` | unset | Client ID of the confidential client. |
| `OIDC_CLIENT_SECRET` | unset | Client secret. |
| `OIDC_LOGIN_GROUP` | `lore-users` | Members may sign in (as members). |
| `OIDC_ADMIN_GROUP` | `lore-admins` | Members may sign in and are admins. |
| `OIDC_SCOPES` | `openid profile email groups` | Requested scopes (`openid` is required). |
| `OIDC_GROUPS_CLAIM` | `groups` | Claim with the groups: a list of names, or an object whose keys are the names. |
| `OIDC_ALLOW_INSECURE` | `false` | Allow a plain-`http` issuer (private networks and tests only). |

**Existing users.** A provider account is identified by the issuer and its subject (`sub`). To let an existing (password) user sign in with SSO and keep their tokens and chats, link them before their first SSO sign-in, where the database is reachable and the OIDC settings are set:

```sh
docker compose exec lore node dist/cli.js link-sso alice 3f2a…   # the provider's "sub" of alice
docker compose exec lore node dist/cli.js unlink-sso alice
```

After changing `OIDC_ISSUER`, users linked to the old issuer are not found any more; link them again.

**Role changes take effect at the next sign-in.** Moving a person between `OIDC_ADMIN_GROUP` and `OIDC_LOGIN_GROUP` (or out of both) is applied when they next sign in with SSO. An SSO web session lives at most `LORE_SSO_SESSION_MAX_HOURS` hours (default 24) in total, so a role change or removal from the groups reaches the web UI within that time; their `sk_` tokens keep the old role until revoked. **Offboarding:** remove the person from the groups at the provider and also disable the user on the Users page: that ends their web sessions and stops their `sk_` tokens (CLI, MCP, scripts) immediately; the group change alone does not touch tokens. There is no last-admin guard: if nobody is in `OIDC_ADMIN_GROUP` any more, the break-glass `LORE_API_KEY` still works for the admin API.

### Troubleshooting

A failed SSO sign-in returns to `/login?loginError=<code>`, and the page shows a fixed message:

| `loginError` | Message | Likely cause |
|--------------|---------|--------------|
| `invalid_state` | The sign-in attempt expired or did not start in this browser. | The attempt is older than 10 minutes, the `lore_sso` cookie was lost (different host than `PUBLIC_URL`, blocked cookies), the callback was replayed, or the provider rejected the code exchange (wrong client secret or redirect URI). |
| `not_allowed` | Your account is not in a group that may use Lore. | The person is in neither `OIDC_LOGIN_GROUP` nor `OIDC_ADMIN_GROUP`, or the provider does not send the groups claim (check `OIDC_SCOPES` / `OIDC_GROUPS_CLAIM`). |
| `disabled` | Your account is disabled. | An admin disabled the user on the Users page. |
| `idp_unavailable` | The identity provider is unavailable right now. | Lore cannot reach `OIDC_ISSUER` (discovery or token endpoint): network, DNS or TLS; a plain-`http` issuer needs `OIDC_ALLOW_INSECURE=true`. |
| `rate_limited` | Too many sign-in attempts. | More than 30 sign-in starts from one IP address in 10 minutes. |
| `internal` | Sign-in failed. | Anything else; details are in the server log. |

If signing in succeeds but you land on the sign-in page again, the session cookie was not kept: open Lore at `PUBLIC_URL` (same scheme and host). Behind a TLS-terminating proxy set `LORE_COOKIE_SECURE=true`, and set `LORE_TRUST_PROXY` to the proxies' addresses (IPs or CIDRs) so that Lore takes the client address from `X-Forwarded-For`. Without it every request comes from the proxy's address and the per-IP limits (SSO start, CLI login, concurrent password sign-ins) are shared by everyone. Never set it when clients reach Lore directly: they could then choose their own address.

## Project keys and namespaces

Each service owns one **library**, and every library belongs to one **namespace** (an admin-defined group of libraries, for example per team). Existing libraries are in `default`; `insights` is the system namespace for published chats and takes no pushes.

CI pushes with a **project key** (`lpk_…`): it belongs to one namespace (optionally to one library of it) and may only push there, including creating a new library inside its namespace on the first push. Pushing to a library of another namespace, or creating a library id that already exists elsewhere, gets 403. A project key cannot read docs, chat, use MCP or the admin API (403 on `/api`, 401 on MCP). Every push checks the key and the library's namespace again, so a revoked key or a library moved to another namespace stops the next push at once. Only the key's SHA-256 is stored, and it is shown once.

An admin creates namespaces and keys on the **Namespaces & keys** page, or with the CLI:

```sh
lore namespace create payments --name "Payments"
lore namespace assign orders-api payments          # move an existing library
lore project-key create payments --name github-ci  # prints lpk_… once
lore project-key list
lore project-key revoke <id>
```

Store the key as a CI secret (`LORE_PROJECT_KEY` below). In the service's pipeline, use the released image — no need to build Lore:

```yaml
# .github/workflows/docs.yml (in the service repository)
name: docs
on:
  push:
    branches: [main]
jobs:
  push-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Push docs to Lore
        env:
          LORE_URL: ${{ secrets.LORE_URL }}
          LORE_TOKEN: ${{ secrets.LORE_PROJECT_KEY }}
        run: |
          docker run --rm -v "$PWD/docs:/docs:ro" -e LORE_URL -e LORE_TOKEN \
            ghcr.io/ai-pipes/lore:0.2 \
            node dist/cli.js push /docs -l orders-api -v "${{ github.sha }}" -b "${{ github.ref_name }}"
```

The same works anywhere Docker runs (GitLab CI, Jenkins, a laptop). Without Docker, check out this repository and run `npm ci && npm run build && node dist/cli.js push ...`. Admins may also push with their own token; `--namespace <id>` puts a new library into a namespace (a project key always uses its own).

For feature branches add `--no-promote`: the version is stored but does not become current; the chat API and MCP tools accept a `branch` argument to query it.

The document format (frontmatter fields, recommended sections, slug conventions, dependency patterns) is described in [docs/usage.md](docs/usage.md). A minimal document:

```markdown
---
slug: orders/refund-order
domain: orders
entry_type: handler
handler_class: RefundOrderHandler
http_method: POST
route: /api/v1/orders/{orderId}/refund
summary: Refunds the adoption fees of a delivered order within 14 days
category: specification
links:
  - slug: notifications/send-notification
    library: notifications-service
    type: calls
---

# RefundOrderHandler

## Business Logic

1. The order must be delivered at most 14 days ago.
...
```

## Generating docs (example generator)

Lore stores and serves docs; producing them is up to you. `examples/generator` is a working example of the generation side: it reads an OpenAPI spec, asks an OpenAI-compatible LLM to write one document per endpoint (interfaces, dependencies, business logic) using the `generator/endpoint-doc` prompt, writes the files in Lore's format and optionally pushes them.

The generator uses the same LLM settings as the server (`LLM_API_KEY` and/or `LLM_BASE_URL`, OpenRouter by default). The model comes from `--model`, else `GENERATOR_MODEL`, else `LLM_MODEL`; with a key or base URL but no model it exits with an error.

```sh
# Without an API key (or with --dry-run): deterministic skeletons from the spec
npx tsx examples/generator/generate.ts \
  --spec examples/generator/petstore.openapi.json \
  --service petstore-api --out generated-docs/petstore-api --dry-run

# With an LLM, including source files that mention each operationId, and push
LLM_API_KEY=sk-or-... LORE_URL=https://lore.example.com LORE_TOKEN=lpk_... \
npx tsx examples/generator/generate.ts \
  --spec openapi.json --service petstore-api --out generated-docs/petstore-api \
  --source-dir src --model openai/gpt-4o-mini --push --version $(git rev-parse HEAD)
```

Output from the LLM is validated (the frontmatter must parse and keep the expected slug; links to unknown slugs are dropped); anything invalid falls back to the skeleton. `examples/generator/github-workflow.yml` is a ready-to-copy workflow that runs a dry run on pull requests and generates + pushes on merge to `main`.

## Chat

The chat UI is served at `/`. It needs an LLM for written answers: set `LLM_API_KEY` and `LLM_MODEL` (the endpoint defaults to OpenRouter, `https://openrouter.ai/api/v1`), or `LLM_BASE_URL` and `LLM_MODEL` for any other OpenAI-compatible server. `LLM_MODEL` has no default and is required once the LLM is configured. Without an LLM it still runs the search and shows the results panel.

```sh
# OpenRouter
LLM_API_KEY=sk-or-... LLM_MODEL=anthropic/claude-sonnet-4.5
LORE_EMBEDDING_PROVIDER=openai-compatible LORE_EMBEDDING_MODEL=openai/text-embedding-3-small

# Local Ollama (no key); from Compose use http://host.docker.internal:11434 instead of localhost
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3.1
LORE_EMBEDDING_PROVIDER=ollama
```

- **Q&A** answers only from the retrieved documents and cites each one with a chip. If the docs do not contain the answer it says so.
- **Brainstorm** reasons more freely about design and trade-offs, citing only facts taken from documents.
- **Context**: pin documents from the results panel to discuss exactly those; the assistant can suggest more documents to pin.
- **Publish**: summarises the conversation into an `insight` document in the insights library (`LORE_INSIGHTS_LIBRARY`, default `insights`, created in — or moved into — the system namespace `insights` at startup; its id is reserved, so no push by anyone may create or write a library with that id in any namespace), with links to the documents the chat cited or pinned, optionally tagged with a related service. Insights live outside service libraries (in the system namespace `insights`), so `lore push` never deletes them, and no push route may write there. Every signed-in user may publish their own chats; an insight records its author (user id and display name). Members always publish to `insight/<chat id>` and cannot overwrite an existing insight; only admins can choose a slug or overwrite.

## CLI

The `lore` CLI (`node dist/cli.js`, also in the image) talks to the server over HTTP and always authenticates.

```sh
lore login --url https://lore.example.com   # opens the browser; approve "Sign in the CLI on <hostname>"
lore whoami                                 # alice (admin) at https://lore.example.com
lore push ./docs -l orders-api -v "$(git rev-parse HEAD)"
lore logout                                 # revokes the token on the server and deletes the file
```

`lore login` is a device login: the CLI prints a short code (`BCDF-GHJK`) and opens the approval page (`/cli/login`; the CLI opens the server's URL only when it is http(s) on the same origin as the server it signs in to, without a shell — `rundll32 url.dll,FileProtocolHandler` on Windows — and otherwise just prints `<server>/cli/login`), where you sign in (password or SSO) and type the code yourself (links never carry it, so nobody can send you a ready-made approval link). The page then shows the hostname the CLI reported (not verified) and the IP address the request came from; approve only a request you just started. The CLI polls every 5 seconds; the request expires after 10 minutes. On approval the server mints one personal token named `cli-<hostname>` that expires after `LORE_CLI_TOKEN_TTL_DAYS` days (default 90; visible and revocable on the Tokens page; run `lore login` again when it expires), and the CLI stores it with the server URL in `~/.config/lore/credentials.json` (mode 600, directory 700). `lore login --token <sk_… or lpk_…>` stores a pasted token instead.

Where a command gets its server and token:

- the server is `--url`, else `LORE_URL`, else the one in the credentials file, else `http://localhost:4737`;
- the token is `LORE_TOKEN`, else the credentials file's — but only when the file is for that same server. Otherwise the command stops with `not logged in to <url>`, so a stored token is never sent to another server.

In CI set `LORE_URL` and `LORE_TOKEN` (a project key). The server checks roles: `push` needs an admin or a project key of the library's namespace, `namespace` and `project-key` need an admin. Server-side commands (`serve`, `mcp`, `status`, `link-sso`, `unlink-sso`, `reindex-embeddings`) use the database directly. The full command reference is in [docs/usage.md](docs/usage.md).

## MCP

`lore serve` exposes MCP on port `4738` at `/mcp` (Streamable HTTP) and `/sse` (legacy SSE). Every request needs `Authorization: Bearer <token>` with a personal `sk_` token (create one on the Tokens page, `/tokens`, which also shows the ready `claude mcp add …` command) or the admin key `LORE_API_KEY`. Anything else, including project keys and tokens of disabled users, gets 401.

Tokens run as their owner: chat state they create belongs to that user, and a disabled user's token stops working. Claude Code, with the command the Tokens page shows (`LORE_MCP_PUBLIC_URL` sets its URL):

```sh
claude mcp add --transport http lore http://localhost:4738/mcp \
  --header "Authorization: Bearer sk_..."
```

Or run it over stdio against the database directly (no HTTP server needed):

```sh
npm ci && npm run build
claude mcp add lore -e DATABASE_URL=postgres://lore:lore@localhost:5433/lore \
  -e LORE_EMBEDDING_PROVIDER=hash -- node "$PWD/dist/cli.js" mcp
```

The full tool list and the HTTP API are in [docs/integration.md](docs/integration.md).

## Configuration

All settings are environment variables (see `.env.example`). An empty value counts as unset.

| Variable | Default | Meaning |
|----------|---------|---------|
| `DATABASE_URL` | required | Postgres with the `vector` extension. Compose sets it. |
| `LORE_API_KEY` | required for `serve` and Compose | Break-glass admin bearer for bootstrap and scripts: pushes to any namespace and uses the admin API, but has no user (no chat). At least 24 characters, not a default value, in production. |
| `LORE_ADMIN_LOGIN`, `LORE_ADMIN_PASSWORD` | unset | The first admin user, created by `serve` when there are no users yet (password mode). Set both or neither; the password needs at least 12 characters. Ignored in SSO mode. |
| `PUBLIC_URL` | unset (required with SSO) | The URL people open Lore at: the SSO redirect URI and the CLI approval link are built from it (else from the request). |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | unset | Single sign-on; all three or none. See [Single sign-on](#single-sign-on-oidc) for these and `OIDC_LOGIN_GROUP`, `OIDC_ADMIN_GROUP`, `OIDC_SCOPES`, `OIDC_GROUPS_CLAIM`, `OIDC_ALLOW_INSECURE`. |
| `LORE_COOKIE_SECURE` | `false` (auto when the request is https) | Force the `Secure` flag on the session cookie, e.g. behind a TLS-terminating proxy. |
| `LORE_TRUST_PROXY` | unset (no proxy trusted) | Reverse proxies whose `X-Forwarded-For` / `X-Forwarded-Proto` Lore believes: comma-separated proxy IPs/CIDRs (for a proxy on the Compose network, e.g. `172.16.0.0/12`). The sign-in limits key on the client address this yields. `true` and hop counts are refused: a hop count cannot check who sent the headers. |
| `LORE_DEVICE_COOKIE_SECRET` | derived from `LORE_API_KEY` | Signs the known-device cookies of password sign-in (at least 32 characters). Set it to keep devices known across admin-key rotations. |
| `LORE_SSO_SESSION_MAX_HOURS` | `24` | Absolute lifetime in hours (1-720) of a web session started through SSO, on top of the 7-day sliding window: after it the person must sign in at the identity provider again. Password sessions are not affected. |
| `LORE_CLI_TOKEN_TTL_DAYS` | `90` | Lifetime in days (1-3650) of the `cli-<hostname>` tokens `lore login` mints. Tokens created on the Tokens page never expire. |
| `LORE_ALLOWED_ORIGINS` | none | Extra browser `Origin`s accepted on state-changing requests (CSRF check), e.g. when a proxy rewrites `Host`. |
| `LORE_INSIGHTS_LIBRARY` | `insights` | Library that receives published chats. |
| `LORE_PORT` | required for `serve` (`4737` in Compose) | HTTP API + chat UI port. |
| `LORE_HOST` | `0.0.0.0` | Interface for the HTTP API. |
| `LORE_MCP_PORT` | required for `serve` (`4738` in Compose) | MCP HTTP port. |
| `LORE_MCP_HOST` | `127.0.0.1` | Interface for MCP HTTP. Compose uses `0.0.0.0` inside the container. |
| `LORE_MCP_PUBLIC_URL` | `http://localhost:<LORE_MCP_PORT>/mcp` | The MCP URL clients use, shown in the Tokens page's `claude mcp add` command. |
| `LORE_MCP_ALLOWED_HOSTS` | loopback names when bound to loopback | Comma-separated accepted `Host` values (DNS-rebinding protection). |
| `LORE_MCP_ALLOWED_ORIGINS` | none | Comma-separated browser `Origin`s allowed to call MCP. |
| `LORE_STORAGE_PATH` | `./storage` | Directory for uploaded images (content-addressed). |
| `LORE_EMBEDDING_PROVIDER` | `none` (`hash` in Compose) | `openai-compatible` (needs `LORE_EMBEDDING_MODEL`; `LORE_EMBEDDING_BASE_URL` / `LORE_EMBEDDING_API_KEY` fall back to `LLM_BASE_URL` / `LLM_API_KEY`, default endpoint OpenRouter), `ollama`, `hash` (offline, deterministic, lexical only) or `none` (full-text only). |
| `LORE_EMBEDDING_BASE_URL` | `LLM_BASE_URL`, else `https://openrouter.ai/api/v1` | Endpoint for `openai-compatible` embeddings. |
| `LORE_EMBEDDING_API_KEY` | `LLM_API_KEY` | Key for `openai-compatible` embeddings. With no key and no base URL, startup warns: OpenRouter rejects keyless requests. |
| `LORE_EMBEDDING_MODEL` | required for `openai-compatible` | Embedding model id, e.g. `openai/text-embedding-3-small`. Vectors are stored tagged with the model and can have any dimension. |
| `LORE_OLLAMA_URL` | `http://localhost:11434` | Ollama server for `ollama` embeddings. |
| `LORE_OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model. |
| `LORE_VECTOR_MIN_SCORE` | `0.2` for `hash`, `0` otherwise | Minimum cosine similarity for a vector hit. |
| `LORE_SEARCH_DROP_FACTOR` | `0.80` | In FTS-only or vector-only mode, drop results below top score × factor. |
| `LLM_API_KEY` | unset | Key of the OpenAI-compatible chat endpoint. Setting it or `LLM_BASE_URL` turns the LLM on; `LLM_MODEL` is then required. |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | Base URL of an OpenAI-compatible endpoint (e.g. `http://localhost:11434/v1`). Setting it (with `LLM_MODEL`) enables the LLM; a local server needs no key. |
| `LLM_MODEL` | none, required when the LLM is configured | Chat / enrichment model, e.g. `anthropic/claude-sonnet-4.5`. Startup fails if the LLM is configured without it. |
| `LORE_PROMPTS_DIR` | unset | Directory with prompt overrides (see below). |
| `LORE_DEFAULT_PROMPTS_DIR` | `./prompts` or next to `dist/` | Location of the shipped templates. |
| `LORE_PROMPT_VAR_<NAME>` | see below | Global prompt variable `<name>`. |
| `LORE_VENDOR_DIR` | `dist/vendor` or `node_modules` | Location of the bundled UI libraries. |
| `LORE_MIGRATIONS_DIR` | `./drizzle` or next to `dist/` | Location of the SQL migrations. |
| `LOG_LEVEL` | `info` | Log level when `NODE_ENV=production`. |
| `NODE_ENV` | unset | `production` for JSON logs; `test` enables a reset endpoint used by e2e tests — never set it on a real server. |
| `LORE_URL` | the credentials file's, else `http://localhost:4737` | CLI: server URL. |
| `LORE_TOKEN` | the credentials file's (same server only) | CLI: token (`sk_…` personal, `lpk_…` project key in CI). |
| `GIT_BRANCH` | unset | CLI: default for `lore push --branch`. |
| `GENERATOR_MODEL` | `LLM_MODEL` | Example generator: model name. |

Removed: `LORE_READ_KEY` (reading needs a signed-in user or a token), `LORE_MCP_API_KEY` (MCP checks tokens against the database) and `OPENAI_API_KEY` (use `LLM_API_KEY` / `LORE_EMBEDDING_API_KEY`); the server warns at startup if any of them is still set (`reindex-embeddings` warns about `OPENAI_API_KEY` too). `LORE_EMBEDDING_PROVIDER=openai` is also removed: use `openai-compatible` (startup fails with an error naming it). There is no default model or OpenAI default endpoint any more.

### Changing the embedding model

Vectors are stored with the id of the model that produced them (`openai-compatible:<model>`, `ollama:<model>`, `hash:<dimensions>`) and may have any dimension. To switch models, change `LORE_EMBEDDING_PROVIDER` and the related variables, restart, then run:

```sh
docker compose exec lore node dist/cli.js reindex-embeddings        # documents whose vector for the current model is missing or stale
docker compose exec lore node dist/cli.js reindex-embeddings --all  # force re-embedding of every document
```

After upgrading to the version that introduced model-tagged vectors, existing vectors have no model tag and are ignored by vector search until `lore reindex-embeddings` has been run once.

Until it finishes, vector search finds only documents already embedded with the new model; full-text search finds all of them.

## Customizing prompts

Every LLM prompt is a Markdown template under [`prompts/`](prompts), addressed by its path without `.md`. Point `LORE_PROMPTS_DIR` at a directory with files of the same relative names to override them; files you do not provide fall back to the defaults.

```sh
mkdir -p my-prompts/chat
cp prompts/chat/system.md my-prompts/chat/system.md   # edit it
LORE_PROMPTS_DIR=$PWD/my-prompts npm run dev
```

With Compose, mount the directory and set the variable in a `docker-compose.override.yml`:

```yaml
services:
  lore:
    volumes: ["./my-prompts:/prompts:ro"]
    environment: { LORE_PROMPTS_DIR: /prompts }
```

Templates use `{{variable}}`. Substitution is a single pass: inserted values (for example document content) are never re-scanned. Unknown variables are left as they are and logged once. A leading `<!-- ... -->` comment is stripped, so you can document a template in place.

**Global variables**, available in every template, set with `LORE_PROMPT_VAR_<NAME>` or a `variables.json` (flat JSON object) in `LORE_PROMPTS_DIR`:

| Variable | Default |
|----------|---------|
| `assistant_name` | `Lore` |
| `example_library` | `orders-api` |
| `example_slug` | `orders/refund-create` |
| `example_dotted` | derived: `orders-api.orders.refund-create` |
| `example_related_slug` | `orders/refund-webhook` |
| `example_entity` | `orders` |
| `example_queue` | `order-events` |

**Prompts:**

| Name | Used for | Call variables |
|------|----------|----------------|
| `chat/system` | System message, Q&A mode | — |
| `chat/context` | System message when documents are pinned | — |
| `chat/brainstorm` | System message, brainstorm mode | — |
| `chat/tool-get-document` | Description of the chat `get_document` tool | — |
| `chat/tool-list-libraries` | Description of the chat `list_libraries` tool | — |
| `search/extract-terms` | Turning a question into English search terms | — (question is the user message) |
| `publish/summary` | Summarising a chat into an insight document | — (transcript is the user message) |
| `enrichment/links` | Extracting links between documents after a push | `slug`, `domain`, `summary`, `content`, `known_slugs`, `link_types` |
| `generator/endpoint-doc` | Example generator, one document per endpoint | `service`, `http_method`, `route`, `operation_id`, `slug`, `domain`, `entry_type`, `handler_class`, `operation`, `components`, `known_slugs`, `source_code` |
| `mcp/<tool>` | MCP tool descriptions: `ask_lore`, `search_docs`, `get_document`, `list_libraries`, `list_endpoints`, `get_library_overview`, `find_related_docs`, `find_by_data_source`, `find_by_external_dependency`, `get_service_topology`, `get_document_diff` | — |

The chat relies on the `[ref:library_id/slug]` and `[suggest:library_id.slug]` marker formats and on the section names Lore puts into the context (`## Relevant documentation`, `## Full document content (auto-fetched)`, `## Pinned documentation`); keep them when you rewrite the chat prompts.

## Security

- **Every route has an access policy** (`src/platform/http/route-policy.ts`); a route without one stops the server from starting. Only `/health*`, `/login`, `/assets/*`, the sign-in API and the CLI device-login start/poll are public. Everything else needs a caller: a web session, a bearer `sk_` token, a project key `lpk_` or the admin key `LORE_API_KEY`. Anonymous API calls get 401 and pages redirect to `/login`.
- **Authorization matrix:**

  | Caller | Read docs/search | Chat (own history) | Push | Admin (users, namespaces, keys) |
  |---|---|---|---|---|
  | Signed-in member / member `sk_` token | all | yes | no | no |
  | Admin (session, `sk_` incl. CLI login) / `LORE_API_KEY` | all | yes (the admin key has no user: no chat) | any namespace | yes |
  | Project key | push-related only | no | own namespace | no |
  | Anonymous | no (except `/login`, `/health*`, static assets) | no | no | no |

  Nobody, the admin key included, pushes to the `insights` namespace; insights are written only by publishing a chat. Creating, listing and revoking personal tokens needs a web session. Creating users (`POST /api/users`), resetting passwords (`POST /api/users/:id/password`) and changing roles (`role` in `PATCH /api/users/:id`) need an **admin session**: an admin signed in to the web UI, or the break-glass `LORE_API_KEY`; an admin's `sk_` token (CLI, scripts, MCP) gets 403 there.
- **Hashing.** Passwords use scrypt (`N=2^15, r=8, p=1`, 16-byte salt). Tokens, project keys, session ids and device codes are random (`prefix + 32 bytes`, base64url) and stored only as SHA-256 hex; nothing secret is stored in plaintext, and new tokens and keys are shown once.
- **Password resets.** An admin resetting someone's password ends that person's web sessions and revokes all their personal `sk_` tokens (MCP clients, scripts and `lore login` must be set up again). An admin changing their own password on the Users page must give their current password; wrong ones count against the same per-login lock as sign-in, and the attempt that finds the login locked also ends the caller's web sessions.
- **Sessions.** The `lore_session` cookie is HttpOnly, SameSite=Lax, `Path=/`, `Secure` over https or with `LORE_COOKIE_SECURE=true`, and lasts 7 days, sliding; a session started through SSO also ends 24 hours after sign-in (`LORE_SSO_SESSION_MAX_HOURS`). Signing out or disabling the user ends the session. Tokens of disabled users are rejected on `/api` and MCP.
- **Project-key scope.** A project key pushes only to libraries of its namespace (or its one library) and reads only what `lore push` needs; each request re-checks the key and the library's namespace, so revoking a key or moving a library takes effect on the next request.
- **Rate limits** (password sign-in follows OWASP's "device cookies" model). Every attempt is counted before the password is checked, so concurrent guesses cannot overshoot a limit; a successful sign-in gives its attempt back (the limits count failures); every refusal is `429` with `Retry-After` and runs no KDF.
  - **Per login:** 10 failures in 15 minutes lock the login for 15 minutes for every client — even with the right password — except known devices. The counter is keyed by an HMAC of the normalized login, so an unknown login is limited exactly like an existing one (and still costs one dummy password verify).
  - **Known devices:** a successful sign-in sets `lore_device`, an HMAC-signed cookie (user id, random device id, 90-day expiry; HttpOnly, SameSite=Lax, sent only to `/api/auth/login`). A browser presenting a valid one for that user is not subject to the login's lock but to its own limit of 10 failures per 15 minutes. The signing key is `LORE_DEVICE_COOKIE_SECRET`, else derived from `LORE_API_KEY` (rotating it voids all device cookies); never stored.
  - **Per client address:** 50 failures across all logins in 15 minutes lock the address (password spraying); this also bounds how many login counters one address can create. At most 4 sign-ins run at once per address. 30 SSO starts and 30 CLI login starts per 10 minutes.
  - **Unlock:** an admin lifts a login's lock with **Unlock sign-in** on the Users page or `POST /api/users/:id/unlock`.
  - The counters live in memory (per process), O(1) per attempt, in three capped maps: keys seen once (an LRU that absorbs floods of fresh keys), keys with a failure on record (a larger map that fresh keys never evict; only expiry or, when it is full as well, its oldest entry, with a warning in the log) and locks (kept until they expire). Expired entries are swept at most once per window. The client address is the TCP peer unless `LORE_TRUST_PROXY` names the proxy in front.
- **CSRF**: API routes accept only JSON (and multipart for uploads); state-changing requests with a cross-site `Origin` or `Sec-Fetch-Site: cross-site` are rejected. The SSO login binding cookie `lore_sso` (SameSite=Lax, 10 minutes) ties the callback to the browser that started it; the CLI approval page shows the hostname and code so a person can spot a phishing attempt.
- **MCP over HTTP** requires a bearer token (`sk_` or the admin key), binds to `127.0.0.1` by default, sends no CORS headers and validates `Host` and `Origin` against allowlists.
- **Chat UI**: everything is served by Lore itself — marked, DOMPurify, highlight.js and mermaid are bundled from npm — so the page makes no external requests and runs under `default-src 'self'` with no inline scripts or styles (`frame-ancestors 'none'`). Markdown is sanitized with DOMPurify, and citation/suggestion chips are built with DOM APIs from validated ids. Mermaid runs in strict mode; diagram directives (`%%{init}%%`) are stripped and styles from rendered diagrams are discarded (diagrams use a fixed stylesheet).
- **Images** are accepted only as PNG, JPEG, GIF or WebP, detected by file signature (SVG is rejected), and served with `X-Content-Type-Options: nosniff` and a sandbox CSP.
- **Errors**: 5xx responses carry a generic message; details go to the server log.
- Documents you push are sent to your LLM provider when the chat, enrichment or the generator use them.
- `LORE_API_KEY` must be strong: with `NODE_ENV=production` the server refuses to start with a well-known default or a key shorter than 24 characters; in development it warns. Compose has no default key.

Please report vulnerabilities privately via GitHub security advisories of this repository.

## Released images

Tagged releases (`vX.Y.Z`) publish a multi-arch image (linux/amd64, linux/arm64) to `ghcr.io/ai-pipes/lore` with tags `X.Y.Z`, `X.Y` and `X`. While Lore is at 0.x, a minor release may break configuration (see the release notes), so pin `X.Y` (for example `0.2`) rather than `X` or `latest`.

```sh
docker run -d --name lore -p 127.0.0.1:4737:4737 -p 127.0.0.1:4738:4738 \
  -e DATABASE_URL=postgres://lore:lore@db.example.com:5432/lore \
  -e LORE_API_KEY="$(openssl rand -hex 32)" -e LORE_ADMIN_LOGIN=admin -e LORE_ADMIN_PASSWORD="$(openssl rand -hex 16)" \
  -e LORE_PORT=4737 -e LORE_MCP_PORT=4738 -e LORE_MCP_HOST=0.0.0.0 \
  -e LORE_MCP_ALLOWED_HOSTS=localhost:4738,127.0.0.1:4738 \
  -e LORE_EMBEDDING_PROVIDER=hash -v lore_storage:/app/storage \
  ghcr.io/ai-pipes/lore:0.2
```

The image contains the CLI too: `docker run --rm ghcr.io/ai-pipes/lore:0.2 node dist/cli.js --help`.

## Development

Requirements: Node.js 22, Docker (for Postgres).

```sh
npm ci
cp .env.example .env
docker compose up -d postgres
npm run dev                      # tsx, http://localhost:4737
npm run typecheck
npm test                         # unit + integration tests against Postgres, fully offline
npm run test:e2e                 # Playwright (npx playwright install chromium first)
npm run build                    # dist/cli.js (single bundle)
npm run verify                   # typecheck + lint + arch + test (with coverage) + build
```

Run `npm run verify` before pushing; CI runs it together with the e2e suite and the Docker build. `npm run arch` checks the architecture rules with dependency-cruiser (`.dependency-cruiser.cjs`), and `npm test` fails if coverage of the modules' domain and application layers drops below 90%. The architecture (a DDD modular monolith), the import rules and the module map are described in [CLAUDE.md](CLAUDE.md) and [docs/adr/0001-modular-monolith.md](docs/adr/0001-modular-monolith.md).

`npm test` and `npm run test:e2e` use a separate `lore_test` database (derived from `DATABASE_URL`, or `TEST_DATABASE_URL`), the offline `hash` embedding provider and no LLM; LLM calls are mocked where they are tested. `npm run test:integration` runs search-quality checks that are meant for a real embedding provider.

Project layout: `src/main.ts` (CLI entry), `src/cli` (client commands: login, logout, whoami, push, images, namespace, project-key), `src/contracts` (HTTP request/response types), `src/platform` (HTTP server, MCP, config, DB, server commands), `src/modules/catalog` (libraries, versions, documents, images, embeddings, diffs, links, topology), `src/modules/llm` (the `LanguageModel` port, its OpenAI-compatible adapter, prompts), `src/modules/identity` (users, sessions, tokens, SSO, device login, the admin key), `src/modules/search` (search pipeline), `src/modules/chat` (chat sessions, answers, insights, chat UI), `drizzle/` (SQL migrations), `prompts/` (prompt templates), `examples/` (demo docs, generator).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
