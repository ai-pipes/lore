import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseEnv } from 'dotenv';
import { PARCELLY } from './golden/parcelly.js';
import { checkAnswer } from './lib/answer-checks.js';
import {
  buildConfig,
  parseCli,
  pickQuestions,
  reportFileName,
  type CliArgs,
} from './lib/cli.js';
import { goldenHash, validateGolden, type GoldenQuestion } from './lib/golden.js';
import { connect, type LoreClient } from './lib/lore-client.js';
import { flattenHits, isTermFallback, searchMetrics } from './lib/metrics.js';
import { checkCorpus, readCorpusCounts } from './lib/preflight.js';
import {
  aggregate,
  compareReports,
  formatComparison,
  formatSummary,
  scoreQuestion,
  type AnswerRunRecord,
  type QuestionResult,
  type Report,
  type RunConfig,
  type SearchRunRecord,
} from './lib/report.js';

const PG_CONTAINER = 'lore-showcase-postgres-1';
const ENV_FILE = join('examples', 'showcase', '.env');
const RESULTS_DIR = join('eval', 'results');

function fail(message: string): never {
  throw new Error(message);
}

function loadEnv(): Record<string, string> | undefined {
  return existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE)) : undefined;
}

function need(env: Record<string, string> | undefined, key: string): string {
  if (!env) fail(`${ENV_FILE} not found (needed for ${key})`);
  return env[key] || fail(`${key} is missing in ${ENV_FILE}`);
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function loadReport(path: string): Report {
  if (!existsSync(path)) fail(`report not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as Report;
}

function compare(args: CliArgs): void {
  const [a, b] = args.files as [string, string];
  console.log(formatComparison(compareReports(loadReport(a), loadReport(b), args.threshold)));
}

async function searchRun(client: LoreClient, q: GoldenQuestion): Promise<SearchRunRecord> {
  try {
    const resp = await client.search(q.question, q.scope);
    const hits = flattenHits(resp);
    const terms = resp.terms ?? '';
    return {
      terms,
      fallback: isTermFallback(terms, q.question),
      hits,
      metrics: searchMetrics(hits, q.expected_docs),
    };
  } catch (e) {
    return {
      terms: '',
      fallback: false,
      hits: [],
      metrics: { recall2: 0, recall5: 0, mrr: 0, ndcg10: 0 },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Lore gives term extraction 5 s and falls back to the raw query after that, so the first searches
 * against a cold local model are fallbacks. Repeat a real query until the extractor answers in time.
 */
async function warmUpTerms(client: LoreClient, query: string, attempts = 10): Promise<boolean> {
  for (let i = 1; i <= attempts; i++) {
    const resp = await client.search(query);
    if (!isTermFallback(resp.terms ?? '', query)) return true;
  }
  return false;
}

/** Whether the probe search for a question fell back to the raw question (term extraction too slow). */
async function probeFallback(client: LoreClient, q: GoldenQuestion): Promise<boolean> {
  try {
    const resp = await client.search(q.question, q.scope);
    return isTermFallback(resp.terms ?? '', q.question);
  } catch {
    return false; // a failing search shows up in the chat run itself
  }
}

async function evaluate(args: CliArgs): Promise<void> {
  const kind = args.command as 'search' | 'answers';
  const errors = validateGolden(PARCELLY);
  if (errors.length > 0) fail(`golden set invalid:\n${errors.join('\n')}`);

  const picked = pickQuestions(PARCELLY, kind, args.only);
  if (picked.questions === undefined) fail(picked.error);
  const { questions } = picked;

  if (!args.skipPreflight) {
    const problems = checkCorpus(readCorpusCounts(PG_CONTAINER));
    if (problems.length > 0) fail(`corpus preflight failed:\n${problems.join('\n')}`);
  }

  const env = loadEnv();
  const client = await connect({
    url: args.url,
    apiKey: need(env, 'LORE_API_KEY'),
    login: env?.LORE_ADMIN_LOGIN || 'admin',
    password: kind === 'answers' ? need(env, 'LORE_ADMIN_PASSWORD') : '',
    needChat: kind === 'answers',
  });

  const startedAt = new Date().toISOString();
  const config: RunConfig = buildConfig({
    kind,
    label: args.label,
    startedAt,
    gitSha: git(['rev-parse', 'HEAD']),
    gitDirty: git(['status', '--porcelain']) !== '',
    url: args.url,
    envModel: env?.LLM_MODEL || undefined,
    termModel: args.termModel,
    runs: args.runs,
    goldenHash: goldenHash(PARCELLY),
    goldenCount: questions.length,
  });

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, reportFileName(startedAt, kind, config.label));
  const results: QuestionResult[] = [];
  let current: QuestionResult | undefined;
  const snapshot = (partial: boolean): Report => ({
    config,
    partial,
    questions: current ? [...results, current] : results,
    aggregate: aggregate(current ? [...results, current] : results),
  });
  const write = (partial: boolean): Report => {
    const report = snapshot(partial);
    writeFileSync(file, JSON.stringify(report, null, 2));
    return report;
  };
  process.on('SIGINT', () => {
    write(true);
    console.error(`\ninterrupted, partial report written to ${file}`);
    process.exit(130);
  });

  console.error('warm-up...');
  if (!(await warmUpTerms(client, questions[0]!.question))) {
    const msg =
      'term extraction still times out (> 5 s) after 10 warm-up searches: the local LLM is too slow, ' +
      'so results would be noisy; see eval/README.md. --allow-fallbacks runs anyway';
    if (!args.allowFallbacks) fail(msg);
    console.error(`warning: ${msg}`);
  }
  if (kind === 'answers') {
    const ping = await client.chat('ping');
    if (ping.error) console.error(`warning: warm-up chat failed: ${ping.error}`);
  }

  const total = questions.length * args.runs;
  let done = 0;
  for (const q of questions) {
    const search: SearchRunRecord[] = [];
    const answers: AnswerRunRecord[] = [];
    // Partial state visible to SIGINT while the question's runs accumulate.
    current = scoreQuestion({ id: q.id, tags: q.tags, ...(kind === 'search' ? { search } : { answers }) });
    for (let run = 1; run <= args.runs; run++) {
      const t0 = Date.now();
      let ok: boolean;
      if (kind === 'search') {
        const rec = await searchRun(client, q);
        search.push(rec);
        ok = !rec.error && rec.metrics.recall5 > 0;
      } else {
        // The chat's own term extraction is invisible; a probe search right before it shows whether
        // the model answered extraction in time, so noisy runs are counted, not hidden.
        const termFallback = await probeFallback(client, q);
        const chat = await client.chat(q.question, q.scope);
        const check = checkAnswer(q, chat);
        answers.push({ run: chat, check, ...(termFallback ? { termFallback } : {}) });
        ok = !chat.error && check.allPass;
      }
      done++;
      console.error(`[${done}/${total}] ${q.id} run ${run}/${args.runs} … ${((Date.now() - t0) / 1000).toFixed(1)}s ${ok ? '✓' : '✗'}`);
      current = scoreQuestion({ id: q.id, tags: q.tags, ...(kind === 'search' ? { search } : { answers }) });
    }
    results.push(current);
    current = undefined;
    write(true);
  }

  const final = write(false);
  console.log(formatSummary(final));
  console.log(`report: ${file}`);
}

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));
  if (args.command === 'compare') compare(args);
  else await evaluate(args);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
