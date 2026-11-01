import { describe, expect, it } from 'vitest';
import type { GoldenQuestion } from './golden.js';
import { CHECKER_VERSION } from './answer-checks.js';
import { buildConfig, parseCli, pickQuestions, reportFileName, sanitizeName } from './cli.js';

describe('parseCli', () => {
  it('parses search defaults', () => {
    const c = parseCli(['search']);
    expect(c).toMatchObject({ command: 'search', runs: 1, url: 'http://localhost:4747', skipPreflight: false, allowFallbacks: false });
    expect(parseCli(['answers', '--allow-fallbacks']).allowFallbacks).toBe(true);
    expect(c.only).toBeUndefined();
  });
  it('parses flags and splits --only', () => {
    const c = parseCli(['answers', '--runs', '2', '--only', 'a,b', '--term-model', 'm', '--label', 'l']);
    expect(c).toMatchObject({ command: 'answers', runs: 2, only: ['a', 'b'], termModel: 'm', label: 'l' });
    expect(parseCli(['search']).label).toBeUndefined();
  });
  it('parses compare positionals and threshold', () => {
    expect(parseCli(['compare', 'a', 'b', '--threshold', '0.2'])).toMatchObject({ command: 'compare', files: ['a', 'b'], threshold: 0.2 });
  });
  it('rejects bad input', () => {
    expect(() => parseCli([])).toThrow(/usage/);
    expect(() => parseCli(['nope'])).toThrow(/unknown command/);
    expect(() => parseCli(['search', '--runs', '0'])).toThrow(/--runs/);
    expect(() => parseCli(['compare', 'a'])).toThrow(/two/);
    expect(() => parseCli(['answers', '--tools', 'off'])).toThrow();
    expect(() => parseCli(['search', '--bogus'])).toThrow();
  });
});

describe('buildConfig', () => {
  const base = { kind: 'answers' as const, startedAt: '2026-11-01T10:00:00.000Z', gitSha: 'abc', gitDirty: false, goldenHash: 'h', goldenCount: 2 };
  it('takes the answer model from .env, then the default', () => {
    const o = { runs: 3, url: 'u', termModel: 'qwen2.5:7b' };
    expect(buildConfig({ ...base, ...o, envModel: 'env' }).answerModel).toBe('env');
    const d = buildConfig({ ...base, ...o });
    expect(d).toMatchObject({ answerModel: 'qwen2.5:7b', termModel: 'qwen2.5:7b', embeddingProvider: 'ollama', embeddingModel: 'nomic-embed-text', label: 'unlabeled', loreUrl: 'u' });
  });
  it('records the current checker version', () => {
    const o = { runs: 3, url: 'u', termModel: 'qwen2.5:7b' };
    expect(buildConfig({ ...base, ...o }).checkerVersion).toBe(CHECKER_VERSION);
  });
});

describe('file names', () => {
  it('builds a filesystem-safe name', () => {
    expect(reportFileName('2026-11-01T10:00:00.000Z', 'search', 'my run/1')).toBe('2026-11-01T10-00-00.000Z-search-my-run-1.json');
  });
});

describe('sanitizeName', () => {
  it('cannot escape a directory', () => {
    expect(sanitizeName('../x')).toBe('-x');
    expect(sanitizeName('..')).toBe('x');
    expect(sanitizeName('a/b c')).toBe('a-b-c');
  });
});

const q = (id: string, tags: string[], unanswerable = false): GoldenQuestion => ({
  id, tags, question: 'q', expected_docs: [], required_facts: [], unanswerable,
});

describe('pickQuestions', () => {
  const all = [q('a', ['t']), q('u', ['t', 'no-doc'], true)];
  it('skips unanswerable questions for search only', () => {
    expect(pickQuestions(all, 'search').questions?.map((x) => x.id)).toEqual(['a']);
    expect(pickQuestions(all, 'answers').questions?.map((x) => x.id)).toEqual(['a', 'u']);
  });
  it('reports an --only that matches nothing', () => {
    expect(pickQuestions(all, 'answers', ['zzz']).error).toBe('no questions match --only zzz');
  });
  it('reports an --only that only matches unanswerable questions in search', () => {
    expect(pickQuestions(all, 'search', ['u']).error).toMatch(/no searchable questions match --only u/);
    expect(pickQuestions(all, 'answers', ['u']).questions).toHaveLength(1);
  });
});
