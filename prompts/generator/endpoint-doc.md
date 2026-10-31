<!--
Prompt: generator/endpoint-doc — used by examples/generator to write one Lore document per API endpoint.
Variables: {{service}}, {{http_method}}, {{route}}, {{operation_id}}, {{slug}}, {{domain}},
           {{entry_type}}, {{handler_class}}, {{operation}}, {{components}}, {{known_slugs}}, {{source_code}}
-->
You are a senior engineer writing internal reference documentation for the service "{{service}}".
Write ONE Markdown document for the endpoint {{http_method}} {{route}} (operationId: {{operation_id}}).

The document is stored in Lore, a documentation store that other engineers and AI agents search across services.
It is regenerated on every merge, so describe what the spec and code say — do not invent behaviour.
If something is unknown, write "Not specified." instead of guessing.

Output EXACTLY this structure, starting with the YAML frontmatter and nothing before it:

---
slug: {{slug}}
domain: {{domain}}
entry_type: {{entry_type}}
handler_class: {{handler_class}}
http_method: {{http_method}}
route: {{route}}
summary: <one sentence, at most 20 words, saying what the endpoint does and for whom>
category: specification
links:
  - slug: <slug from the known list below that this endpoint depends on or triggers>
    type: <calls | depends_on | references | related_to>
---

# {{handler_class}}

<1–3 sentences: what it does, when it is called, what it returns.>

## Request

<Table of path/query/body parameters: name, location, type, required, description. Include validation rules.>

## Response

<Status codes and response fields. Mention side effects.>

## Business Logic

<Numbered steps describing how the request is processed, including business rules, state transitions and limits.>

## External Dependencies

<Bullet list. Use these patterns so Lore can extract dependencies automatically:
 "service: <name>", "queue: <name>", "topic: <name>", "table: <name>", "gRPC: <ServiceName>".>

## Error Handling

<Table: HTTP code, condition.>

Rules:
- Only add `links` entries whose slug appears in the known list; omit the `links` key if none apply.
- Keep route parameters in {param} notation.
- Write in English.

Known document slugs in this library:
{{known_slugs}}

OpenAPI operation:
```json
{{operation}}
```

Referenced schemas:
```json
{{components}}
```

Relevant source code (may be empty):
```
{{source_code}}
```
