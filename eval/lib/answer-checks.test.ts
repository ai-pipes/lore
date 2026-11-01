import { describe, expect, it } from 'vitest';
import { checkAnswer, extractCitations, normalizeAnswer, type ChatRun } from './answer-checks.js';
import type { GoldenQuestion } from './golden.js';

const KEY = 'orders-service/orders/cancel-order';
const q = (over: Partial<GoldenQuestion> = {}): GoldenQuestion => ({
  id: 'q1',
  question: 'What is the cancellation fee?',
  tags: [],
  expected_docs: [{ library_id: 'orders-service', slug: 'orders/cancel-order', grade: 2 }],
  required_facts: [{ id: 'fee', patterns: [/3[.,]50\s*(EUR|€)/i] }],
  ...over,
});
const run = (over: Partial<ChatRun> = {}): ChatRun => ({
  text: `The fee is **3.50 EUR** [ref:${KEY}]`,
  toolSlugs: [],
  sources: [],
  durationMs: 1,
  ...over,
});

describe('normalizeAnswer / extractCitations', () => {
  it('collapses whitespace and strips bold and code markers', () => {
    expect(normalizeAnswer('a  **b**\n`d`')).toBe('a b d');
  });
  it('keeps underscores of snake_case identifiers', () => {
    expect(normalizeAnswer('use `preferred_courier_id`')).toBe('use preferred_courier_id');
  });
  it('extracts unique ref markers', () => {
    expect(extractCitations(`[ref:${KEY}] x [ref:${KEY}] [ref:a-b/c]`)).toEqual([KEY, 'a-b/c']);
  });
});

describe('checkAnswer', () => {
  it('finds a fact and the citation', () => {
    const r = checkAnswer(q(), run());
    expect(r.facts).toEqual({ fee: true });
    expect(r.cited).toEqual([KEY]);
    expect(r.citationRecall).toBe(1);
    expect(r.allPass).toBe(true);
  });
  it('flags forbidden patterns', () => {
    const forb = [{ id: 'old-fee', patterns: [/3[.,]00\s*(EUR|€)/i] }];
    expect(checkAnswer(q({ forbidden: forb }), run()).forbiddenHit).toEqual([]);
    const bad = checkAnswer(q({ forbidden: forb }), run({ text: `3.50 EUR or 3.00 EUR [ref:${KEY}]` }));
    expect(bad.forbiddenHit).toEqual(['old-fee']);
    expect(bad.allPass).toBe(false);
  });
  it('matches ref markers case-insensitively', () => {
    const r = checkAnswer(q(), run({ text: '3.50 EUR [ref:Orders-Service/orders/Cancel-Order]' }));
    expect(r.cited).toEqual([KEY]);
    expect(r.citationRecall).toBe(1);
  });
  it('counts a get_document tool slug as a citation', () => {
    const k = 'billing-service/refunds/issue-refund';
    const r = checkAnswer(
      q({ must_cite: [k], required_facts: [{ id: 'f', patterns: [/x/] }] }),
      run({ text: 'x', toolSlugs: ['refunds/issue-refund'] }),
    );
    expect(r.cited).toEqual([k]);
    expect(r.citationRecall).toBe(1);
  });
  it('accepts any alternative of a "a|b" must_cite entry', () => {
    const alt = 'identity-service/identity/overview|identity-service/auth/refresh-token';
    const qq = q({ must_cite: [alt], required_facts: [{ id: 'f', patterns: [/x/] }] });
    const viaMarker = checkAnswer(qq, run({ text: 'x [ref:identity-service/auth/refresh-token]' }));
    expect(viaMarker.cited).toEqual([alt]);
    expect(viaMarker.citationRecall).toBe(1);
    const viaTool = checkAnswer(qq, run({ text: 'x', toolSlugs: ['identity/overview'] }));
    expect(viaTool.citationRecall).toBe(1);
    const none = checkAnswer(qq, run({ text: 'x [ref:identity-service/auth/sign-in]' }));
    expect(none.citationRecall).toBe(0);
  });
  it('separates context recall from citation recall', () => {
    const r = checkAnswer(q(), run({ text: '3.50 EUR', sources: [KEY] }));
    expect(r.contextRecall).toBe(1);
    expect(r.citationRecall).toBe(0);
    expect(r.allPass).toBe(false);
  });
  it('treats empty mustCite / no grade-2 docs as 1', () => {
    const r = checkAnswer(q({ expected_docs: [], unanswerable: true }), run({ text: '3.50 EUR' }));
    expect(r.citationRecall).toBe(1);
    expect(r.contextRecall).toBe(1);
  });
  it('fails everything on run.error', () => {
    const r = checkAnswer(q(), run({ error: 'stream error' }));
    expect(r.facts).toEqual({ fee: false });
    expect(r.allPass).toBe(false);
  });
  it('matches g-flag patterns repeatedly', () => {
    const qq = q({ required_facts: [{ id: 'f', patterns: [/3\.50/g] }] });
    expect(checkAnswer(qq, run()).facts.f).toBe(true);
    expect(checkAnswer(qq, run()).facts.f).toBe(true);
  });
});
