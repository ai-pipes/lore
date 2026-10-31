# Security policy

## Supported versions

Security fixes go into the latest release. Run the newest `ghcr.io/ai-pipes/lore` image (or the newest tag of this repository).

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on <https://github.com/ai-pipes/lore/security/advisories/new>. Include what is affected (route, CLI command, MCP tool or configuration), the steps to reproduce it and the impact you expect.

You will get an answer within a few days. Once a fix is released, the advisory is published with credit to the reporter, unless you ask otherwise.

## Scope

In scope: the Lore server (HTTP API, web UI, MCP), the `lore` CLI, the Docker image and the default Docker Compose setup. The security guarantees Lore aims to keep are listed in the Security section of the [README](README.md#security).

Out of scope: deployments that disable those guarantees on purpose (for example, exposing Postgres publicly or running without `LORE_API_KEY`), and vulnerabilities in third-party LLM or embedding providers.
