# 0001. Modular monolith with DDD layers

## Context

Lore is a single service that a team runs on its own infrastructure: one Node.js process (Fastify) and Postgres with pgvector. It covers several domains: the catalog of libraries, versions and documents (the core), search over them, chat with insight publishing, the LLM client, and identity (today the admin key, next users, sessions, tokens, SSO and project keys). Microservices would add networking, deployment and consistency concerns with no benefit at this scale. But the code grew by technical layers (`api/`, `service/`, `repository/`) spread over folders that do not match the domains, and agents write a large share of it: they need strict boundaries that a tool can verify, not conventions that only a reviewer remembers.

## Decision

One process and one repository. Inside are the modules `catalog`, `search`, `chat`, `llm` and `identity` under `src/modules/`, each with the layers `domain` / `application` / `infrastructure` / `interfaces` and a public `index.ts`. Around them sit `shared-kernel` (dependency-free building blocks), `platform` (composition, the Fastify server, CSRF, security headers, CSP, MCP, config, the DB connection and migrations, server commands), `contracts` (HTTP request/response types) and `cli` (the client CLI, HTTP only). `src/main.ts` is the single bundle entry.

The import rules are checked by dependency-cruiser (`npm run arch`, part of `npm run verify` and CI): the domain is pure, application sees only its domain, other modules' indexes, contracts and the npm packages `diff` and `zod`, inner layers do not import outer ones, modules talk through `index.ts` only, modules use nothing from `platform` but `platform/db.ts`, the CLI does not import server code, contracts and the shared kernel are leaves, and there are no cycles. Each module owns its tables; cross-module foreign keys exist only in the SQL migrations. The move into this layout happens first and changes no behaviour; the rules start as warnings and become errors once the move is complete.

## Consequences

- Deployment stays simple (one image, one process) and transactions stay in-process; a module can later be extracted along boundaries that already exist.
- Discipline is enforced by tooling, not by review: a violation breaks `npm run arch`, and each rule is pinned by a test against a bad fixture.
- Domain and application code is tested with fake ports, without a database, and must keep at least 90% coverage.
- The price is ceremony — ports, fakes and composition code — even for simple cases.
- Shared code is limited to `shared-kernel` (Result, DomainError, Clock) and must stay dependency-free.
