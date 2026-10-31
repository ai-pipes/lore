# Lore — guide for agents

Living documentation for services: every service pushes versioned Markdown docs from CI, and Lore serves them to people (a chat UI with citations) and to agents (MCP). TypeScript (ESM, Node 22), Fastify 5, Postgres + pgvector, Drizzle, vitest, Playwright, commander. One process, one repository: a modular monolith following DDD. Decisions: `docs/adr/`. Current spec: `docs/specs/2026-10-31-users-sso-namespaces-design.md`.

Code, comments, docs and commit messages are in English. Commits follow Conventional Commits.

## Layout

The layout (enforced by the import rules below):

```
src/main.ts                 the single bundle entry (dist/cli.js): client + server commands
src/modules/<m>/            catalog, search, chat, llm, identity — each with:
  domain/                   aggregates, value objects, invariants. Plain TypeScript, no dependencies
  application/              use cases and queries; declares the ports it needs
  infrastructure/           port implementations: Postgres (Drizzle), files, embeddings, LLM
  interfaces/               Fastify routes (http/), HTML/JS pages (web/)
  index.ts                  the module's public API — the only file other code imports
src/shared-kernel/          dependency-free building blocks: Result/ok/err, DomainError, Clock
src/platform/               composition and wiring: container, Fastify server, CSRF, security
                            headers, CSP, vendor assets, health, config, DB + migrations, MCP,
                            server-side CLI commands
src/contracts/              request/response types shared by the HTTP interfaces and the CLI
src/cli/                    the client CLI (push, images, …); talks to the server over HTTP only
drizzle/                    hand-written, forward-only SQL migrations for all modules
test/architecture/          dependency-cruiser rule tests and their bad fixtures
src/__tests__/              DB-backed (integration) tests
e2e/                        Playwright tests
```

## Import rules

Checked by dependency-cruiser (`npm run arch`, `.dependency-cruiser.cjs`) and pinned by `test/architecture/architecture.test.ts`, which runs each rule against a bad fixture in `test/architecture/fixtures/<rule>/`, checks that every rule is an `error`, that the real `src` tree has no violations, and that no module index exports a Drizzle table. Any violation fails `npm run arch` and `npm run verify`.

- `domain-is-pure` — `domain` imports only its own `domain/` and `shared-kernel/`. No npm packages and no Node built-ins.
- `application-only-domain` — `application` imports its own `domain/` and `application/`, `shared-kernel/`, other modules' `index.ts`, `src/contracts/`, and only the npm packages `diff` and `zod`.
- `no-inward-infra` — `domain` and `application` never import `infrastructure/`, `interfaces/` or `platform/`.
- `modules-via-index` — a module reaches another module only through that module's `index.ts`.
- `platform-db-only` — modules import nothing from `platform/` except `platform/db.ts`.
- `cli-no-server` — `src/cli/` imports neither `src/modules/` nor `src/platform/`; shared types come from `src/contracts/`.
- `contracts-are-leaf`, `shared-kernel-is-pure` — these two import only themselves.
- `llm-sdk-in-adapter` — only `modules/llm/infrastructure/` imports the `openai` SDK; everything else goes through the `LanguageModel` port.
- `no-circular` — no import cycles.

Tests (`*.test.ts`) next to domain/application/shared-kernel code may import the test runner.

Each module owns its tables (`infrastructure/schema.ts`); `platform/db.ts` combines the schemas. No module reads another module's tables, and module indexes never export Drizzle tables. Foreign keys between modules exist only in the SQL migrations, not as Drizzle `references()`.

## Module map

| Module | Owns | Tables |
|---|---|---|
| `catalog` | Library, Version, Document, images, links, embeddings, diff, topology, enrichment, Namespace, ProjectKey and the push policy | `libraries`, `versions`, `documents`, `document_metadata`, `document_links`, `document_vectors`, `document_images`, `namespaces`, `project_keys` |
| `search` | query understanding, rank fusion, slug lookup, link expansion | none — reads through the `catalog` index |
| `chat` | ChatSession, messages, answer streaming, Insight publishing, chat UI | `chat_sessions`, `chat_messages` |
| `llm` | the `LanguageModel` port and its OpenAI-compatible adapter (OpenRouter by default), and prompt templates | none |
| `identity` | User, web sessions, password and single sign-on (OIDC), personal `sk_` tokens, CLI device login, the admin key | `users`, `web_sessions`, `api_tokens`, `oidc_pending`, `cli_logins` |

## Domain glossary

