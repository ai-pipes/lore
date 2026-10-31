# Users, SSO and namespace keys: design

## Intent

Lore today has one admin key, one auto-issued key per library, an optional shared read key and a chat history that everyone shares. That is fine for a demo and wrong for a team: nobody is identifiable, the first `lore push` claims a library, and anyone can read or delete anyone's chats.

This change makes Lore a multi-user service:
- people sign in, with SSO or with a password;
- every person has their own chat history, like a normal chat app;
- CI pushes with **project keys** that an admin issues for a **namespace**, a group of services the admin defines.

The model follows ai-pipes/skills-registry, the sibling project by the same author. It has the same stack (TypeScript, Postgres) and the same identity design: users, sessions, `sk_` tokens and OIDC with groups. Reuse its code and behaviour where they fit. Read `apps/server/src/modules/identity/**`, `apps/server/migrations/0010_identity_sso.sql` and the README section "Single sign-on (OIDC)" in that repo (`gh api repos/ai-pipes/skills-registry/...`).

## Decisions (owner)

1. **Namespace.** A namespace is a space that holds several services (libraries). Which services belong to a namespace is decided by the user who manages Lore: the admin creates namespaces and assigns libraries to them.
2. **Reading.** Every signed-in person can read all documentation in all namespaces. SSO groups are taken into account for sign-in and role, as in skills-registry: `OIDC_LOGIN_GROUP` members may sign in, `OIDC_ADMIN_GROUP` members are admins. *(Builder's reading of "groups are taken into account": no per-namespace read restriction.)*
3. **Project keys** are issued only by admins.
4. **Local password accounts** remain available for installs without SSO, as in skills-registry.

## Goals

### Identity
- Users: login, display name, role (`admin` | `member`), disabled flag, nullable password hash, nullable OIDC link (issuer + subject).
- Web sessions: a random id in an HttpOnly, SameSite cookie (Secure over https). The database stores only its hash, with an expiry. Signing out or disabling a user ends that user's sessions. A session also records its sign-in method (`password` or `sso`); an `sso` session has an absolute deadline (`absolute_expires_at`, `LORE_SSO_SESSION_MAX_HOURS`, default 24) set at sign-in and never extended, so after it the request is signed out (session deleted, 401 or redirect to sign-in) and the person goes through the provider again, which re-reads groups and role. The rule lives in the identity domain session policy. Password sessions have no deadline.
- Personal API tokens `sk_…` for MCP and the HTTP API. They are created in the UI, stored hashed, named, revocable, with a last-used time. The UI shows each token once, together with a ready `claude mcp add …` command.
- **Password mode** (no OIDC configured). The first admin is created from `LORE_ADMIN_LOGIN` / `LORE_ADMIN_PASSWORD` if there are no users. Admins add users, reset passwords, and disable or enable users; adding users, resetting passwords and changing roles need an admin web session or `LORE_API_KEY` (not an admin's `sk_` token). Passwords are at least 12 characters and hashed with a slow KDF (scrypt or argon2). Login is rate-limited with OWASP device cookies: a hard per-login lock (keyed by an HMAC of the login, the same for unknown logins) that only known devices (an HMAC-signed `lore_device` cookie from an earlier sign-in, with their own limit) bypass, a per-address failure limit across logins, and a cap on concurrent sign-ins per address; attempts are reserved before the password is checked; admins can unlock a login (README, Security); the client address honours `X-Forwarded-For` only from proxies named by `LORE_TRUST_PROXY`.
- **SSO mode.** It is on when `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are all set. Setting only some of them is a startup error.
  - Sign-in uses Authorization Code + PKCE.
  - The groups claim comes from the ID token, or from UserInfo if the token lacks it.
  - The role is re-synced on every sign-in.
  - A person in neither group is refused.
  - The first sign-in of an unknown person creates the user. The login is derived from `preferred_username`, else the local part of a verified email, else `sub`, normalized, with a suffix on collision.
  - Password sign-in is disabled in this mode. Existing `sk_` tokens keep working.
  - A CLI command `link-sso` links existing users to an identity.
  - Behaviour should mirror skills-registry. Pocket ID is the reference provider.
- `LORE_API_KEY` stays as a break-glass admin bearer for bootstrap and scripts. `LORE_READ_KEY` is **removed**: reading now requires a signed-in user or a token.

### CLI authentication
The `lore` CLI always authenticates; it never works anonymously.
- **Interactive: `lore login [--url <lore url>]`.** A device-code flow:
  1. The CLI calls `POST /api/cli/login/start` and gets a short user code, a verification URL and a device code.
  2. It prints the code and opens the browser on the verification URL (`/cli/login`, which never carries the code).
  3. The person signs in there (SSO or password), types the code into a blank form, and approves the request after checking the hostname (labelled "reported by the CLI") and the IP address it came from.
  4. The CLI polls `POST /api/cli/login/poll` until approved, denied or expired (10 min).
  5. On approval Lore creates a personal `sk_` token named `cli-<hostname>` for that person and returns it once. It expires after `LORE_CLI_TOKEN_TTL_DAYS` days (default 90).
  6. The CLI stores it with the URL in `~/.config/lore/credentials.json`, mode 600.
  The approval page is CSRF-protected; the person types the code themselves and sees the requesting IP, so a forwarded link cannot become a one-click approval and a phishing attempt is easier to spot.
- **Non-interactive.**
  - `LORE_TOKEN` (and `LORE_URL`) environment variables take precedence over the credentials file. In CI this holds a project key `lpk_` for `lore push`. On a workstation it can hold an `sk_` token.
  - `lore login --token <token>` stores a pasted token instead of running the browser flow.
- `lore logout` revokes the stored token on the server and deletes the local file. `lore whoami` prints the user, role and URL, or the namespace for a project key.
- Commands check the role server-side:
  - `push` needs an admin user or a project key for that namespace;
  - `namespace` and `project-key` commands need an admin;
  - read and search commands need any signed-in user token.
- `LORE_API_KEY` remains only as a server-side break-glass bearer. The CLI accepts it via `LORE_TOKEN` but does not advertise it.

### Per-user chat history
- `chat_sessions.user_id` is NOT NULL, with an FK to users.
- Every session route (list, get, rename, delete, messages, pin, scope, publish) only sees the caller's own sessions. Another person's session id returns **404**.
- MCP and API calls run as the token's owner. Any chat state they create belongs to that owner.
- Publishing a chat to `insights` records the author (user id and display name) on the insight document. Reading insights is open to everyone, like all docs.
- **No legacy data.** Existing chat sessions/messages are dropped by the migration (owner decision: old data does not matter).

### Namespaces and project keys
- `namespaces` table: id (a slug), display name, created_at. Each library belongs to exactly one namespace. A `default` namespace holds existing libraries after the migration.
- Admin UI and API to:
  - create and rename namespaces;
  - move a library between namespaces;
  - list the libraries in each namespace.
- **Project keys**:
  - each belongs to one namespace;
  - name, hash, created_by, created_at, last_used_at, revoked_at;
  - shown once at creation;
  - a namespace can have any number of keys.
- A project key may only:
  - push to libraries in its namespace, including creating a **new** library inside its namespace on first push;
  - read what `lore push` needs (library lookup, versions, hashes).
- A project key may not read chats or use the chat, MCP or admin APIs.
- Pushing to a library outside the key's namespace returns 403. So does pushing a new library id that already exists in another namespace.
- The old auto-issue on first push is removed, and `libraries.api_key_hash` is dropped. Existing libraries move to the `default` namespace; old per-library keys stop working (owner decision: no compatibility with old data or keys).

### Authorization summary

| Caller | Read docs/search | Chat (own history) | Push | Admin (users, namespaces, keys) |
|---|---|---|---|---|
| Signed-in member / member `sk_` token | all | yes | no | no |
| Admin (session, `sk_` incl. CLI login) / `LORE_API_KEY` | all | yes | any namespace | yes |
| Project key | push-related only | no | own namespace | no |
| Anonymous | no (except `/login`, `/healthz`, static assets) | no | no | no |

## Non-goals
- Per-namespace read restrictions. Every signed-in user reads everything.
- Group → namespace mapping. Admins issue keys; groups only gate sign-in and role.
- Multi-tenancy, SCIM, fine-grained RBAC beyond admin/member.
- Sharing chats between users.

## Anti-goals
- Any route that returns another user's chat data.
- Secrets stored in plain text: passwords, tokens, keys and session ids are always hashed.
- An SSO flow that is weaker than skills-registry's: missing state/nonce/PKCE, or role taken only at first login.

## Constraints
- Keep the existing guarantees from the release work:
  - strict CSP, no CDN;
  - CSRF protection (Origin / Sec-Fetch-Site check, JSON-only `/api`);
  - MCP bearer auth;
  - offline tests (hash embeddings).
- All existing tests must keep passing or be updated to the new auth deliberately. CI (unit, e2e, docker) stays green.
- Migrations are forward-only SQL consistent with the existing Drizzle setup.
- Docs: README sections for Users and roles, SSO (with a Pocket ID example), Project keys and namespaces, plus the updated config table and Security section.

## Builder's calls (controller decisions, overridable)
- **MCP auth.** The MCP listener checks bearer tokens against the database: `sk_` tokens run as their owner, `LORE_API_KEY` is accepted as admin, project keys (`lpk_`) are rejected (401). MCP tools are read/search tools; if any creates chat state it belongs to the token owner. Folding MCP into Fastify or keeping a separate listener with a DB-backed auth callback is the builder's choice.
- **Insights.** `insights` lives in a reserved system namespace `insights` that admins cannot assign other libraries to and project keys can never push to. Only signed-in users (via session or `sk_`) can publish their own chats; the slug is always `insight/<session id>`; only admins may choose a slug. The insight records its author.
- **Library creation and CLI.** `lore push` gets `--namespace`, used only when an admin creates a new library (default `default`); a project key creates new libraries only in its own namespace and the flag is ignored or must match. Old `lore key create` / `rotate-key` are removed and replaced by admin commands `lore namespace create|list|assign` and `lore project-key create|list|revoke` (same as the admin UI/API).
- **Key scope.** A project key may carry an optional `library_id` restriction; by default it covers its whole namespace.
- **SSO bootstrap.** In SSO mode `LORE_ADMIN_LOGIN/PASSWORD` are ignored (warning in log); the first admin is whoever signs in as a member of `OIDC_ADMIN_GROUP`. A new SSO user never auto-links to an existing local user by login: on collision the new login gets a suffix; linking is only via `link-sso`.
- **Mirror skills-registry** for OIDC env var names (issuer, client id/secret, scopes, groups claim, login/admin group, redirect derived from `PUBLIC_URL`), state + nonce + PKCE, and role re-sync. The session cookie is `SameSite=Lax` (Strict breaks the OIDC callback), HttpOnly, Secure over https; CSRF stays enforced by the existing Origin / Sec-Fetch-Site checks and JSON-only `/api`. The reference code is readable via `gh api repos/ai-pipes/skills-registry/contents/...`.
- **Cookie auth for the UI** is allowed on `/api` (with the CSRF checks above). Project keys can look up only libraries of their own namespace; `/api/libraries` listing for a project key returns only those. `LORE_API_KEY` has no user, so chat routes return 403 for it.
- Session cookie lifetime: 7 days sliding; SSO sessions additionally end 24 hours after sign-in (`LORE_SSO_SESSION_MAX_HOURS`, migration 0013). Offboarding: remove from the groups and disable the user locally, which also cuts off `sk_` tokens at once. `sk_` tokens created on the Tokens page do not expire unless revoked; `cli-` tokens from `lore login` expire after `LORE_CLI_TOKEN_TTL_DAYS` (default 90).
- The UI adds a sign-in page, Tokens page, Users page (admin) and Namespaces & keys page (admin), in the existing chat UI style. No new framework.
- Project key prefix `lpk_` (distinct from personal `sk_`), so logs and leaks are identifiable.

## Architecture and harness (owner requirement)

Lore gets the same agent harness and DDD layout as ai-pipes/skills-registry (`CLAUDE.md`, `AGENTS.md`, `.dependency-cruiser.cjs`, `apps/server/test/architecture.test.ts`, `docs/adr/0001-modular-monolith.md`). The move happens **first and with no behaviour change**; the users/SSO/namespaces work is then built inside the new layout, under the rules from day one.

### Layout
- `src/modules/<module>/{domain,application,infrastructure,interfaces}` plus a public `index.ts` per module. Other code imports a module only through its `index.ts`.
- `src/shared-kernel`: dependency-free building blocks (`Result`/`ok`/`err`, `DomainError`, `Clock`).
- `src/platform`: composition and wiring (container, Fastify server, CSRF and security headers, CSP, vendor assets, health, config, DB connection and migrations, MCP server and tools, server-side CLI commands).
- `src/contracts`: request/response types shared by the HTTP interfaces and the CLI. Types only, imports nothing.
- `src/cli`: the client CLI (`push`, `images`, later `login`/`logout`/`whoami`/`namespace`/`project-key`). It talks to the server only over HTTP.
- `src/main.ts`: the single `dist/cli.js` entry; it registers the client commands and the server commands (`serve`, `mcp`, `status`, later `link-sso`/`unlink-sso`).

### Module mapping
| Today | Module | Owns tables |
|---|---|---|
| `src/catalog/**`, `src/content/**`, `src/shared/version-filter.ts`, `src/discovery/service/{TopologyService,RelationshipService}.ts`, `src/discovery/api/topology.ts`, the SQL half of `src/discovery/service/SearchService.ts` | `catalog`: Library, Version, Document, images, links, embeddings (later Namespace, ProjectKey) | `libraries`, `versions`, `documents`, `document_metadata`, `document_links`, `document_vectors`, `document_images` (later `namespaces`, `project_keys`) |
| `src/discovery/service/SearchPipeline.ts`, the ranking half of `SearchService.ts` | `search`: query understanding, rank fusion, slug lookup, link expansion | none: reads through the `catalog` index |
| `src/ai-gateway/{api/chat.ts,repository/**,service/InsightService.ts,chat-html.ts,chat-assets.ts,chat-markdown.ts}` | `chat`: ChatSession, messages, answer streaming, Insight publishing, chat UI | `chat_sessions`, `chat_messages` |
| `src/discovery/infrastructure/LlmProvider.ts`, `src/shared/prompts.ts` | `llm`: the OpenAI-compatible client and prompt templates | none |
| `src/shared/{auth,read-auth}.ts` (later all identity work) | `identity`: admin key and, later, users, sessions, tokens, SSO, device login | later `users`, `web_sessions`, `api_tokens`, `oidc_pending`, `cli_logins` |
| `src/app/{server.ts,api/health.ts}`, `src/shared/{config,csrf}.ts`, `src/shared/db/connection.ts`, `src/ai-gateway/ui-assets.ts`, `src/ai-gateway/mcp/**` | `platform` | `drizzle/` migrations (one forward-only sequence for all modules) |
| `src/app/{cli,push}.ts` | `src/main.ts`, `src/cli/**`, `src/platform/server-commands.ts` | none |
| `src/shared/db/schema.ts` | split into `src/modules/*/infrastructure/schema.ts`; `src/platform/db.ts` combines them | none |
| `src/index.ts` (an unused stub) | deleted | none |

Each module owns its tables. No module reads another module's tables, and module indexes never export tables. Foreign keys between modules (`chat_sessions.user_id`, `chat_sessions.published_doc_id`, `documents.author_user_id`, `project_keys.created_by`) exist only in the SQL migrations, not as Drizzle `references()`.

### Rules (dependency-cruiser, `npm run arch`)
- `domain-is-pure`: domain imports only its own `domain/` and `shared-kernel/`. No npm packages and no Node built-ins.
- `application-only-domain`: application imports its own `domain/` and `application/`, `shared-kernel/`, other modules' `index.ts`, `src/contracts/`, and only the npm packages `diff` and `zod`.
- `no-inward-infra`: domain and application never import `infrastructure/`, `interfaces/` or `platform/`.
- `modules-via-index`: a module reaches another module only through its `index.ts`.
- `platform-db-only`: modules import nothing from `platform/` except `platform/db.ts`.
- `cli-no-server`: `src/cli/` imports neither `src/modules/` nor `src/platform/`. Shared types come from `src/contracts/`.
- `contracts-are-leaf`, `shared-kernel-is-pure`: these two import only themselves.
- `no-circular`.

`test/architecture/architecture.test.ts` runs the rules against bad fixtures in `test/architecture/fixtures/` (one per rule) and checks that each rule fires. It also checks that the real tree is clean and that no module index exports a table. Rules start in report-only mode (`warn`) while code moves. Each task then ratchets the rules it has made clean, and the last Phase 1 task flips all of them to `error`.

### Harness
- `CLAUDE.md` is the single source of rules for agents. It covers the layers, the import rules, a domain glossary (Library, Version, Document, Namespace, ProjectKey, Principal, ApiToken, ChatSession, Insight, sign-in method), the recipe for adding a use case (domain test → use case with fake ports → infrastructure adapter → integration test → wire `interfaces/` and `platform/`), and the commands. It ends with: "Run `npm run verify` before finishing a task. Never weaken lint or dependency-cruiser rules to make a check pass; fix the code." `AGENTS.md` points to it.
- `docs/adr/0001-modular-monolith.md`, `.github/pull_request_template.md`, `.github/dependabot.yml` (npm and GitHub Actions, weekly, grouped).
- `npm run verify` = `typecheck` + `lint` (oxlint) + `arch` + `test` (vitest with v8 coverage; at least 90% lines, branches, functions and statements for `src/modules/*/{domain,application}/**`) + `build`. CI runs `verify`, `e2e` and `docker`.

### Phasing
- **Phase 1:** the harness, then the move module by module. All existing unit tests (306) and e2e tests (10) stay green after every task, and behaviour does not change: same routes, status codes, headers, CLI flags and database schema.
- **Phase 2:** this spec's identity, chat ownership, namespace, SSO and CLI-auth goals, built inside `identity`, `catalog`, `chat` and `platform` under the rules.

## Left to the builder
- Exact module layout, migration numbering, KDF choice between scrypt and argon2 (no native build hassles in Docker), and UI layout details.
