import { describe, expect, it } from 'vitest';
import {
  docKey,
  goldenHash,
  mustCite,
  selectQuestions,
  validateGolden,
  type GoldenQuestion,
} from './golden.js';

function q(over: Partial<GoldenQuestion> = {}): GoldenQuestion {
  return {
    id: 'cancel-fee',
    question: 'What is the cancellation fee?',
    tags: ['fact'],
    expected_docs: [{ library_id: 'orders-service', slug: 'orders/cancel-order', grade: 2 }],
    required_facts: [{ id: 'fee', patterns: [/\b5\s*%/] }],
    ...over,
  };
}

const valid = (): GoldenQuestion[] => [
  q(),
  q({ id: 'refund-window', tags: ['multi-doc'], question: 'How long do refunds take?' }),
];

describe('validateGolden', () => {
  it('accepts a valid set', () => {
    expect(validateGolden(valid())).toEqual([]);
  });

  it('accepts event-name dots inside a sentence', () => {
    expect(validateGolden([q({ question: 'Which services consume order.created?' })])).toEqual([]);
  });

  it('flags a duplicate id', () => {
    const errs = validateGolden([q(), q()]);
    expect(errs.some((e) => e.includes('cancel-fee') && /duplicate/i.test(e))).toBe(true);
  });

  it('flags a dotted-slug question', () => {
    const errs = validateGolden([q({ question: 'orders.create-order' })]);
    expect(errs.some((e) => e.includes('cancel-fee'))).toBe(true);
  });

  it('flags a branch scope without library', () => {
    const errs = validateGolden([q({ scope: { branch: 'x' } })]);
    expect(errs.some((e) => e.includes('cancel-fee'))).toBe(true);
  });

  it('flags empty expected_docs on an answerable question', () => {
    const errs = validateGolden([q({ expected_docs: [] })]);
    expect(errs.some((e) => e.includes('cancel-fee'))).toBe(true);
  });

  it('allows empty expected_docs when unanswerable', () => {
    expect(validateGolden([q({ expected_docs: [], unanswerable: true })])).toEqual([]);
  });

  it('flags empty required_facts', () => {
    const errs = validateGolden([q({ required_facts: [] })]);
    expect(errs.some((e) => e.includes('cancel-fee'))).toBe(true);
  });

  it('accepts "a|b" alternatives in must_cite and checks each alternative', () => {
    expect(validateGolden([q({ must_cite: ['a/b|c/d'] })])).toEqual([]);
    expect(validateGolden([q({ must_cite: ['a/b|noslash'] })]).some((e) => e.includes('noslash'))).toBe(true);
  });

  it('flags a must_cite entry without a slash', () => {
    const errs = validateGolden([q({ must_cite: ['noslash'] })]);
    expect(errs.some((e) => e.includes('cancel-fee'))).toBe(true);
  });
});

describe('mustCite', () => {
  it('defaults to grade-2 docs', () => {
    expect(
      mustCite(
        q({
          expected_docs: [
            { library_id: 'orders-service', slug: 'orders/cancel-order', grade: 2 },
            { library_id: 'billing-service', slug: 'refunds/issue-refund', grade: 1 },
          ],
        }),
      ),
    ).toEqual(['orders-service/orders/cancel-order']);
  });

  it('prefers an explicit must_cite', () => {
    expect(mustCite(q({ must_cite: ['a/b'] }))).toEqual(['a/b']);
  });
});

describe('docKey', () => {
  it('joins library and slug', () => {
    expect(docKey({ library_id: 'a', slug: 'b/c' })).toBe('a/b/c');
  });
});

describe('goldenHash', () => {
  it('is stable and sensitive to pattern changes', () => {
    const a = goldenHash(valid());
    expect(goldenHash(valid())).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const changed = valid();
    changed[0]!.required_facts[0]!.patterns = [/\b6\s*%/];
    expect(goldenHash(changed)).not.toBe(a);
  });
});

describe('selectQuestions', () => {
  const qs = valid();
  it('returns all when only is undefined', () => {
    expect(selectQuestions(qs)).toEqual(qs);
  });
  it('matches by tag', () => {
    expect(selectQuestions(qs, ['fact']).map((x) => x.id)).toEqual(['cancel-fee']);
  });
  it('matches by id', () => {
    expect(selectQuestions(qs, ['refund-window']).map((x) => x.id)).toEqual(['refund-window']);
  });
  it('returns [] when nothing matches', () => {
    expect(selectQuestions(qs, ['nope'])).toEqual([]);
  });
});
