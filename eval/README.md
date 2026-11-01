# Lore quality eval

A golden-set eval for Lore's search and chat answers. It asks the questions of the Parcelly golden set
(`eval/golden/parcelly.ts`) against the showcase stack (`examples/showcase`), scores the results with
deterministic checks (no LLM judge) and writes a JSON report. It talks to Lore over HTTP only and is not part of
`npm test` or CI, because it needs a running stack and an LLM.

This is the single golden mechanism of the repository: it replaced the old offline search-quality suite, whose few
checks the golden set does not cover live on as ordinary tests in `src/__tests__/`.

## What it measures

Search (`GET /api/search`):

- **recall2 / recall5**: share of the primary (grade 2) documents in the top 2 / top 5 results.
- **mrr**: 1 / rank of the first primary document (0 when it is absent).
- **ndcg10**: nDCG over the top 10 with gain = grade (2 primary, 1 supporting); the headline search metric.
- **fallbacks**: runs where term extraction returned the question itself (LLM error or its 5 s timeout).

Answers (`POST /api/chat` as the admin user):

- **factRecall**: share of the question's required facts found in the answer (regular expressions).
- **forbiddenRate**: share of answered runs that state something forbidden (such as an outdated value); lower is better.
- **citationRecall**: share of the must-cite documents the answer cites, with a `[ref:<library>/<slug>]` marker or
  by opening it with the `get_document` tool.
- **allPassRate**: share of runs with no error, every fact, nothing forbidden and every citation; the headline answers metric.
- **contextRecall** (worst-questions table): share of the primary documents among those Lore put into the model's
  context. Low allPassRate with high contextRecall points at the model, low contextRecall at retrieval.

A run with a stream error, a truncated stream or no `done` event counts as an error and fails every check. The
summary shows each metric overall and per tag, the error and fallback counts and the ten worst questions.
Unanswerable questions are skipped in search runs; in answer runs they pass when the answer says there is no
documentation.

## Prerequisites

1. The showcase stack from `examples/showcase`, with the OpenAI-compatible local LLM and the embeddings
   configured in its `docker-compose.yml`.
2. `examples/showcase/.env` (gitignored) with `LORE_API_KEY` and `LORE_ADMIN_PASSWORD`.
3. The stack started and seeded, from the repository root:

   ```sh
   (cd examples/showcase && docker compose up -d --build)
   npm run build && examples/showcase/push.sh
   ```

Every run starts with a preflight that reads the corpus from the showcase Postgres container and stops if a
library or branch the golden set asks about is missing or a document has no embedding (`--skip-preflight` skips it).

## Commands

```sh
npm run eval:search  -- [--runs 1] [--only id|tag,...] [--label name] [--url URL] [--term-model m] [--skip-preflight] [--allow-fallbacks]
npm run eval:answers -- [same flags]
npm run eval:compare -- <a.json> <b.json> [--threshold 0.1]
```

- `--runs N` repeats each question N times (default 1); `--only` takes question ids or tags.
- `--label` names the run (default `unlabeled`); `--url` defaults to `http://localhost:4747`; `--term-model` records
  the term-extraction model in the report (it changes nothing in Lore). The answer model is recorded from
  `LLM_MODEL` in `examples/showcase/.env`.
- Each run writes the full report (hits, extracted terms, answer text and checks) to
  `eval/results/<time>-<kind>-<label>.json` (gitignored). The report is rewritten after every question, so Ctrl-C
  leaves a partial one.

## Reading a comparison

`eval:compare A B` prints:

- a `WARNING` when the configurations differ in anything but label, time and git commit (models, runs, golden set
  hash, URL, `checkerVersion`), when a report is partial, or when either run had term-extraction fallbacks or errors;
- the overall metrics of A and B and the delta B − A;
- **Regressions** and **Improvements**: per question and metric, changes of at least `--threshold`
  (`forbiddenRate` counts as better when it drops), worst and best first;
- questions present in only one report.

Look at the regressed questions in the B report (`hits`, `terms`, the answer `text` and its `check`) before
drawing conclusions: with one run per question a single changed answer moves that question from 1 to 0.

## Adding a question

1. Find the fact in the Parcelly docs under `examples/showcase/` (`push.sh` says which version of each library is
   current) and note the file and line in a comment.
2. Add a `GoldenQuestion` to `PARCELLY` in `eval/golden/parcelly.ts`:
   - `id` (unique), `tags`, and `question` as a sentence (a bare dotted slug is rejected: Lore treats it as a slug lookup);
   - `expected_docs` with grades (2 primary, 1 supporting) and optionally `scope` (`library_id`, `branch`);
   - `required_facts`: `{ id, patterns }`, built with the helpers in that file (`eur`, `minutes`, `route`, …);
     any matching pattern means the fact is present;
   - `forbidden` (optional): patterns of values the answer must not state, such as outdated ones;
   - `must_cite` (optional, default the grade-2 documents): `library_id/slug` entries that must all be cited;
     `a/b|c/d` is satisfied by either;
   - `unanswerable: true` for a question the docs do not answer; then `expected_docs` may be empty and
     `required_facts` holds the "no documentation" pattern.
3. Run `npx vitest run eval/golden`, then `npm run eval:answers -- --only <id>` and read the answer in the report
   to check that the patterns accept a correct answer and reject a wrong one.

A changed golden set changes the golden hash, so `eval:compare` against an older report warns.

## Noise

- Term extraction and answers run at temperature 0, so on a responsive machine two runs of the same code give the
  same numbers. Check that once with `eval:compare` before trusting small deltas.
- Lore gives term extraction 5 s, then searches with the raw question. A run warms up first and refuses to start
  when extraction still times out (`--allow-fallbacks` runs anyway); fallbacks during a run are counted, and
  `eval:compare` warns about them.
- Every report records `checkerVersion` (`CHECKER_VERSION` in `eval/lib/answer-checks.ts`, bumped when scoring
  changes); `eval:compare` warns when the two differ.
- The numbers are only meaningful for the showcase stack seeded by `push.sh`; other or additional data (another
  push, enrichment, published insights) makes them incomparable.
