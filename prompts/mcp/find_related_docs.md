Find documents related to a given document.
Returns both explicit links (declared in frontmatter or found by enrichment) and inferred links (derived from
auto-extracted metadata such as grpc_service, http_service, message_queue).
Each result includes a "source" field: "explicit" or "inferred". Inferred links also have a "matched_via"
field explaining why (e.g. "message_queue:{{example_queue}}").
