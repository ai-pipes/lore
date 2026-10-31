# Integrating with Lore

Lore integrates two ways: an HTTP API (used by `lore push` from CI/CD) and MCP (used by Claude and other AI agents). The browser chat is served at `/`.

## HTTP API

**Authentication.** Every route except `/health*`, `/login`, `/assets/*`, the sign-in API and the CLI device-login start/poll needs a caller: the `lore_session` cookie from `/login`, or a bearer token:

```
Authorization: Bearer <a user's sk_ token, a project key lpk_, or LORE_API_KEY>
```

Each route has one access level (`src/platform/http/route-policy.ts`):

- **public** — anyone.
- **read** — any user or the admin key.
- **push-read** — what `lore push` reads: any user, the admin key or a project key (a project key sees only libraries it may push to).
- **push** — an admin user, the admin key, or a project key for libraries of its namespace. Nobody pushes to the `insights` namespace.
- **chat** — a user (the admin key has no user and gets 403). Another user's session id answers 404.
- **session** — a user signed in with a web session (not a bearer token).
- **admin** — an admin user (session or `sk_`) or the admin key.

A project key gets 403 on every other route. Anonymous API calls get 401 with `WWW-Authenticate: Bearer`; pages redirect to `/login?returnTo=…`. Request bodies must be JSON (multipart for uploads), and state-changing requests with a cross-site `Origin` are rejected.

| Method | Path | Access | Description |
|--------|------|------|-------------|
| `GET` | `/health`, `/health/live`, `/health/ready` | public | Liveness / readiness (DB ping) |
| `GET` | `/login`; `POST` `/api/auth/login`, `/api/auth/logout`; `GET` `/api/auth/config` | public | Sign-in page and API. `login` takes `{ login, password }` (204 + `lore_session` cookie; 401 wrong credentials, 429 locked, 403 `sso_only` in SSO mode); `config` answers `{ method: "password" \| "sso" }` |
| `GET` | `/api/auth/sso/login?returnTo=`, `/api/auth/sso/callback` | public | Single sign-on: redirect to the provider, and back (on failure to `/login?loginError=<code>`) |
| `GET` | `/api/auth/me` | push-read | The caller: `{ kind: "user", login, display_name, role }`, `{ kind: "project", namespace, key_name, library_id }` or `{ kind: "admin-key", role: "admin" }` |
| `GET` | `/tokens`; `GET`, `POST` `/api/tokens`; `DELETE` `/api/tokens/:id` | session | The Tokens page; list, create (`{ name }` → 201 with `token` and `mcp_command`, shown once) and revoke your personal `sk_` tokens |
| `DELETE` | `/api/tokens/current` | read | Revoke the calling `sk_` token (`lore logout`); 400 for other callers |
| `POST` | `/api/cli/login/start` | public | Start a device login `{ hostname }` → `{ device_code, user_code, verification_url, interval: 5, expires_in: 600 }` |
| `POST` | `/api/cli/login/poll` | public | `{ device_code }` → `{ status: "pending" \| "denied" \| "expired" }` or, once, `{ status: "approved", token, login, role }` (the `cli-<hostname>` token) |
| `GET` | `/cli/login?code=`; `GET` `/api/cli/login/:userCode`; `POST` `/api/cli/login/approve` | session | The approval page; describe a request; approve or deny it `{ user_code, approve }` |
| `GET` | `/admin/users`; `GET`, `POST` `/api/users` | admin | The Users page; list users; add one `{ login, display_name?, password, role }` (409 `sso_managed` in SSO mode) |
| `PATCH` | `/api/users/:id` | admin | `{ display_name?, role?, disabled? }`; disabling ends the user's sessions and stops their tokens |
| `POST` | `/api/users/:id/password` | admin | Reset a password `{ password }` |
| `GET` | `/admin/namespaces`; `GET`, `POST` `/api/namespaces` | admin | The Namespaces & keys page; list namespaces with their libraries; create one `{ id, display_name }` |
| `PATCH` | `/api/namespaces/:id` | admin | Rename `{ display_name }` |
| `PUT` | `/api/libraries/:id/namespace` | admin | Move a library `{ namespace_id }` |
| `GET`, `POST` | `/api/project-keys[?namespace=]` | admin | List project keys; create one `{ namespace_id, name, library_id? }` → 201 with `key` (`lpk_…`, shown once) |
| `DELETE` | `/api/project-keys/:id` | admin | Revoke a project key |
| `GET` | `/api/libraries` | push-read | Libraries with current version and document count |
| `POST` | `/api/libraries` | push | Create a library `{ id, display_name, namespace_id? }` (201; 200 when it existed). A project key creates it in its own namespace |
| `GET` | `/api/libraries/:id` | push-read | One library |
| `GET` | `/api/libraries/:id/versions` | push-read | Versions of a library |
| `POST` | `/api/libraries/:id/versions` | push | Create a version `{ id, branch? }` |
| `POST` | `/api/libraries/:id/versions/:vId/promote` | push | Make the version current |
| `POST` | `/api/libraries/:id/versions/:vId/clone-from/:src` | push | Copy documents and images from another version |
| `DELETE` | `/api/libraries/:id/versions/:vId` | push | Delete a non-current version |
| `GET` | `/api/libraries/:id/documents` | push-read | List documents (`version`, `branch`, `domain`, `entry_type`, `limit`, `offset`) |
| `POST` | `/api/libraries/:id/versions/:vId/documents` | push | Upload one document (`multipart/form-data`) |
| `POST` | `/api/libraries/:id/versions/:vId/documents/bulk` | push | Upload a JSON array of documents (`?noEnrich=true` skips LLM enrichment) |
| `DELETE` | `/api/libraries/:id/versions/:vId/documents/:slug` | push | Delete a document |
| `POST` | `/api/libraries/:id/versions/:vId/images` | push | Upload an image (PNG/JPEG/GIF/WebP, max 10 MB) |
| `GET` | `/api/libraries/:id/versions/:vId/images?slug=` | push-read | List images of a document |
| `GET` | `/api/libraries/:id/versions/:vId/images/:slug/:file` | read | Serve an image (also under `/static/libraries/...`) |
| `GET` | `/api/libraries/:id/diff/:slug?from=&to=` | read | Diff a document between versions |
| `GET` | `/api/libraries/:id/topology/:domain` | read | Documents of a domain plus 1-hop links |
| `GET` | `/api/search?q=&library_id=&branch=&domain=` | read | Hybrid search, grouped by domain |
| `GET` | `/api/document?library_id=&slug=` | read | Full document |
| `POST` | `/api/chat` | chat | Streaming chat (NDJSON events) |
| `GET/POST/PATCH/DELETE` | `/api/sessions[/:id[/messages]]` | chat | Chat history used by the UI |
| `POST` | `/api/sessions/:id/publish` | chat | Summarise a chat into an `insight` document in the insights library (`{ library_id?, domain?, title?, slug? }`; `slug` admin only); records the author |

