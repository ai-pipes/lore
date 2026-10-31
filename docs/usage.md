# Lore — usage guide

## Contents

1. [Quick start](#quick-start)
2. [Authentication](#authentication)
3. [CLI commands](#cli-commands)
4. [Docs folder layout](#docs-folder-layout)
5. [Document format](#document-format)
6. [Frontmatter fields](#frontmatter-fields)
7. [Content structure](#content-structure)
8. [Automatic dependency extraction](#automatic-dependency-extraction)
9. [Example documents](#example-documents)
10. [Common mistakes](#common-mistakes)

---

## Quick start

```bash
# Sign the CLI in (opens the browser; approve the request there)
lore login --url https://lore.example.com

# Push the documentation
lore push ./docs -l orders-api -v $(git rev-parse HEAD)
```

In CI, set `LORE_URL` and `LORE_TOKEN` (a project key `lpk_…`) instead of running `lore login`.

---

## Authentication

The CLI always authenticates. It takes its server and token from:

| Source | Server | Token |
|--------|--------|-------|
| `-u, --url <url>` | first | — |
| `LORE_URL` / `LORE_TOKEN` | if no `--url` | first |
| `~/.config/lore/credentials.json` (written by `lore login`) | if neither | only when the file is for that same server |
| default | `http://localhost:4737` | — |

If there is no token for the server a command talks to, it stops with `not logged in to <url>`: a stored token is never sent to a different server.

Which token you need:

- **`lore push`, `lore images add/rm`** — an admin (a personal token of an admin user) or a project key of the library's namespace.
- **`lore namespace …`, `lore project-key …`** — an admin.
- **reading (`lore images ls`, `lore whoami`)** — any user's token; a project key may read what `lore push` needs.

```bash
# Workstation: device login, stores a personal sk_ token named cli-<hostname>
lore login

# Or store a token you already have (a personal sk_ token from the Tokens page, or a project key)
lore login --token sk_...

# CI: no file, just the environment
export LORE_URL=https://lore.example.com
export LORE_TOKEN=lpk_...
lore push ./docs -l orders-api -v "$GIT_SHA"
```

---

## CLI commands

### `lore login`

Signs the CLI in to a server and stores the token with the URL in `~/.config/lore/credentials.json` (mode 600, directory 700; an existing file is tightened to 600).

```bash
lore login [--url <url>] [--token <token>]
```

Without `--token` it runs a device login: it prints a short code (`BCDF-GHJK`) and opens `<server>/cli/login` in the browser. Sign in there (password or SSO), type the code, check the hostname the CLI reported and the IP address the request came from, and approve. The CLI polls every 5 seconds; the request expires after 10 minutes. The new token is a personal `sk_` token named `cli-<hostname>`, listed on the Tokens page; it expires after `LORE_CLI_TOKEN_TTL_DAYS` days (default 90).

| Option | Description | Default |
|--------|-------------|---------|
| `-u, --url <url>` | Server URL | `$LORE_URL`, the stored URL, or `http://localhost:4737` |
| `--token <token>` | Store this `sk_…` or `lpk_…` token instead of signing in in the browser | device login |

### `lore logout`

Revokes the stored `sk_` token on the server and deletes the credentials file (the file is deleted even if the server cannot be reached; then revoke the token on the Tokens page).

### `lore whoami`

Prints who the CLI is signed in as: `alice (admin) at <url>`, `project key "ci" for namespace payments at <url>` or `admin key at <url>`. Accepts `-u, --url <url>`.

---

### `lore push <dir>`

Uploads a directory of `.md` files to the server, recursing into subfolders.

```bash
lore push <dir> -l <library> -v <version> [options]
```

**Required:**

| Option | Description |
|--------|-------------|
| `<dir>` | Directory with `.md` files |
| `-l, --library <id>` | Library slug, e.g. `orders-api` |
| `-v, --ver <id>` | Version id, e.g. the git SHA |

**Optional:**

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --branch <name>` | Git branch name | `$GIT_BRANCH` |
| `--namespace <id>` | Namespace of a new library (admins; a project key always uses its own) | `default` |
| `--no-promote` | Do not make the version current (feature branches) | promote |
| `--no-incremental` | Re-upload every document, ignoring hashes | incremental |
| `--no-enrich` | Skip LLM link enrichment after upload | enrich (if an LLM is configured) |
| `-u, --url <url>` | Server URL | `$LORE_URL`, the stored URL, or `http://localhost:4737` |

The token comes from `LORE_TOKEN` or the credentials file (see [Authentication](#authentication)).

**Examples:**

```bash
# Regular push with the current git SHA as the version
lore push ./docs -l orders-api -v $(git rev-parse HEAD)

# Feature branch, not promoted
lore push ./docs \
  -l orders-api \
  -v $(git rev-parse HEAD) \
  -b $(git branch --show-current) \
  --no-promote

# Force a full re-upload
lore push ./docs -l orders-api -v v2.0 --no-incremental

# Remote server from CI, with a project key
LORE_URL=https://lore.example.com LORE_TOKEN=$LORE_PROJECT_KEY \
  lore push ./docs -l orders-api -v $(git rev-parse HEAD)
```

**How incremental mode works (default):**

1. Clones the current version into the new version
2. Compares content hashes with the current version
3. Uploads only new or changed documents
4. Deletes documents that no longer exist locally

A project key may push only to libraries of its namespace (creating a new library there on the first push); anything else is refused with 403.

---

### `lore images`

Manage document images.

```bash
# List the images of a document
lore images ls billing/issue-invoice -l orders-api

# Upload an image
lore images add diagram.png billing/issue-invoice -l orders-api

# Remove an image
lore images rm billing/issue-invoice diagram.png -l orders-api
```

`lore push` syncs images automatically (see [Docs folder layout](#docs-folder-layout)).

---

### `lore namespace`

Manages namespaces (admin).

```bash
lore namespace create payments --name "Payments"   # create a namespace
lore namespace list                                # namespaces and their libraries
lore namespace assign orders-api payments          # move a library to a namespace
```

`default` holds existing libraries; `insights` is the system namespace (no assignments, no pushes).

---

### `lore project-key`

Manages project keys for CI pushes (admin).

```bash
lore project-key create payments --name github-ci [--library orders-api]   # prints lpk_… once
lore project-key list [--namespace payments]
lore project-key revoke <id>
```

Store the printed key as a CI secret and pass it as `LORE_TOKEN`. A revoked key, or a key whose library moved to another namespace, is refused on the next push.

---

### `lore status`

Shows registered libraries. This and the commands below are server-side: they run where the database is reachable (`DATABASE_URL`) and need no token.

```bash
lore status
```

---

### `lore serve`

Starts the HTTP API, the chat UI and the MCP HTTP server.

```bash
lore serve
```

---

### `lore mcp`

Starts the MCP server over stdio (Claude Desktop, Claude Code, other local agents).

```bash
lore mcp
```

---

### `lore link-sso` / `lore unlink-sso`

Links an existing user to a single sign-on account (the provider's `sub`), so that their SSO sign-in lands on that user, or removes the link. Needs the OIDC settings.

```bash
lore link-sso alice 3f2a…
lore unlink-sso alice
```

### `lore reindex-embeddings`

Re-embeds documents with the current embedding provider and model (`LORE_EMBEDDING_PROVIDER`, `LORE_EMBEDDING_MODEL`, ...). Run it after changing the embedding model, and once after upgrading from a version without model-tagged vectors. By default it embeds documents whose vector for the current model is missing or stale; `--all` re-embeds every document.

```bash
lore reindex-embeddings
lore reindex-embeddings --all
```

---

## Docs folder layout

The folder structure is up to you: the CLI finds every `.md` file recursively. A document's slug comes from its frontmatter, not from its path.

**Recommended: organise by domain:**

```
docs/
├── billing/
│   ├── overview.md
│   ├── issue-invoice.md
│   └── create-subscription.md
├── schemas/
│   ├── invoices.md
│   └── subscriptions.md
└── events/
    └── invoice-issued.md
```

**Images** for a document live in a folder named like the `.md` file (without the extension):

```
docs/
├── billing/
│   ├── issue-invoice.md
│   └── issue-invoice/          ← same name as the .md file
│       ├── flow-diagram.png
│       └── db-schema.png
└── schemas/
    ├── invoices.md
    └── invoices/
        └── erd.png
```

PNG, JPEG, GIF and WebP are supported (the server checks the file signature; SVG is rejected). `lore push` syncs images: new or changed files are uploaded, files removed locally are deleted on the server.

---

## Document format

Each document is one `.md` file with YAML frontmatter.

```markdown
---
slug: billing/issue-invoice
domain: billing
entry_type: handler
handler_class: IssueInvoiceHandler
http_method: POST
route: /api/v1/subscriptions/{subscription_id}/invoice
summary: Issues an invoice for the current billing period of a subscription
category: specification
links:
  - slug: schemas/invoices
    type: references
---

# IssueInvoiceHandler

...content...
```

---

## Frontmatter fields

### `slug` — required

Unique document id within a library. Used for search results, links and citations.

**Rules:**
- Lower-case words separated by hyphens
- Hierarchy with `/`: `{domain}/{subject}`
- Keep it stable: renaming breaks links from other documents

**Patterns by document type:**

| Document type | Slug pattern | Example |
|---------------|-------------|---------|
| HTTP write handler | `{domain}/{action}-{entity}` | `billing/create-invoice` |
| HTTP read handler | `{domain}/{entity}-{qualifier}` | `catalog/product-by-sku` |
| Event handler | `{domain}/on-{event-name}` | `fulfillment/on-order-placed` |
| Domain event | `events/{event-name}` | `events/invoice-issued` |
| Database schema | `schemas/{table-name}` | `schemas/invoices` |
| Service class | `services/{service-name}` | `services/tax-calculator` |
| Background job | `jobs/{job-name}` | `jobs/invoice-reminder` |
| Frontend page | `pages/{page-path}` | `pages/account-settings` |
| UI component | `components/{component-name}` | `components/date-picker` |
| ADR | `decisions/{topic}` | `decisions/queue-provider-choice` |
| Runbook | `ops/{topic}` | `ops/database-failover` |
| Domain overview | `{domain}/overview` | `billing/overview` |

---

### `domain` — recommended

Functional area. Used for filtering and grouping.

✅ `billing`, `catalog`, `auth`, `fulfillment`, `notifications`  
❌ `backend`, `api`, `misc`, `utils`

---

### `entry_type` — recommended

| Value | Use for |
|----------|----------|
| `handler` | HTTP write endpoint (creates, updates, deletes) |
| `query_handler` | HTTP read endpoint (returns data only) |
| `event_handler` | Queue consumer or domain event subscriber |
| `schema` | Database table, collection or data model |
| `event` | Domain or integration event |
| `service` | Internal service class with business logic |
| `job` | Background job, scheduled task, batch processor |
| `page` | Frontend page or screen |
| `component` | Reusable UI component |
| `config` | Configuration or environment variables |
| `decision` | ADR (Architecture Decision Record) |
| `runbook` | Operational procedure |
| `overview` | Domain or service overview |

---

### `category` — recommended

The nature of the information, independent of the artifact type.

| Value | When to use |
|----------|--------------------|
| `specification` | *What should it do?* — API contract, expected behaviour |
| `implementation` | *How does it work?* — algorithm, internal logic |
| `architecture` | *How do the parts fit together?* — diagrams, data flows |
| `decision` | *Why is it built this way?* — trade-offs, rejected alternatives |
| `operational` | *How do we run it?* — deploy, monitoring, troubleshooting |
| `knowledge` | *What should people know?* — gotchas, lessons learned |

**Typical combinations:**

| entry_type | category |
|------------|----------|
| `handler`, `query_handler`, `event_handler` | `specification` |
| `service`, `job` | `implementation` |
| `schema`, `event` | `specification` |
| `overview` | `architecture` |
| `decision` | `decision` |
| `runbook` | `operational` |

---

### `summary` — recommended

One sentence, at most 20 words. Search results and AI agents read it before opening the full document.

✅ `"Issues an invoice for a completed subscription period and emails it to the customer."`  
✅ `"invoices table — stores issued invoices with status, amounts, and payment deadlines."`  
❌ `"Handler for invoices."`  
❌ `"This document describes how the invoice creation process works."`

---

### `handler_class` — required for handlers

Exact class/function name from the source code. It is indexed, so documents can be found by that name.

```yaml
handler_class: CreateInvoiceHandler
```

Copy it from the code; do not abbreviate.

---

### `http_method` and `route` — required for HTTP endpoints

```yaml
http_method: POST
route: /api/v2/invoices/{invoice_id}/send
```

Use `{param}` for path parameters, not `:param`. Include the full path with the version prefix.

---

### `links` — optional

Explicit links to other documents. Mostly needed for cross-library links; within a library, dependencies are also extracted from the content (and by LLM enrichment when an LLM is configured).

```yaml
links:
  - slug: schemas/invoices
    type: references
  - slug: payments/charge-card
    library: payments-service   # only for a different library
    type: calls
```

**Link types:**

| Type | When to use |
|-----|--------------------|
| `calls` | Synchronous call (HTTP or gRPC) |
| `depends_on` | Logical dependency |
| `references` | Mention without a hard dependency |
| `related_to` | Loose relation |

---

## Content structure

```markdown
# ExactClassName or Title

One to three sentences: what it is, what it does, when it runs, what it returns.

## Request / Input

Handlers: parameters, body schema, validation.
Jobs: trigger conditions, data source.
Event handlers: event payload fields.

## Response / Output

Handlers: response body, status codes, side effects.
Jobs: what changes in the system.
Events: where it is published, who consumes it.

## Business Logic

Step-by-step description of what happens, including business rules.
Name things concretely: repositories, services, tables, queues.
This is the most important section for answering questions.

## External Dependencies

Every external system, service, queue and interface.
Use the patterns for automatic extraction (see below).

## Error Handling

Which errors can happen, under which conditions, and what is returned.

## Notes

Edge cases, performance limits, migration history.
```

Include only the sections that apply to the document type.

---

## Automatic dependency extraction

Lore extracts metadata (data sources, queues, services) from document text and uses it for `find_by_*` MCP tools and inferred links. Write dependencies in **External Dependencies** using these patterns:

### Data-access interfaces

Pattern: `I[A-Z]\w+(?:Dal|Repository|Store|Repo)`

```markdown
Reads customer data via `ICustomerRepository`.
Persists changes using `IInvoiceDal`.
```

### Database tables

```markdown
table: invoices
table_name: invoice_line_items
```

Or via SQL:

```sql
SELECT * FROM invoices JOIN invoice_line_items ON ...
```

### Stored procedures

Pattern: `sp_xxx`, `usp_xxx`, `proc_xxx`

```markdown
Calls `usp_GenerateInvoiceNumber` to get the next sequential invoice number.
```

### gRPC services

```markdown
- gRPC: TaxService — calculates applicable taxes
- gRPC: NotificationService — sends the invoice email
```

### Queues

```markdown
Publishes to queue: `invoice-created` after successful creation.
Consumes from topic: `subscription-renewed`.
Routes via exchange: `billing-events`.
```

### External HTTP services

```markdown
Calls `https://api.payments.example.com` to retrieve the payment status.

# or (preferred when the URL depends on the environment):
service: payments-service
service: notifications-service
```

---

## Example documents

### HTTP write handler

```markdown
---
slug: billing/issue-invoice
domain: billing
entry_type: handler
handler_class: IssueInvoiceHandler
http_method: POST
route: /api/v1/subscriptions/{subscription_id}/invoice
summary: Issues an invoice for the current billing period of a subscription
category: specification
links:
  - slug: schemas/invoices
    type: references
  - slug: events/invoice-issued
    type: references
---

# IssueInvoiceHandler

Issues an invoice for a subscription's current billing period. Calculates the amount due, applies active discounts, charges the payment method, and sends the invoice PDF to the customer.

Idempotent within a billing period — calling it twice returns the existing invoice.

## Request

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `subscription_id` | path | uuid | yes | Target subscription |
| `dry_run` | body | boolean | no | Calculate amount without charging or persisting |

## Response

`201 Created` — invoice created and charge initiated.  
`200 OK` — invoice for this period already exists.

| Field | Type | Description |
|-------|------|-------------|
| `invoice_id` | uuid | |
| `status` | string | `draft`, `issued`, `paid`, `overdue`, `void` |
| `amount_due` | decimal | In subscription's currency |
| `pdf_url` | string | Signed URL, expires in 24h |

## Business Logic

1. Load subscription via `ISubscriptionRepository`. Reject if not `active`.
2. Check for existing invoice via `IInvoiceDal`. If found, return with `200`.
3. Calculate line items using `ILineItemCalculator`.
4. Apply discounts from `IDiscountRepository`.
5. Persist to `invoices` and `invoice_line_items` tables.
6. Charge payment method via gRPC: BillingService.
7. Send email via service: notification-service.
8. Publish to queue: `invoice-issued`.

## External Dependencies

- `ISubscriptionRepository` — reads subscription data
- `IInvoiceDal` — persists and queries invoices
- `ILineItemCalculator` — computes billable amounts
- `IDiscountRepository` — applies discount rules
- gRPC: BillingService — charges payment methods
- service: notification-service — sends invoice emails
- queue: `invoice-issued` — notifies downstream services
- table: invoices
- table: invoice_line_items

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `404` | Subscription not found |
| `409` | Subscription is not `active` |
| `402` | Payment declined — invoice created with status `overdue` |
```

### Database schema

```markdown
---
slug: schemas/invoices
domain: billing
entry_type: schema
summary: invoices table — stores issued billing invoices with status, amounts, and payment tracking
category: specification
---

# invoices table

Primary record for a billing invoice. One row per invoice.

## Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `subscription_id` | uuid | no | FK → subscriptions.id |
| `status` | varchar(16) | no | `draft`, `issued`, `paid`, `overdue`, `void` |
| `amount_due` | numeric(12,2) | no | `subtotal - discount_amount + tax_amount` |
| `due_date` | date | yes | Null for draft invoices |
| `created_at` | timestamptz | no | |

## Notes

table: invoices
```

### Domain event

```markdown
---
slug: events/invoice-issued
domain: billing
entry_type: event
summary: Fired when an invoice is successfully issued and payment is initiated
category: specification
---

# InvoiceIssued

Published by `IssueInvoiceHandler` after invoice reaches `issued` status.

## Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_type` | string | yes | Always `"invoice.issued"` |
| `invoice_id` | uuid | yes | |
| `customer_id` | uuid | yes | |
| `amount_due` | decimal | yes | |

## Published to

queue: `invoice-issued`

## Known consumers

| Service | What it does |
|---------|-------------|
| `NotificationService` | Sends invoice email |
| `AccountingService` | Records receivable entry |
```

---

## Common mistakes

### Frontmatter

| Mistake | Problem | Fix |
|---------|---------|-----|
| Vague `summary`: `"Handles invoices"` | Search and agents cannot tell what the document covers | Write: `"Issues an invoice for a subscription billing period and charges the customer"` |
| No `handler_class` | Search by class name does not work | Always set the exact class name |
| `domain: backend` or `domain: api` | Useless for filtering | Use a functional domain: `billing`, `auth`, `catalog` |
| Wrong `entry_type` | A read-only endpoint is not a `handler` | Read-only → `query_handler`, write → `handler` |
| Changing a slug | Breaks `links:` from other documents | Keep slugs stable |

### Content

| Mistake | Problem | Fix |
|---------|---------|-----|
| No **External Dependencies** section | No relationships between documents | Always list repositories, gRPC, queues, HTTP services |
| `http://localhost:8080` | localhost is ignored by extraction | Use `service: {name}` |
| One file for the whole service | Search returns the whole file | One file = one handler/schema/event |
| Class names differ from the code | Search by class name fails | Copy names from the source |

### Structure

| Mistake | Problem | Fix |
|---------|---------|-----|
| No `##` headings | Wall of text, hard to read and cite | Add `##` for each logical section |
| Several artifacts in one file | Pollutes search results | One document = one artifact |
| No `category` | Cannot filter by kind of information | Always set it; default to `specification` |
