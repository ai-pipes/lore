import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeAnswer } from '../lib/answer-checks.js';
import { docKey, mustCite, validateGolden, type GoldenQuestion } from '../lib/golden.js';
import { PARCELLY } from './parcelly.js';

const SHOWCASE = fileURLToPath(new URL('../../examples/showcase/', import.meta.url));
// Libraries whose promoted (current) version is the v2 push in examples/showcase/push.sh.
const V2_LIBRARIES = new Set(['orders-service', 'billing-service', 'notifications-service']);
const BRANCH_DIRS: Record<string, string> = { 'feature/batch-dispatch': 'branch-batch-dispatch' };

/** Candidate paths of a document in the corpus directory the question targets, in lookup order. */
function candidates(q: GoldenQuestion, key: string): string[] {
  const [library, ...rest] = key.split('/');
  const file = `${library}/${rest.join('/')}.md`;
  if (q.scope?.branch) return [`${SHOWCASE}${BRANCH_DIRS[q.scope.branch] ?? q.scope.branch}/${file}`];
  const dirs = V2_LIBRARIES.has(library) ? ['v2', 'v1'] : ['v1'];
  return dirs.map((d) => `${SHOWCASE}${d}/${file}`);
}

describe('PARCELLY golden set', () => {
  it('is valid', () => {
    expect(validateGolden(PARCELLY)).toEqual([]);
  });

  it('has 30 questions', () => {
    expect(PARCELLY).toHaveLength(30);
  });

  it('covers every required tag', () => {
    const tags = new Set(PARCELLY.flatMap((q) => q.tags));
    for (const t of ['fact', 'endpoint', 'flow', 'ops', 'version', 'branch', 'scoped', 'non-english', 'unanswerable']) {
      expect(tags, `tag ${t}`).toContain(t);
    }
  });

  it('points every expected and must-cite document at a file of the targeted version', () => {
    const missing: string[] = [];
    for (const q of PARCELLY) {
      const keys = new Set([...q.expected_docs.map(docKey), ...mustCite(q).flatMap((k) => k.split('|'))]);
      for (const key of keys) {
        const paths = candidates(q, key);
        if (!paths.some((p) => existsSync(p))) missing.push(`${q.id}: ${paths.join(' | ')}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps scoped questions inside their library', () => {
    for (const q of PARCELLY.filter((x) => x.scope?.library_id)) {
      for (const d of q.expected_docs) expect(d.library_id, q.id).toBe(q.scope?.library_id);
    }
  });
});

function check(id: string, list: 'required_facts' | 'forbidden', checkId: string): RegExp[] {
  const q = PARCELLY.find((x) => x.id === id);
  const c = q?.[list]?.find((x) => x.id === checkId);
  if (!c) throw new Error(`${id}: no ${list} check ${checkId}`);
  return c.patterns;
}
/** Scores the text the way checkAnswer does: on the normalized answer. */
const hits = (patterns: RegExp[], text: string): boolean => {
  const normalized = normalizeAnswer(text);
  return patterns.some((p) => p.test(normalized));
};

describe('PARCELLY pattern tolerance', () => {
  it('accepts common phrasings of the courier release', () => {
    const p = check('cancel-event-chain', 'required_facts', 'dispatch-release');
    for (const t of [
      'dispatch-service releases the assigned courier',
      'dispatch will release the courier',
      'it frees the courier',
      'dispatch unassigns the courier',
      'the courier is released',
    ]) {
      expect(hits(p, t), t).toBe(true);
    }
    expect(hits(p, 'the courier delivers the parcel')).toBe(false);
  });

  it('accepts method and path in either order within one sentence', () => {
    const p = check('refresh-token-endpoint', 'required_facts', 'route');
    for (const t of [
      'POST /api/v1/auth/refresh',
      'Send a POST to /api/v1/auth/refresh.',
      'POST https://api.parcelly.example/api/v1/auth/refresh',
      '`/api/v1/auth/refresh` (POST)',
      'Call /api/v1/auth/refresh with POST.',
      '`POST` `/api/v1/auth/refresh`',
    ]) {
      expect(hits(p, t), t).toBe(true);
    }
    for (const t of [
      'GET /api/v1/auth/refresh',
      'post /api/v1/auth/refresh',
      'POST /api/v1/auth/token',
      `POST ${'x'.repeat(60)} /api/v1/auth/refresh`,
      'POST /api/v1/auth/refresh-all',
    ]) {
      expect(hits(p, t), t).toBe(false);
    }
    const eta = check('eta-endpoint', 'required_facts', 'route');
    expect(hits(eta, 'GET /api/v1/orders/:orderId/eta')).toBe(true);
    expect(hits(eta, 'To get the ETA, POST /api/v1/orders/{order_id}/eta')).toBe(false);
  });

  it('accepts honest refusals as the no-docs fact', () => {
    for (const id of ['parcel-insurance', 'courier-salary']) {
      const p = check(id, 'required_facts', 'no-docs');
      for (const t of [
        "I don't have documentation about that.",
        'I don’t have documentation about that.',
        'No documentation found.',
        "I couldn't find anything about it.",
        'I could not find this in the docs.',
        'There is no information about that.',
        'This is not documented.',
        "It isn't documented.",
        'That topic is not covered.',
        'В документации нет информации об этом.',
        'Я не нашёл этого.',
        'Я не нашел этого.',
        'Это не описано.',
        'нет документации',
      ]) {
        expect(hits(p, t), `${id}: ${t}`).toBe(true);
      }
      expect(hits(p, 'Insurance covers up to 500 EUR.')).toBe(false);
    }
  });

  it('flags only salary amounts for the salary question and any amount for insurance', () => {
    const salary = check('courier-salary', 'forbidden', 'salary-amount');
    for (const t of [
      'The monthly salary is 2,400 EUR.',
      'Couriers earn 15 EUR per hour.',
      'Their wage is €14.50 an hour.',
      'Couriers are paid €2400 monthly.',
    ]) {
      expect(hits(salary, t), t).toBe(true);
    }
    for (const t of [
      "I don't have documentation on courier salaries; couriers receive the 3.50 EUR cancellation fee.",
      "I couldn't find salary information, but tips of up to 20.00 EUR go to the courier.",
      'No documentation found about salaries. The courier gets the 3.50 € fee.',
    ]) {
      expect(hits(salary, t), t).toBe(false);
    }
    const insured = check('parcel-insurance', 'forbidden', 'insured-amount');
    for (const t of [
      'Insurance covers parcels up to 500 EUR.',
      'The insured value is capped at €200',
      'Each parcel is covered for 100.00 EUR',
      'Coverage: 250 EUR per parcel',
    ]) {
      expect(hits(insured, t), t).toBe(true);
    }
    for (const t of [
      "I don't have documentation for this specific detail. Delivery prices range from 4.90 EUR to 37.35 EUR, and the optional tip is capped at 20.00 EUR. These are not insured values.",
      'Parcel insurance is not documented. A cancellation after assignment costs 3.50 EUR.',
    ]) {
      expect(hits(insured, t), t).toBe(false);
    }
  });

  it('requires the 0.00 tip minimum, not just the maximum', () => {
    const p = check('courier-tip', 'required_facts', 'min-tip');
    for (const t of [
      'The tip must be between 0.00 and 20.00 EUR.',
      'Tips range from 0–20 €.',
      'tip is 0,00 - 20,00 EUR',
      'A minimum of 0.00 EUR applies.',
    ]) {
      expect(hits(p, t), t).toBe(true);
    }
    for (const t of ['The tip is 0.50–20.00 EUR.', 'The tip is optional, up to 20.00 EUR.', 'between 10.00 and 20.00 EUR']) {
      expect(hits(p, t), t).toBe(false);
    }
  });

  it('keeps snake_case identifiers intact', () => {
    expect(hits(check('no-couriers-runbook', 'required_facts', 'preferred-courier'), 'reassign with preferred_courier_id')).toBe(true);
    expect(hits(check('payment-flow', 'required_facts', 'intent'), 'a `payment_intent` is created')).toBe(true);
    expect(hits(check('offer-timeout', 'required_facts', 'max-offers'), 'until offer_count < 3')).toBe(true);
  });

  it('lets token-lifetimes be cited from the overview or the refresh endpoint', () => {
    const q = PARCELLY.find((x) => x.id === 'token-lifetimes')!;
    expect(mustCite(q)).toEqual(['identity-service/identity/overview|identity-service/auth/refresh-token']);
    expect(hits(check('psp-choice-adr', 'required_facts', 'manual-capture'), '**capture_method = manual**')).toBe(true);
    expect(hits(check('payment-flow', 'required_facts', 'captured-event'), 'emits `payment_captured`')).toBe(true);
  });

  it('forbids the v1 fee in the cancel event chain', () => {
    const p = check('cancel-event-chain', 'forbidden', 'v1-fee');
    expect(hits(p, 'the courier gets a 3.00 EUR fee')).toBe(true);
    expect(hits(p, 'the fee is 3.50 EUR')).toBe(false);
  });
});