**Upload a single document:**

```bash
curl -X POST http://localhost:4737/api/libraries/orders-api/versions/abc123/documents \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -F "slug=orders/create-order" \
  -F "domain=orders" \
  -F "entry_type=handler" \
  -F "http_method=POST" \
  -F "route=/api/v1/orders" \
  -F "summary=Creates an order and reserves stock" \
  -F "content=<./docs/orders/create-order.md"
```

## MCP

### stdio (Claude Desktop, Claude Code, local agents)

```json
{
  "mcpServers": {
    "lore": {
      "command": "node",
      "args": ["/path/to/lore/dist/cli.js", "mcp"],
      "env": {
        "DATABASE_URL": "postgres://lore:lore@localhost:5433/lore",
        "LORE_EMBEDDING_PROVIDER": "hash"
      }
    }
  }
}
```

Run it from the repository root (or set `LORE_DEFAULT_PROMPTS_DIR`) so the prompt templates are found.

### HTTP (Streamable HTTP and SSE)

`lore serve` starts an MCP HTTP server on `LORE_MCP_PORT` (default `4738`), bound to `127.0.0.1` unless `LORE_MCP_HOST` says otherwise. Every request needs `Authorization: Bearer <token>`: a personal `sk_` token from the Tokens page (`/tokens`) or the admin key `LORE_API_KEY`. Tokens are checked against the database on every request; project keys, revoked tokens and tokens of disabled users get 401.

```
POST http://localhost:4738/mcp                       — Streamable HTTP (stateless)
GET  http://localhost:4738/sse                       — legacy SSE: open a session
POST http://localhost:4738/messages?sessionId=<id>   — legacy SSE: send a message
```

Requests with a `Host` outside `LORE_MCP_ALLOWED_HOSTS` (default: loopback names when bound to loopback) or an `Origin` outside `LORE_MCP_ALLOWED_ORIGINS` (default: none) are rejected, which blocks DNS-rebinding attacks from browsers.

### Tools

| Tool | Description |
|------|-------------|
| `ask_lore` | Natural-language search, returns full content of the best matches |
| `search_docs` | Search with scores, no content |
| `get_document` | Document by slug, optionally with links |
| `list_libraries` | Libraries with current version and document count |
| `list_endpoints` | Documents of a library with metadata |
| `get_library_overview` | Breakdown by domain / entry type / category |
| `find_related_docs` | Explicit and inferred links of a document |
| `find_by_data_source` | Documents using a repository interface, table or stored procedure |
| `find_by_external_dependency` | Documents depending on a gRPC service, queue or HTTP service |
| `get_service_topology` | Graph of a domain and its 1-hop neighbours |
| `get_document_diff` | Diff of a document between versions |

Tool descriptions are prompt templates (`prompts/mcp/*.md`) and can be overridden with `LORE_PROMPTS_DIR`.

Feature branches pushed with `--no-promote` are not current, but agents can query them explicitly with the `branch` argument, e.g. `ask_lore(question: "how does the new checkout work?", branch: "feature/new-checkout")`.
