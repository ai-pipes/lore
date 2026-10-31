# Contributing to Lore

Thanks for helping. Bug reports, documentation fixes and pull requests are welcome.

## Before you start

- For a bug, open an issue with the steps to reproduce it, the expected and the actual result, and the Lore version.
- For a larger change (a new feature, a new module, a change to the data model), open an issue first so the design can be agreed on before you write code.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Development setup

Requirements: Node.js 22 and Docker (for Postgres with pgvector).

```sh
npm ci
cp .env.example .env
docker compose up -d postgres
npm run dev
```

See the [Development](README.md#development) section of the README for the test databases and the full list of commands.

## Rules the code follows

The architecture (a DDD modular monolith), the import rules, the module map and the step-by-step way to add a use case are described in [CLAUDE.md](CLAUDE.md) and [docs/adr/](docs/adr/). In short:

- Write the test first: domain and application code is tested with fakes (`test/fakes/`), database code with integration tests in `src/__tests__/`.
- Coverage of the modules' `domain` and `application` layers stays at 90% or more.
- Never loosen lint or dependency-cruiser rules to make a check pass; fix the code.
- Keep the security guarantees listed in the README (strict CSP, CSRF checks, secrets stored only as SHA-256).

## Pull requests

1. Run `npm run verify` (typecheck, lint, architecture rules, tests with coverage, build). For HTTP, web UI, CSP or Docker changes, run `npm run test:e2e` as well.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) in English (`fix(catalog): …`, `feat(identity): …`).
3. Update the docs the change affects (README, CLAUDE.md, an ADR in `docs/adr/`).
4. Fill in the pull request template.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