- **Library** — one service's documentation, identified by a slug-like id (`petstore-api`). Receives pushes.
- **Version** — an immutable snapshot of a library's documents, usually named after the git SHA; optionally on a `branch`. One version per library is current (promoted).
- **Document** — a Markdown page in a version, addressed by `slug`; has frontmatter, metadata, links to other documents, images and embeddings. Identified by its content hash for incremental pushes.
- **Namespace** — an admin-defined group of libraries (`default` holds existing libraries; `insights` is the system namespace for published chats).
- **ProjectKey** — an `lpk_…` key that may push only to libraries of its namespace, optionally only to one library (CI use). Only its SHA-256 is stored. It gets 403 on read, chat and admin routes and 401 on MCP.
- **Principal** (the platform calls the resolved one a **Caller**) — who is making a request: a user via a web session or an `sk_` token, a project key, or the break-glass admin key `LORE_API_KEY`.
- **ApiToken** — a personal `sk_…` token of a user; only its SHA-256 is stored. Tokens created on the Tokens page never expire unless revoked; `cli-` tokens from a device login expire after `LORE_CLI_TOKEN_TTL_DAYS` (default 90).
- **DeviceLogin** (device login) — a CLI sign-in request (`lore login`): the CLI polls with a secret device code (only its SHA-256 is stored), a signed-in person types its short user code (`BCDF-GHJK`) into the blank form on `/cli/login` (links never carry it), sees the reported hostname and the requesting IP, and approves it; and the first poll after approval mints one `cli-<hostname>` `sk_` token. Expires after 10 minutes.
- **ChatSession** — a chat conversation with its messages and scope filters; owned by one user.
- **Insight** — a chat session published as a document into the `insights` library (system namespace `insights`; no push route writes there, and the configured insights library id is reserved in the push policy for every caller and namespace), linked to the documents it cited; records its author (user id and display name).
- **Sign-in method** — `password` or `sso` (OIDC), chosen by configuration: SSO is on when `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are all set. In SSO mode password sign-in is off, and the role follows the provider groups (`OIDC_ADMIN_GROUP`, `OIDC_LOGIN_GROUP`) on every sign-in.
- **Role** — `admin` or `member` of a user; see the authorization matrix in the README's Security section.

## How to add a use case

1. Domain test first (`*.test.ts` next to the code): the invariants of the aggregate or value object — red, then green.
2. Use case in `application/`, tested with fake ports (`test/fakes/*.ts`, no DB). Application functions take `deps` first; the ports are declared in `application/`.
3. Port adapter in `infrastructure/` (Postgres via Drizzle, files, LLM). Wire it in `infrastructure/compose.ts` (`createPg<Module>(…): <Module>Deps`).
4. Integration test in `src/__tests__/` against a real Postgres.
5. Wire it into `interfaces/` (`interfaces/http/routes.ts` exports `<module>Routes(deps, opts): FastifyPluginAsync`; MCP tools in `platform/mcp/`) and into the `platform/` composition. Export what other code needs from the module's `index.ts`.

## Security guarantees to keep

Strict CSP (`default-src 'self'`, no inline scripts or styles, no CDN); CSRF check on state-changing requests (Origin / `Sec-Fetch-Site`); `/api` bodies are JSON or multipart only; 5xx bodies are generic; security headers on every response; MCP Host/Origin allowlists. Secrets (keys, tokens, session ids) are stored only as SHA-256 hex. Password sign-in follows OWASP device cookies (hard per-login lock, HMAC-signed `lore_device` cookie for known devices, per-IP failure limit; README Security).

## Commands

- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — oxlint over `src test e2e` (`.oxlintrc.json`; correctness rules are errors).
- `npm run arch` — dependency-cruiser over `src`.
- `npm test` — vitest with coverage (unit + DB-backed tests). Coverage of `src/modules/*/{domain,application}/**` must stay at least 90% for lines, branches, functions and statements (`vitest.config.ts`); add domain/application tests with fakes rather than lowering a threshold or adding exclusions. Needs Postgres: tests use `<DATABASE_URL db>_test` (or `TEST_DATABASE_URL`), are offline (`LORE_EMBEDDING_PROVIDER=hash`, no LLM) and create the test database themselves. Example: `docker run -d --rm --name lore-pg -e POSTGRES_USER=lore -e POSTGRES_PASSWORD=lore -e POSTGRES_DB=lore -p 5432:5432 pgvector/pgvector:pg17` and `DATABASE_URL=postgres://lore:lore@localhost:5432/lore`.
- `npm run test:e2e` — Playwright (`e2e/`, server on port 3737, same Postgres). First run: `npx playwright install chromium`.
- `npm run build` — esbuild bundle `dist/cli.js` plus vendor assets.
- `npm run verify` — `typecheck` + `lint` + `arch` + `test` + `build`. CI runs `verify`, `e2e` and `docker`.

**Run `npm run verify` before finishing a task. Never weaken lint or dependency-cruiser rules to make a check pass; fix the code.**
