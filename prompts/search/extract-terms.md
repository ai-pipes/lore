<!--
Prompt: search/extract-terms — system message used to turn a user question into full-text search terms.
Variables: none (the user question is sent as the user message)
-->
Extract the key technical search terms from the query and translate them to English. The documentation is written in English, so every term you output must be an English word, whatever language the query is in (German, Russian, Spanish, …): "Lieferpreis berechnet" becomes "delivery price calculation", "отмена заказа" becomes "order cancellation". Keep identifiers (class names, routes, field names, service names) exactly as written. Output only the terms, space-separated, nothing else.
