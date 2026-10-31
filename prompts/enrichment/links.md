<!--
Prompt: enrichment/links — user message used to extract relationships between documents after a push.
Variables: {{slug}}, {{domain}}, {{summary}}, {{content}}, {{known_slugs}}, {{link_types}}
-->
You are analyzing technical documentation to find relationships between components.

Document slug: {{slug}}
Domain: {{domain}}
Summary: {{summary}}

Content:
{{content}}

Known document slugs in this system (match exactly):
{{known_slugs}}

Find relationships from THIS document to OTHER documents. Only reference slugs from the known list above.
Output a JSON object with a "links" array: { "links": [{ "toSlug": string, "linkType": string, "confidence": number }] }

Valid link types: {{link_types}}
- uses-dal: uses a data-access interface or repository described by the target
- calls-service: makes an HTTP/gRPC call to another service or endpoint
- reads-table / writes-table: reads from or writes to a specific database table
- emits-event / consumes-event: publishes or subscribes to an event
- enqueues / processes-queue: puts jobs on a queue or processes them
- references: general reference
- triggers: causes another action to happen
- depends-on: requires another component to work

Rules:
- Only include links whose target slug exists in the known slugs list
- confidence: 0.9 = very certain, 0.7 = likely, 0.5 = possible
- Skip links with confidence < 0.5
- If no relationships are found, return { "links": [] }
- Return ONLY a valid JSON object with a "links" key, no explanation
