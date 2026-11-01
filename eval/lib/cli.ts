import { parseArgs } from 'node:util';
import { CHECKER_VERSION } from './answer-checks.js';
import { selectQuestions, type GoldenQuestion } from './golden.js';
import type { RunConfig } from './report.js';

export const DEFAULT_URL = 'http://localhost:4747';
export const DEFAULT_MODEL = 'qwen2.5:7b';
const USAGE =
  'usage: eval <search|answers> [--runs N] [--only id|tag,...] [--label name] [--url URL] [--term-model m] ' +
  '[--skip-preflight] [--allow-fallbacks] | compare <a.json> <b.json> [--threshold 0.1]';
const COMMANDS = ['search', 'answers', 'compare'] as const;

export interface CliArgs {
  command: (typeof COMMANDS)[number];
  runs: number;
  only?: string[];
  label?: string;
  url: string;
  termModel: string;
  skipPreflight: boolean;
  /** Run even when term extraction still falls back after the warm-up (noisy numbers). */
  allowFallbacks: boolean;
  threshold: number;
  files: string[];
}

function isCommand(c: string): c is CliArgs['command'] {
  return (COMMANDS as readonly string[]).includes(c);
}

export function parseCli(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      runs: { type: 'string' },
      only: { type: 'string' },
      label: { type: 'string' },
      url: { type: 'string' },
      'term-model': { type: 'string' },
      'skip-preflight': { type: 'boolean' },
      'allow-fallbacks': { type: 'boolean' },
      threshold: { type: 'string' },
    },
  });
  const [command, ...files] = positionals;
  if (!command) throw new Error(USAGE);
  if (!isCommand(command)) throw new Error(`unknown command "${command}" (${USAGE})`);
  const runs = values.runs === undefined ? 1 : Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  const threshold = values.threshold === undefined ? 0.1 : Number(values.threshold);
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error('--threshold must be a non-negative number');
  if (command === 'compare' && files.length !== 2) throw new Error('compare needs exactly two reports: compare <a> <b>');
  return {
    command,
    runs,
    only: values.only?.split(',').map((s) => s.trim()).filter(Boolean),
    label: values.label,
    url: values.url ?? DEFAULT_URL,
    termModel: values['term-model'] ?? DEFAULT_MODEL,
    skipPreflight: values['skip-preflight'] ?? false,
    allowFallbacks: values['allow-fallbacks'] ?? false,
    threshold,
    files,
  };
}

export function buildConfig(o: {
  kind: RunConfig['kind'];
  label?: string;
  startedAt: string;
  gitSha: string;
  gitDirty: boolean;
  url: string;
  envModel?: string;
  termModel: string;
  runs: number;
  goldenHash: string;
  goldenCount: number;
}): RunConfig {
  return {
    kind: o.kind,
    label: o.label ?? 'unlabeled',
    startedAt: o.startedAt,
    gitSha: o.gitSha,
    gitDirty: o.gitDirty,
    loreUrl: o.url,
    answerModel: o.envModel ?? DEFAULT_MODEL,
    termModel: o.termModel,
    embeddingProvider: 'ollama',
    embeddingModel: 'nomic-embed-text',
    runs: o.runs,
    goldenHash: o.goldenHash,
    goldenCount: o.goldenCount,
    checkerVersion: CHECKER_VERSION,
  };
}

/** Collapses anything outside [A-Za-z0-9._-] and neutralises dot-only names, so the result is one safe path segment. */
export function sanitizeName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '');
  return safe === '' ? 'x' : safe;
}

export function reportFileName(startedAt: string, kind: string, label: string): string {
  return `${startedAt.replace(/:/g, '-')}-${kind}-${sanitizeName(label)}.json`;
}

/** Applies --only and the kind filter (search skips unanswerable questions); an error string means exit 1. */
export function pickQuestions(
  all: GoldenQuestion[],
  kind: 'search' | 'answers',
  only?: string[],
): { questions: GoldenQuestion[]; error?: undefined } | { error: string; questions?: undefined } {
  const label = only?.join(',');
  const selected = selectQuestions(all, only);
  if (selected.length === 0) return { error: `no questions match --only ${label}` };
  const questions = kind === 'search' ? selected.filter((q) => !q.unanswerable) : selected;
  if (questions.length === 0) {
    return { error: `no searchable questions match --only ${label} (unanswerable questions are skipped in search runs)` };
  }
  return { questions };
}
